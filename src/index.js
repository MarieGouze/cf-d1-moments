// cf-d1-moments：极简朋友圈（仿 kingwrcy/moments 版面，Cloudflare Workers + D1 + R2 重写）
import { initDb, getSettings, isAdmin, gateCookieOk, currentUser, notifyForComment, unreadNotifCount, unreadAdminCount } from './db.js';
import { layout, memoCard, linksBlock, pagerHtml, noticeHtml, timeAgo } from './render.js';
import * as admin from './admin.js';
import {
  htmlResponse, redirect, nowSec, sha256Hex, clientIp, parseCookies,
  createCaptcha, verifyCaptcha, escapeXml,
} from './utils.js';
import { plainTextExcerpt } from './markdown.js';

const PAGE_SIZE = 10;

async function listMemos(env, { page = 1, tag = '', adminView = false } = {}) {
  const now = nowSec();
  const conds = [];
  const binds = [];
  if (!adminView) { conds.push('m.created_at <= ?'); binds.push(now); conds.push('m.hidden = 0'); }
  if (tag) { conds.push("((',' || m.tags || ',') LIKE ?)"); binds.push(`%,${tag},%`); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const offset = (page - 1) * PAGE_SIZE;
  const { results } = await env.DB.prepare(
    `SELECT m.*, u.avatar AS author_avatar,
      (SELECT COUNT(*) FROM likes WHERE memo_id = m.id) AS like_count,
      (SELECT COUNT(*) FROM comments WHERE memo_id = m.id AND status='approved' AND flag='') AS comment_count
     FROM memos m LEFT JOIN users u ON u.id = m.author_id ${where}
     ORDER BY m.pinned DESC, m.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...binds, PAGE_SIZE + 1, offset).all();
  const rows = results || [];
  const hasMore = rows.length > PAGE_SIZE;
  return { memos: rows.slice(0, PAGE_SIZE), hasMore };
}

async function approvedComments(env, memoId, limit = 500, adminView = false) {
  const { results } = await env.DB.prepare(
    `SELECT id, parent_id, reply_to, name, content, created_at, admin_only FROM comments WHERE memo_id = ? AND status='approved' AND flag='' ORDER BY created_at ASC LIMIT ?`
  ).bind(memoId, limit).all();
  return results || [];
}

async function likedSet(env, request, memoIds) {
  if (!memoIds.length) return new Set();
  const ipHash = await sha256Hex(clientIp(request));
  const { results } = await env.DB.prepare(
    `SELECT memo_id FROM likes WHERE ip_hash = ? AND memo_id IN (${memoIds.map(() => '?').join(',')})`
  ).bind(ipHash, ...memoIds).all();
  return new Set((results || []).map((r) => r.memo_id));
}

// ---------------- R2 用量监控 ----------------
// 与 cf-free-webdav 同口径：免费额度 10 GiB；用量由 Worker 通过 R2 绑定的 list 实测桶内对象总大小，
// 结果缓存 10 分钟（settings 表 r2_usage），避免每次访问都列桶。
const R2_FREE_BYTES = 10 * 1024 ** 3;

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

async function r2UsageText(env, settings) {
  try {
    let cache = null;
    try { cache = JSON.parse(settings.r2_usage || 'null'); } catch { cache = null; }
    const now = Math.floor(Date.now() / 1000);
    if (!cache || now - cache.t > 600) {
      let bytes = 0;
      let count = 0;
      let cursor;
      do {
        const page = await env.MEDIA.list({ limit: 1000, cursor });
        for (const o of page.objects) { bytes += o.size; count += 1; }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      cache = { b: bytes, n: count, t: now };
      await env.DB.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).bind('r2_usage', JSON.stringify(cache)).run();
    }
    const pct = (cache.b / R2_FREE_BYTES) * 100;
    const pctText = pct < 10 ? pct.toFixed(2) : pct.toFixed(1);
    // 免费额度按月重置（每月 1 日 UTC）：距下次重置的天数
    const dNow = new Date();
    const nextReset = Date.UTC(dNow.getUTCFullYear(), dNow.getUTCMonth() + 1, 1);
    const todayUtc = Date.UTC(dNow.getUTCFullYear(), dNow.getUTCMonth(), dNow.getUTCDate());
    const resetDays = Math.round((nextReset - todayUtc) / 86400000);
    return `存储已用 ${pctText}% · 距重置 ${resetDays} 天`;
  } catch {
    return '';
  }
}

// 记录到访：按 IP+UA 哈希去重，同一访客只算一人（页脚「累计到访」用）
async function recordVisit(env, request) {
  try {
    const ip = clientIp(request);
    if (!ip) return;
    const ua = request.headers.get('user-agent') || '';
    const hash = (await sha256Hex(`${ip}|${ua}`)).slice(0, 32);
    const now = nowSec();
    await env.DB.prepare(
      'INSERT INTO visitors (ip_hash, first_seen, last_seen) VALUES (?, ?, ?) ON CONFLICT(ip_hash) DO UPDATE SET last_seen = excluded.last_seen'
    ).bind(hash, now, now).run();
  } catch { /* 计数失败不影响页面 */ }
}

async function withUsage(env, settings) {
  const out = { ...settings };
  const text = await r2UsageText(env, settings);
  if (text) out.r2_usage_text = text;
  // 建站天数（按北京时间的日历天，建站当天算第 1 天）+ 累计到访人数
  try {
    const since = parseInt(settings.site_since || '', 10);
    if (Number.isFinite(since) && since > 0) {
      const dayIdx = (ts) => Math.floor((ts + 28800) / 86400);
      const days = Math.max(1, dayIdx(nowSec()) - dayIdx(since) + 1);
      out.site_days_text = `建站第 ${days} 天`;
    }
    const vc = await env.DB.prepare('SELECT COUNT(*) AS c FROM visitors').first();
    if (vc) out.visitor_text = `累计到访 ${vc.c} 人`;
  } catch { /* 表未建好时不显示 */ }
  // 全账号今日请求：Cloudflare 官方统计，由外部定时任务每 15 分钟写入 settings.acct_usage；只显示当天的数据
  const today = new Date().toISOString().slice(0, 10);
  try {
    const acct = settings.acct_usage ? JSON.parse(settings.acct_usage) : null;
    if (acct && typeof acct.n === 'number' && new Date(acct.t * 1000).toISOString().slice(0, 10) === today) {
      const apct = (acct.n / 100000) * 100;
      const apctText = apct < 10 ? apct.toFixed(2) : apct.toFixed(1);
      const nextMidnight = Date.parse(today + 'T00:00:00Z') + 86400000;
      const resetHours = Math.max(1, Math.ceil((nextMidnight - Date.now()) / 3600000));
      out.acct_usage_text = `今日请求已用 ${apctText}% · 距重置 ${resetHours} 小时`;
    }
  } catch { /* 数据损坏时不显示这一行 */ }
  return out;
}

// 「回复后可见」的解锁集合（附件门控与正文门控共用）：管理员全解锁；其余按评论 IP 判断——必须直接评论这条动态本身（parent_id=0）才解锁，回复动态下的某条留言不算（用户 2026-11-01 定）
async function unlockedSet(env, request, memoIds, adminView) {
  const out = new Set();
  if (!memoIds.length) return out;
  if (adminView) {
    for (const id of memoIds) out.add(id);
    return out;
  }
  const ip = clientIp(request);
  if (!ip) return out;
  try {
    const ph = memoIds.map(() => '?').join(',');
    const rows = await env.DB.prepare(
      `SELECT DISTINCT memo_id FROM comments WHERE ip = ? AND flag = '' AND parent_id = 0 AND memo_id IN (${ph})`
    ).bind(ip, ...memoIds).all();
    for (const r of rows.results || []) out.add(r.memo_id);
  } catch { /* 查询失败按未解锁处理 */ }
  return out;
}

// 单条动态观看密码：带对解锁 cookie（或管理员）才算能看；令牌由密码哈希派生，改密码即失效
async function viewUnlocked(env, request, memo, settings, adminView) {
  if (!memo.view_password_hash) return true;
  if (adminView) return true;
  const token = await sha256Hex(memo.view_password_hash + ':' + memo.id + ':' + (settings.site_secret || ''));
  const cookies = parseCookies(request);
  return cookies['mm_view_' + memo.id] === token;
}

// 评论里注册用户的头像与 id 映射（username -> 头像路径 / 用户 id），供评论区显示头像、私信入口定位收信人
async function userMapsFor(env, comments) {
  const names = [...new Set((comments || []).map((c) => c.name).filter(Boolean))];
  const avatars = {};
  const ids = {};
  if (!names.length) return { avatars, ids };
  const ph = names.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT id, username, avatar FROM users WHERE username IN (${ph})`
  ).bind(...names).all();
  for (const r of results || []) {
    if (r.avatar) avatars[r.username] = r.avatar;
    ids[r.username] = r.id;
  }
  return { avatars, ids };
}

async function homePage(env, request, url, { tag = '' } = {}) {
  const [settings, adminView, user] = await Promise.all([getSettings(env), isAdmin(env, request), currentUser(env, request)]);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const { memos, hasMore } = await listMemos(env, { page, tag, adminView });
  // 点赞/解锁/标签/每条动态的评论原本逐个串行查（一页 10 条就是十几趟），改为全部并行
  const ids = memos.map((m) => m.id);
  const [liked, unlocked, viewOk] = await Promise.all([
    likedSet(env, request, ids),
    unlockedSet(env, request, ids, adminView),
    Promise.all(memos.map((m) => viewUnlocked(env, request, m, settings, adminView))),
  ]);
  const mLocked = memos.map((m) => !!(m.members_only && !adminView && !user));
  const commentsList = await Promise.all(
    memos.map((m, i) => (viewOk[i] && !mLocked[i] ? approvedComments(env, m.id, 500, adminView) : Promise.resolve([])))
  );
  const { avatars: userAvatars, ids: userIds } = await userMapsFor(env, commentsList.flat());
  const dlCounts = await downloadCounts(env, memos);
  const cards = memos.map((m, i) =>
    memoCard(m, settings, { comments: commentsList[i], liked: liked.has(m.id), isAdmin: adminView, user, userAvatars, userIds, filesUnlocked: unlocked.has(m.id), pwLocked: !viewOk[i], membersLocked: mLocked[i], dlCounts, forum: settings.forum_mode === '1' })
  );
  const base = tag ? `/tag/${encodeURIComponent(tag)}` : '/';
  const announce = (settings.announce_text || '').trim();
  const mq = announce
    ? `<div class="marquee"><span class="mq-ico">📢</span><div class="mq-track"><span class="mq-text" style="animation-duration:${Math.max(8, Math.round(announce.length * 0.55))}s">${escapeXml(announce)}</span></div></div>`
    : '';
  const body = `
    ${noticeHtml(url.searchParams.get('c'))}
    ${tag ? `<div class="notice">正在看标签 <b>#${escapeXml(tag)}</b> 的动态，<a href="/">看全部</a></div>` : ''}
    <div class="feed-box">${mq}${cards.join('<div class="memo-sep"></div>') || '<div class="memo">还没有动态。</div>'}${linksBlock(settings)}</div>
    ${pagerHtml(page, hasMore, base)}`;
  const notifCount = user ? await unreadNotifCount(env, user.id) : 0;
  const adminNotifCount = adminView ? await unreadAdminCount(env) : 0;
  return htmlResponse(layout(await withUsage(env, settings), { title: tag ? `#${tag} · ${settings.site_name}` : settings.site_name, body, activeTag: tag, adminView, user, notifCount, adminNotifCount }));
}

async function memoDetail(env, request, id) {
  const settings = await getSettings(env);
  const adminView = await isAdmin(env, request);
  const user = await currentUser(env, request);
  const memo = await env.DB.prepare(
    `SELECT m.*, u.avatar AS author_avatar,
      (SELECT COUNT(*) FROM likes WHERE memo_id = m.id) AS like_count,
      (SELECT COUNT(*) FROM comments WHERE memo_id = m.id AND status='approved' AND flag='') AS comment_count
     FROM memos m LEFT JOIN users u ON u.id = m.author_id WHERE m.id = ?`
  ).bind(id).first();
  if (!memo || (!adminView && (memo.created_at > nowSec() || memo.hidden))) {
    return htmlResponse(layout(settings, { title: '没有找到', body: '<div class="memo">这条动态不存在。</div>', adminView }), 404);
  }
  const url = new URL(request.url);
  const viewOk = await viewUnlocked(env, request, memo, settings, adminView);
  const membersLocked = !!(memo.members_only && !adminView && !user);
  const comments = viewOk && !membersLocked ? await approvedComments(env, id, 500, adminView) : [];
  const liked = await likedSet(env, request, [id]);
  const unlocked = await unlockedSet(env, request, [id], adminView);
  let unlockErr = '';
  if (!viewOk) {
    if (url.searchParams.get('e') === 'lock') {
      unlockErr = `密码错误次数过多，请约 ${escapeXml(url.searchParams.get('m') || '10')} 分钟后再试。`;
    } else if (url.searchParams.get('e')) {
      const n = url.searchParams.get('n');
      unlockErr = `密码不对，请重试。${n ? `（已错 ${escapeXml(n)} 次，错满 5 次将暂停 10 分钟）` : ''}`;
    }
  }
  const { avatars: userAvatars, ids: userIds } = await userMapsFor(env, comments);
  const dlCounts = await downloadCounts(env, [memo]);
  const body = `${noticeHtml(url.searchParams.get('c'))}<div class="feed-box">${memoCard(memo, settings, { comments, liked: liked.has(id), detail: true, isAdmin: adminView, user, userAvatars, userIds, filesUnlocked: unlocked.has(id), pwLocked: !viewOk, membersLocked, unlockErr, dlCounts })}</div>
    <div class="pager"><a href="/">← 回到时间线</a></div>`;
  const pageTitle = memo.title || (viewOk && !membersLocked ? plainTextExcerpt(memo.content_md, 40) : '') || settings.site_name;
  const notifCount = user ? await unreadNotifCount(env, user.id) : 0;
  const adminNotifCount = adminView ? await unreadAdminCount(env) : 0;
  return htmlResponse(layout(await withUsage(env, settings), { title: `${pageTitle} · ${settings.site_name}`, body, adminView, user, notifCount, adminNotifCount }));
}

async function likePost(env, request, id) {
  const memo = await env.DB.prepare('SELECT id, view_password_hash, members_only FROM memos WHERE id = ?').bind(id).first();
  if (!memo) return Response.json({ error: 'not found' }, { status: 404 });
  if (memo.members_only && !(await isAdmin(env, request)) && !(await currentUser(env, request))) {
    return Response.json({ error: 'members' }, { status: 403 });
  }
  if (memo.view_password_hash) {
    const settings = await getSettings(env);
    if (!(await viewUnlocked(env, request, memo, settings, await isAdmin(env, request)))) {
      return Response.json({ error: 'locked' }, { status: 401 });
    }
  }
  const ipHash = await sha256Hex(clientIp(request));
  const existing = await env.DB.prepare('SELECT memo_id FROM likes WHERE memo_id = ? AND ip_hash = ?').bind(id, ipHash).first();
  let liked;
  if (existing) {
    await env.DB.prepare('DELETE FROM likes WHERE memo_id = ? AND ip_hash = ?').bind(id, ipHash).run();
    liked = false;
  } else {
    await env.DB.prepare('INSERT OR IGNORE INTO likes (memo_id, ip_hash, created_at) VALUES (?,?,?)').bind(id, ipHash, nowSec()).run();
    liked = true;
  }
  const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM likes WHERE memo_id = ?').bind(id).first();
  return Response.json({ likes: row ? row.c : 0, liked });
}

async function commentPost(env, request, id) {
  const settings = await getSettings(env);
  const back = `/memo/${id}`;
  if (settings.comments_enabled !== '1') return redirect(`${back}?c=closed`);
  const memo = await env.DB.prepare('SELECT id, view_password_hash, comments_members_only, members_only FROM memos WHERE id = ?').bind(id).first();
  if (!memo) return redirect('/');
  const adminReq = await isAdmin(env, request);
  if (memo.members_only && !adminReq && !(await currentUser(env, request))) {
    return redirect(`${back}?c=membersview`);
  }
  if (memo.view_password_hash && !(await viewUnlocked(env, request, memo, settings, adminReq))) {
    return redirect(back);
  }
  // 身份：管理员用站长昵称；登录的注册用户用其用户名（免验证码）；游客不填昵称、系统随机给「游客XXX」（只验验证码）
  const user = adminReq ? null : await currentUser(env, request);
  if (memo.comments_members_only && !adminReq && !user) return redirect(`${back}?c=members`);
  const form = await request.formData();
  const name = adminReq
    ? String(settings.nickname || '主人').slice(0, 20)
    : user
      ? user.username
      : `游客${100 + Math.floor(Math.random() * 900)}`;
  // 字数上限：注册用户与站长 80 字，游客 50 字
  const content = String(form.get('content') || '').trim().slice(0, user || adminReq ? 80 : 50);
  if (!content) return redirect(`${back}?c=empty`);
  // 回复：以被点的那条评论（reply_target）为准取昵称（库中为准、防伪造），parent 仍挂到它所属的顶层评论下；
  // 老表单没有 reply_target 时退回 parent_id（@ 的就是顶层作者）
  let parentId = 0;
  let replyTo = '';
  const wantTarget = parseInt(String(form.get('reply_target') || '0'), 10);
  const wantParent = parseInt(String(form.get('parent_id') || '0'), 10);
  const pick = wantTarget > 0 ? wantTarget : wantParent;
  if (pick > 0) {
    const p = await env.DB.prepare(
      "SELECT id, parent_id, name FROM comments WHERE id = ? AND memo_id = ? AND status='approved'"
    ).bind(pick, id).first();
    if (p) {
      parentId = p.parent_id ? p.parent_id : p.id;
      replyTo = p.name;
    }
  }
  // 管理员与注册用户免验证码；游客只验图形验证码
  if (!adminReq && !user) {
    const cookies = parseCookies(request);
    const okCap = await verifyCaptcha(settings.site_secret, cookies.mm_captcha, form.get('captcha'));
    if (!okCap) return redirect(`${back}?c=captcha`);
  }
  const ip = clientIp(request);
  const ua = request.headers.get('User-Agent') || '';
  const cf = request.cf || {};
  const geo = JSON.stringify({ country: cf.country || '', region: cf.region || '', city: cf.city || '' });
  const now = nowSec();
  // ---------- 防垃圾（任一命中即进垃圾箱，对提交者照常显示“已提交”） ----------
  let flag = '';
  // 1) 蜜罐：真人看不见的字段被填 = 机器人
  if (String(form.get('website') || '').trim()) flag = 'spam';
  // 2) 提交过快：表单打开后 3 秒内提交 = 机器人
  const ft = parseInt(String(form.get('ft') || '0'), 10);
  if (!flag && ft && now - ft >= 0 && now - ft < 3) flag = 'spam';
  // 3) 关键词：昵称或内容命中后台设置的垃圾词
  if (!flag) {
    const words = String(settings.spam_keywords || '')
      .split(/[,，\n]/)
      .map((w) => w.trim())
      .filter(Boolean);
    const hay = (name + ' ' + content).toLowerCase();
    if (words.some((w) => hay.includes(w.toLowerCase()))) flag = 'spam';
  }
  // 4) 昵称带链接 / 内容链接 ≥2 条
  if (!flag && /https?:\/\//i.test(name)) flag = 'spam';
  if (!flag && (content.match(/https?:\/\//gi) || []).length >= 2) flag = 'spam';
  // 5) 同 IP 1 小时内重复内容
  if (!flag) {
    const dup = await env.DB.prepare(
      'SELECT COUNT(*) AS c FROM comments WHERE ip = ? AND content = ? AND created_at > ?'
    ).bind(ip, content, now - 3600).first();
    if (dup && dup.c >= 1) flag = 'spam';
  }
  // 6) 同 IP 10 分钟内 ≥5 条
  if (!flag) {
    const recent = await env.DB.prepare(
      'SELECT COUNT(*) AS c FROM comments WHERE ip = ? AND created_at > ?'
    ).bind(ip, now - 600).first();
    if (recent && recent.c >= 5) flag = 'spam';
  }
  if (adminReq) flag = '';
  const moderation = settings.comments_moderation !== '0';
  const status = adminReq ? 'approved' : flag ? 'pending' : moderation ? 'pending' : 'approved';
  const adminOnly = !adminReq && form.get('admin_only') ? 1 : 0;
  const ins = await env.DB.prepare(
    'INSERT INTO comments (memo_id, parent_id, reply_to, name, content, status, flag, ip, user_agent, geo, admin_only, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(id, parentId, replyTo, name, content, status, flag, ip, ua.slice(0, 300), geo, adminOnly, now).run();
  // 发表即通过的评论立刻发通知；待审的等管理员通过时再补发（见后台审核）
  if (status === 'approved' && ins && ins.meta && ins.meta.last_row_id) {
    await notifyForComment(env, { id: ins.meta.last_row_id, memo_id: id, parent_id: parentId, reply_to: replyTo, name, content });
  }
  return redirect(`${back}?c=${flag || moderation ? 'commented_mod' : 'commented'}`);
}

// 通知页：仅登录用户可见；打开即把全部通知标为已读（列表里本次仍按未读样式区分显示）
// 消息中心：私信与通知共用铃铛，分两个板块——上「私信」（对话列表，点开进对话页，按私信已读状态计数），
// 下「通知」（评论/回复，打开本页即标已读）。铃铛角标是两边未读之和（见 db.js unreadNotifCount）。
async function notificationsPage(env, request) {
  const settings = await getSettings(env);
  const user = await currentUser(env, request);
  if (!user) return redirect('/login?next=/notifications');
  // —— 私信板块 ——
  const { results: msgs } = await env.DB.prepare(
    'SELECT from_id, from_name, to_id, to_name, content, is_read, created_at FROM messages WHERE (from_id = ? AND del_from = 0) OR (to_id = ? AND del_to = 0) ORDER BY id DESC LIMIT 300'
  ).bind(user.id, user.id).all();
  const convs = new Map();
  let dmUnread = 0;
  for (const m of msgs || []) {
    const oid = m.from_id === user.id ? m.to_id : m.from_id;
    const oname = m.from_id === user.id ? m.to_name : m.from_name;
    if (!convs.has(oid)) convs.set(oid, { oid, oname, last: m, unread: 0 });
    if (m.to_id === user.id && !m.is_read) { convs.get(oid).unread += 1; dmUnread += 1; }
  }
  const dmItems = [...convs.values()].map((c) => `<div class="ntf${c.unread ? ' unread' : ''}">
      <a class="ntf-link" href="/messages/${c.oid}"><span class="ntf-dot"></span>
      <span class="ntf-main"><b>${escapeXml(c.oname)}</b>：${escapeXml(String(c.last.content).slice(0, 40))}${c.unread ? ` <span class="ao-tag">${c.unread} 条未读</span>` : ''}</span>
      <span class="ntf-when">${timeAgo(c.last.created_at)}</span></a>
      <form method="post" action="/dm/delete-conv" onsubmit="return confirm('删除与「${escapeXml(c.oname)}」的对话？只删你这边的记录，对方不受影响。')"><input type="hidden" name="other" value="${c.oid}"><input type="hidden" name="back" value="/notifications"><button class="ntf-del" type="submit" title="删除对话" aria-label="删除对话">✕</button></form>
    </div>`).join('');
  // —— 通知板块 ——（dm 类旧通知行退役，不再单列，私信统一走上面的板块）
  const { results } = await env.DB.prepare(
    "SELECT id, type, memo_id, actor, excerpt, is_read, created_at FROM notifications WHERE user_id = ? AND type != 'dm' ORDER BY id DESC LIMIT 50"
  ).bind(user.id).all();
  const rows = results || [];
  await env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').bind(user.id).run();
  const items = rows.map((n) => {
    const verb = n.type === 'reply' ? '回复了你' : '评论了你的动态';
    return `<div class="ntf${n.is_read ? '' : ' unread'}">
      <a class="ntf-link" href="/memo/${n.memo_id}"><span class="ntf-dot"></span>
      <span class="ntf-main"><b>${escapeXml(n.actor)}</b> ${verb}：${escapeXml(n.excerpt)}</span>
      <span class="ntf-when">${timeAgo(n.created_at)}</span></a>
      <form method="post" action="/notifications/delete"><input type="hidden" name="id" value="${n.id}"><input type="hidden" name="back" value="/notifications"><button class="ntf-del" type="submit" title="删除这条通知" aria-label="删除这条通知">✕</button></form>
    </div>`;
  }).join('');
  const body = `<div class="feed-box"><div class="ntf-head">✉️ 私信</div>${dmItems || '<div class="memo">还没有私信。在评论区或动态上点对方的名字，就能给 TA 发私信。</div>'}
    <div class="ntf-head" style="margin-top:16px">🔔 通知${rows.length ? '<form class="ntf-clear" method="post" action="/notifications/clear" onsubmit="return confirm(\'确定清空全部通知？\')"><input type="hidden" name="back" value="/notifications"><button type="submit">清空</button></form>' : ''}</div>${items || '<div class="memo">暂时没有通知。有人回复你的评论、或评论你发的动态时，会出现在这里。</div>'}</div>
    <div class="pager"><a href="/">← 回到时间线</a></div>`;
  // 通知已在本页标已读，铃铛还剩未读私信数
  return htmlResponse(layout(await withUsage(env, settings), { title: `消息中心 · ${settings.site_name}`, body, user, notifCount: dmUnread }));
}

// ---------------- 私信（注册用户互发 + 与站长往返） ----------------
// 身份：站长为 id 0（名字用站长昵称），注册用户用 users.id；游客不能发也不能收。
async function dmIdentity(env, request) {
  const settings = await getSettings(env);
  if (await isAdmin(env, request)) return { me: { id: 0, name: settings.nickname || '主人' }, settings, adminReq: true, user: null };
  const user = await currentUser(env, request);
  if (user) return { me: { id: user.id, name: user.username }, settings, adminReq: false, user };
  return null;
}

async function dmSend(env, request) {
  const form = await request.formData().catch(() => null);
  const ajax = !!form && form.get('ajax') === '1';
  const back = (form && String(form.get('back') || '')) || '/messages';
  const fail = (msg, status = 400) => ajax
    ? Response.json({ error: msg }, { status })
    : redirect(back + (back.includes('?') ? '&' : '?') + 'e=' + encodeURIComponent(msg));
  const ident = await dmIdentity(env, request);
  if (!ident) return ajax ? Response.json({ error: '请先登录' }, { status: 403 }) : redirect('/login?next=/messages');
  if (!form) return fail('提交失败');
  const to = parseInt(String(form.get('to') || ''), 10);
  const content = String(form.get('content') || '').trim().slice(0, 200);
  if (!content) return fail('内容不能为空');
  if (!Number.isFinite(to) || to < 0) return fail('收信人不对');
  if (to === ident.me.id) return fail('不能给自己发私信');
  let toName;
  if (to === 0) {
    toName = ident.settings.nickname || '主人';
  } else {
    const u = await env.DB.prepare('SELECT id, username, status FROM users WHERE id = ?').bind(to).first();
    if (!u || u.status) return fail('对方账号不存在或已停用');
    toName = u.username;
  }
  const now = nowSec();
  if (!ident.adminReq) {
    // 普通用户每封都要过图形验证码（用户指定），并限制频率防骚扰
    const cookies = parseCookies(request);
    const okCap = await verifyCaptcha(ident.settings.site_secret, cookies.mm_captcha, form.get('captcha'));
    if (!okCap) return fail('验证码不对');
    const recent = await env.DB.prepare('SELECT COUNT(*) AS c FROM messages WHERE from_id = ? AND created_at > ?').bind(ident.me.id, now - 60).first();
    if (recent && recent.c >= 5) return fail('发送太频繁，请稍后再试');
  }
  await env.DB.prepare('INSERT INTO messages (from_id, from_name, to_id, to_name, content, created_at) VALUES (?,?,?,?,?,?)')
    .bind(ident.me.id, ident.me.name, to, toName, content, now).run();
  // 私信不再写 notifications：铃铛角标与消息中心的「私信」板块直接按 messages 未读数算（见 unreadNotifCount / notificationsPage）
  return ajax ? Response.json({ ok: true }) : redirect(back);
}

async function messagesPage(env, request) {
  const ident = await dmIdentity(env, request);
  if (!ident) return redirect('/login?next=/messages');
  // 注册用户的对话列表已并入铃铛消息中心；本页只留给站长（站长没有前台铃铛）
  if (!ident.adminReq) return redirect('/notifications');
  const meId = ident.me.id;
  const { results } = await env.DB.prepare(
    'SELECT from_id, from_name, to_id, to_name, content, is_read, created_at FROM messages WHERE (from_id = ? AND del_from = 0) OR (to_id = ? AND del_to = 0) ORDER BY id DESC LIMIT 300'
  ).bind(meId, meId).all();
  const convs = new Map();
  let dmUnread = 0;
  for (const m of results || []) {
    const oid = m.from_id === meId ? m.to_id : m.from_id;
    const oname = m.from_id === meId ? m.to_name : m.from_name;
    if (!convs.has(oid)) convs.set(oid, { oid, oname, last: m, unread: 0 });
    if (m.to_id === meId && !m.is_read) { convs.get(oid).unread += 1; dmUnread += 1; }
  }
  const items = [...convs.values()].map((c) => `<div class="ntf${c.unread ? ' unread' : ''}">
      <a class="ntf-link" href="/messages/${c.oid}"><span class="ntf-dot"></span>
      <span class="ntf-main"><b>${escapeXml(c.oname)}</b>：${escapeXml(String(c.last.content).slice(0, 40))}${c.unread ? ` <span class="ao-tag">${c.unread} 条未读</span>` : ''}</span>
      <span class="ntf-when">${timeAgo(c.last.created_at)}</span></a>
      <form method="post" action="/dm/delete-conv" onsubmit="return confirm('删除与「${escapeXml(c.oname)}」的对话？只删你这边的记录，对方不受影响。')"><input type="hidden" name="other" value="${c.oid}"><input type="hidden" name="back" value="/messages"><button class="ntf-del" type="submit" title="删除对话" aria-label="删除对话">✕</button></form>
    </div>`).join('');
  // —— 站长通知板块（user_id 0：回复站长、评论站长动态）——打开本页即标已读
  const { results: nrows } = await env.DB.prepare(
    "SELECT id, type, memo_id, actor, excerpt, is_read, created_at FROM notifications WHERE user_id = 0 AND type != 'dm' ORDER BY id DESC LIMIT 50"
  ).all();
  await env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = 0 AND is_read = 0').run();
  const nItems = (nrows || []).map((n) => {
    const verb = n.type === 'reply' ? '回复了你' : '评论了你的动态';
    return `<div class="ntf${n.is_read ? '' : ' unread'}">
      <a class="ntf-link" href="/memo/${n.memo_id}"><span class="ntf-dot"></span>
      <span class="ntf-main"><b>${escapeXml(n.actor)}</b> ${verb}：${escapeXml(n.excerpt)}</span>
      <span class="ntf-when">${timeAgo(n.created_at)}</span></a>
      <form method="post" action="/notifications/delete"><input type="hidden" name="id" value="${n.id}"><input type="hidden" name="back" value="/messages"><button class="ntf-del" type="submit" title="删除这条通知" aria-label="删除这条通知">✕</button></form>
    </div>`;
  }).join('');
  const body = `<div class="feed-box"><div class="ntf-head">✉️ 私信</div>${items || '<div class="memo">还没有人给你发私信。</div>'}
    <div class="ntf-head" style="margin-top:16px">🔔 通知${(nrows || []).length ? '<form class="ntf-clear" method="post" action="/notifications/clear" onsubmit="return confirm(\'确定清空全部通知？\')"><input type="hidden" name="back" value="/messages"><button type="submit">清空</button></form>' : ''}</div>${nItems || '<div class="memo">暂时没有通知。有人回复你的评论、或评论你的动态时，会出现在这里。</div>'}</div>
    <div class="pager"><a href="/">← 回到时间线</a></div>`;
  return htmlResponse(layout(await withUsage(env, ident.settings), { title: `消息中心 · ${ident.settings.site_name}`, body, adminView: true, user: null, notifCount: 0, adminNotifCount: dmUnread }));
}

async function threadPage(env, request, otherId) {
  const ident = await dmIdentity(env, request);
  if (!ident) return redirect('/login?next=/messages');
  const meId = ident.me.id;
  if (otherId === meId) return redirect('/messages');
  let otherName;
  if (otherId === 0) {
    otherName = ident.settings.nickname || '主人';
  } else {
    const u = await env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(otherId).first();
    if (!u) return redirect('/messages');
    otherName = u.username;
  }
  const { results } = await env.DB.prepare(
    'SELECT from_id, content, created_at FROM messages WHERE (from_id = ? AND to_id = ? AND del_from = 0) OR (from_id = ? AND to_id = ? AND del_to = 0) ORDER BY id ASC LIMIT 200'
  ).bind(meId, otherId, otherId, meId).all();
  await env.DB.prepare('UPDATE messages SET is_read = 1 WHERE to_id = ? AND from_id = ? AND is_read = 0').bind(meId, otherId).run();
  const bubbles = (results || []).map((m) => {
    const mine = m.from_id === meId;
    return `<div class="msg-row${mine ? ' me' : ''}"><div><div class="msg-bub">${escapeXml(m.content)}</div><div class="msg-when">${timeAgo(m.created_at)}</div></div></div>`;
  }).join('');
  const url = new URL(request.url);
  const err = url.searchParams.get('e');
  const capRow = ident.adminReq ? '' : `<div class="row"><img class="cap" alt="验证码" title="点图刷新" onclick="refreshCap(this)" src="/captcha?t=${Date.now()}">
              <input name="captcha" maxlength="4" placeholder="验证码" required style="max-width:110px"></div>`;
  const body = `<div class="feed-box"><div class="ntf-head">与 ${escapeXml(otherName)} 的私信<form class="ntf-clear" method="post" action="/dm/delete-conv" onsubmit="return confirm('删除与「${escapeXml(otherName)}」的对话？只删你这边的记录，对方不受影响。')"><input type="hidden" name="other" value="${otherId}"><button type="submit">删除对话</button></form></div>
    ${err ? `<div class="notice">${escapeXml(err)}</div>` : ''}
    ${bubbles || '<div class="memo">还没有往来消息，在下面给 TA 发第一条吧。</div>'}
    <form class="th-form" method="post" action="/dm/send">
      <input type="hidden" name="to" value="${otherId}">
      <input type="hidden" name="back" value="/messages/${otherId}">
      ${capRow}
      <textarea name="content" rows="3" maxlength="200" placeholder="写下你想说的话（最多 200 字）" required></textarea>
      <div style="margin-top:8px"><button class="btn" type="submit">发送</button></div>
    </form></div>
    <div class="pager"><a href="${ident.adminReq ? '/messages' : '/notifications'}">← ${ident.adminReq ? '全部私信' : '消息中心'}</a></div>`;
  const notifCount = ident.user ? await unreadNotifCount(env, ident.user.id) : 0;
  const adminNotifCount = ident.adminReq ? await unreadAdminCount(env) : 0;
  return htmlResponse(layout(await withUsage(env, ident.settings), { title: `与 ${otherName} 的私信 · ${ident.settings.site_name}`, body, adminView: ident.adminReq, user: ident.user, notifCount, adminNotifCount }));
}

// 删除对话：只删自己这一侧（我发的置 del_from、我收的置 del_to），对方完全不受影响；
// 对方再发新消息时，对话会带着新消息重新出现在我的列表里（旧消息仍保持隐藏）。
async function convDelete(env, request) {
  const ident = await dmIdentity(env, request);
  if (!ident) return redirect('/login?next=/notifications');
  const form = await request.formData().catch(() => null);
  const other = parseInt(String((form && form.get('other')) || ''), 10);
  if (Number.isFinite(other) && other >= 0 && other !== ident.me.id) {
    await env.DB.prepare('UPDATE messages SET del_from = 1 WHERE from_id = ? AND to_id = ?').bind(ident.me.id, other).run();
    await env.DB.prepare('UPDATE messages SET del_to = 1 WHERE to_id = ? AND from_id = ?').bind(ident.me.id, other).run();
  }
  const back = (form && String(form.get('back') || '')) || (ident.adminReq ? '/messages' : '/notifications');
  return redirect(back);
}

// 通知身份：站长为 0，注册用户为 users.id（通知删除/清空共用）
async function notifOwner(env, request) {
  if (await isAdmin(env, request)) return 0;
  const u = await currentUser(env, request);
  return u ? u.id : null;
}

async function notifDelete(env, request) {
  const uid = await notifOwner(env, request);
  if (uid === null) return redirect('/login?next=/notifications');
  const form = await request.formData().catch(() => null);
  const id = parseInt(String((form && form.get('id')) || ''), 10);
  if (Number.isFinite(id)) {
    await env.DB.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').bind(id, uid).run();
  }
  const back = (form && String(form.get('back') || '')) || (uid === 0 ? '/messages' : '/notifications');
  return redirect(back);
}

async function notifClear(env, request) {
  const uid = await notifOwner(env, request);
  if (uid === null) return redirect('/login?next=/notifications');
  await env.DB.prepare('DELETE FROM notifications WHERE user_id = ?').bind(uid).run();
  const form = await request.formData().catch(() => null);
  const back = (form && String(form.get('back') || '')) || (uid === 0 ? '/messages' : '/notifications');
  return redirect(back);
}

// 附件下载：经 /dl/<key> 下载时计数一次（直链 /media 不计数），并强制以附件形式下载
async function dlGet(env, key) {
  if (!key || key.includes('..')) return new Response('Not Found', { status: 404 });
  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response('Not Found', { status: 404 });
  try {
    await env.DB.prepare(
      'INSERT INTO downloads (file_key, cnt, updated_at) VALUES (?, 1, ?) ON CONFLICT(file_key) DO UPDATE SET cnt = cnt + 1, updated_at = excluded.updated_at'
    ).bind(key, nowSec()).run();
  } catch { /* 计数失败不影响下载 */ }
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('ETag', obj.httpEtag);
  const name = key.split('/').pop() || 'file';
  headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(obj.body, { headers });
}

// 一批动态里全部上传附件的下载次数映射（file_key -> 次数），供附件卡片显示
async function downloadCounts(env, memos) {
  const keys = new Set();
  for (const m of memos || []) {
    let media = [];
    try { media = JSON.parse(m.media || '[]'); } catch { media = []; }
    for (const it of media) {
      if (it && it.type === 'file' && typeof it.url === 'string' && it.url.startsWith('/media/uploads/')) {
        keys.add(it.url.slice('/media/'.length));
      }
    }
  }
  const map = {};
  if (!keys.size) return map;
  const arr = [...keys];
  try {
    const { results } = await env.DB.prepare(
      `SELECT file_key, cnt FROM downloads WHERE file_key IN (${arr.map(() => '?').join(',')})`
    ).bind(...arr).all();
    for (const r of results || []) map[r.file_key] = r.cnt;
  } catch { /* 表未就绪时按 0 次显示 */ }
  return map;
}

async function feed(env) {
  const settings = await getSettings(env);
  const { memos } = await listMemos(env, { page: 1 });
  const items = memos
    .map((m) => {
      const text = m.title || (m.members_only ? '（仅注册用户可见）' : m.view_password_hash ? '（密码保护）' : m.content_gated ? '（回复后可见）' : plainTextExcerpt(m.content_md, 120) || '（图片动态）');
      const desc = m.members_only ? '本动态仅注册用户可见，请登录网站查看' : m.view_password_hash ? '本动态已设密码保护，请到网站输入密码查看' : m.content_gated ? '本动态内容需回复后可见' : plainTextExcerpt(m.content_md, 300);
      return `<item><title>${escapeXml(text)}</title><link>/memo/${m.id}</link><guid>/memo/${m.id}</guid><pubDate>${new Date(m.created_at * 1000).toUTCString()}</pubDate><description>${escapeXml(desc)}</description></item>`;
    })
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${escapeXml(settings.site_name)}</title><link>/</link><description>${escapeXml(settings.signature || '')}</description>${items}</channel></rss>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}

async function mediaGet(env, ctx, request, key) {
  // 边缘缓存：命中时不再回源 R2。site/ 品牌资源长期存；uploads/ 边缘只存 1 天（彻底删除动态时边缘副本最多残留 1 天，浏览器侧仍是 immutable 长缓存）；视频不进缓存（分段播放）
  const cache = caches.default;
  try {
    const hit = await cache.match(request);
    if (hit) return hit;
  } catch { /* 缓存不可用就回源 */ }
  const obj = await env.MEDIA.get(key);
  if (!obj) return new Response('Not Found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('ETag', obj.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  const resp = new Response(obj.body, { headers });
  const type = headers.get('Content-Type') || '';
  if (!type.startsWith('video/')) {
    const copy = resp.clone();
    if (!key.startsWith('site/')) copy.headers.set('Cache-Control', 'public, max-age=86400');
    ctx.waitUntil(cache.put(request, copy).catch(() => {}));
  }
  return resp;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    try {
      await initDb(env);

      // 全站密码门：开启后，未解锁的访客只能打开输密码页；
      // 后台路径、输密码页与站点图标不受影响，管理员登录状态直接放行。
      if (!path.startsWith('/admin') && path !== '/gate' && path !== '/favicon.png' && path !== '/favicon.ico') {
        const gs = await getSettings(env);
        if (gs.site_lock === '1' && gs.site_password_hash) {
          if (!(await isAdmin(env, request)) && !gateCookieOk(request, gs)) {
            if (method === 'GET') return redirect('/gate?next=' + encodeURIComponent(path + (url.search || '')));
            return new Response('本站已开启访问密码，请先在浏览器中打开首页输入密码后再试。', { status: 401 });
          }
        }
      }

      // 前台页面浏览计入到访人数（不阻塞响应）
      if (method === 'GET' && (path === '/' || path.startsWith('/memo/') || path.startsWith('/tag/'))) {
        ctx.waitUntil(recordVisit(env, request));
      }

      if (path === '/captcha' && method === 'GET') {
        const settings = await getSettings(env);
        const cap = await createCaptcha(settings.site_secret);
        return new Response(cap.svg, {
          headers: {
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'Cache-Control': 'no-store',
            'Set-Cookie': `mm_captcha=${cap.cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
          },
        });
      }
      if ((path === '/favicon.png' || path === '/favicon.ico') && method === 'GET') {
        return mediaGet(env, ctx, request, 'site/favicon.png');
      }
      if (path.startsWith('/media/') && method === 'GET') {
        return mediaGet(env, ctx, request, decodeURIComponent(path.slice('/media/'.length)));
      }
      if (path.startsWith('/dl/') && method === 'GET') {
        return dlGet(env, decodeURIComponent(path.slice('/dl/'.length)));
      }
      if (path === '/feed.xml' && method === 'GET') return feed(env);

      // ---------- 后台 ----------
      if (path === '/admin/setup') {
        return method === 'GET' ? admin.setupPage(env, url) : admin.setupPost(env, request);
      }
      if (path === '/admin/login') {
        return method === 'GET' ? admin.loginPage(env, url) : admin.loginPost(env, request);
      }
      if (path === '/admin/logout') return admin.logout(env, request);
      if (path === '/admin' || path.startsWith('/admin/')) {
        const settings = await getSettings(env);
        if (!settings.admin_password_hash) return redirect('/admin/setup');
        if (!(await isAdmin(env, request))) return redirect('/admin/login');
        if (path === '/admin' && method === 'GET') return admin.dashboard(env);
        if (path === '/admin/memos/new') {
          return method === 'GET'
            ? admin.formPage(env, null)
            : admin.memoSave(env, request, null);
        }
        let m;
        if ((m = path.match(/^\/admin\/memos\/(\d+)\/edit$/))) {
          if (method === 'GET') return admin.formPage(env, Number(m[1]));
          return admin.memoSave(env, request, Number(m[1]));
        }
        if ((m = path.match(/^\/admin\/memos\/(\d+)\/delete$/)) && method === 'POST') {
          return admin.memoDelete(env, request, Number(m[1]));
        }
        if (path === '/admin/trash' && method === 'GET') return admin.trashPage(env, url);
        if (path === '/admin/trash/settings' && method === 'POST') return admin.trashSettings(env, request);
        if (path === '/admin/trash/empty' && method === 'POST') return admin.trashEmpty(env);
        if ((m = path.match(/^\/admin\/trash\/(\d+)\/(restore|purge)$/)) && method === 'POST') {
          return admin.trashAction(env, Number(m[1]), m[2]);
        }
        if (path === '/admin/users' && method === 'GET') return admin.usersPage(env);
        if ((m = path.match(/^\/admin\/users\/(\d+)\/(delete|disable|enable)$/)) && method === 'POST') {
          if (m[2] === 'delete') return admin.userDelete(env, request, Number(m[1]));
          return admin.userSetStatus(env, request, Number(m[1]), m[2] === 'disable' ? 1 : 0);
        }
        if (path === '/admin/comments' && method === 'GET') return admin.commentsPage(env, url);
        if ((m = path.match(/^\/admin\/comments\/(\d+)\/(approve|spam|delete|hide|unhide)$/)) && method === 'POST') {
          return admin.commentAction(env, request, Number(m[1]), m[2]);
        }
        if (path === '/admin/settings' && method === 'GET') return admin.settingsPage(env, url);
        if (path === '/admin/settings' && method === 'POST') return admin.settingsSave(env, request);
        if (path === '/admin/settings/password' && method === 'POST') return admin.passwordChange(env, request);
        if (path === '/admin/settings/gate' && method === 'POST') return admin.gateSettingsSave(env, request);
        if (path === '/admin/upload' && method === 'POST') return admin.upload(env, request);
        if (path === '/admin/export' && method === 'GET') return admin.exportAll(env);
        if (path === '/admin/export-zip' && method === 'GET') return admin.exportZip(env);
        if (path === '/admin/import' && method === 'GET') return admin.importPage(env, url);
        if (path === '/admin/import' && method === 'POST') return admin.importRestore(env, request);
        return redirect('/admin');
      }

      // ---------- 前台 ----------
      if (path === '/gate') {
        return method === 'GET' ? admin.gatePage(env, url) : admin.gatePost(env, request);
      }
      if (path === '/register') {
        return method === 'GET' ? admin.userRegisterPage(env, url) : admin.userRegisterPost(env, request);
      }
      if (path === '/login') {
        return method === 'GET' ? admin.userLoginPage(env, url) : admin.userLoginPost(env, request);
      }
      if (path === '/logout' && method === 'GET') return admin.userLogout(env, request);
      if (path === '/notifications' && method === 'GET') return notificationsPage(env, request);
      if (path === '/dm/send' && method === 'POST') return dmSend(env, request);
      if (path === '/dm/delete-conv' && method === 'POST') return convDelete(env, request);
      if (path === '/notifications/delete' && method === 'POST') return notifDelete(env, request);
      if (path === '/notifications/clear' && method === 'POST') return notifClear(env, request);
      if (path === '/messages' && method === 'GET') return messagesPage(env, request);
      { const dmM = path.match(/^\/messages\/(\d+)$/); if (dmM && method === 'GET') return threadPage(env, request, Number(dmM[1])); }
      if (path === '/post/new') {
        return method === 'GET' ? admin.userPostPage(env, request, null) : admin.userPostSave(env, request, null);
      }
      if (path === '/upload' && method === 'POST') {
        if (await isAdmin(env, request)) return admin.upload(env, request);
        if (await currentUser(env, request)) {
          // 投稿上传限制（服务端强制）：仅图片或压缩包，单个 ≤500KB
          const form = await request.clone().formData().catch(() => null);
          const file = form && form.get('file');
          if (!file || typeof file === 'string' || !file.size) {
            return Response.json({ error: '没有文件' }, { status: 400 });
          }
          const lname = (file.name || '').toLowerCase();
          const isImg = (file.type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic)$/.test(lname);
          const isArc = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/.test(lname);
          if (!isImg && !isArc) return Response.json({ error: '投稿只能上传图片或压缩包' }, { status: 400 });
          if (file.size > 500 * 1024) return Response.json({ error: '投稿文件不能超过 500KB' }, { status: 400 });
          return admin.upload(env, request);
        }
        return Response.json({ error: '请先登录' }, { status: 403 });
      }
      if (path === '/' && method === 'GET') return homePage(env, request, url);
      let m;
      if ((m = path.match(/^\/tag\/(.+)$/)) && method === 'GET') {
        return homePage(env, request, url, { tag: decodeURIComponent(m[1]) });
      }
      if ((m = path.match(/^\/memo\/(\d+)$/)) && method === 'GET') {
        return memoDetail(env, request, Number(m[1]));
      }
      if ((m = path.match(/^\/memo\/(\d+)\/like$/)) && method === 'POST') {
        return likePost(env, request, Number(m[1]));
      }
      if ((m = path.match(/^\/memo\/(\d+)\/comment$/)) && method === 'POST') {
        return commentPost(env, request, Number(m[1]));
      }
      if ((m = path.match(/^\/memo\/(\d+)\/unlock$/)) && method === 'POST') {
        return admin.memoUnlock(env, request, Number(m[1]));
      }
      if ((m = path.match(/^\/post\/(\d+)\/edit$/))) {
        return method === 'GET'
          ? admin.userPostPage(env, request, Number(m[1]))
          : admin.userPostSave(env, request, Number(m[1]));
      }
      if ((m = path.match(/^\/post\/(\d+)\/delete$/)) && method === 'POST') {
        return admin.userPostDelete(env, request, Number(m[1]));
      }
      return new Response('Not Found', { status: 404 });
    } catch (err) {
      return new Response('服务器开小差了：' + (err && err.message ? err.message : 'unknown'), { status: 500 });
    }
  },
};
