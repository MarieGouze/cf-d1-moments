// cf-d1-moments：极简朋友圈（仿 kingwrcy/moments 版面，Cloudflare Workers + D1 + R2 重写）
import { initDb, getSettings, isAdmin } from './db.js';
import { layout, memoCard, tagChipsScript, linksBlock, pagerHtml, noticeHtml, timeAgo } from './render.js';
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
    `SELECT m.*,
      (SELECT COUNT(*) FROM likes WHERE memo_id = m.id) AS like_count,
      (SELECT COUNT(*) FROM comments WHERE memo_id = m.id AND status='approved' AND flag='') AS comment_count
     FROM memos m ${where}
     ORDER BY m.pinned DESC, m.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...binds, PAGE_SIZE + 1, offset).all();
  const rows = results || [];
  const hasMore = rows.length > PAGE_SIZE;
  return { memos: rows.slice(0, PAGE_SIZE), hasMore };
}

async function approvedComments(env, memoId, limit = 500) {
  const { results } = await env.DB.prepare(
    "SELECT id, parent_id, reply_to, name, content, created_at FROM comments WHERE memo_id = ? AND status='approved' AND flag='' ORDER BY created_at ASC LIMIT ?"
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

async function allTags(env, adminView) {
  const now = nowSec();
  const sql = adminView
    ? "SELECT tags FROM memos WHERE tags != ''"
    : "SELECT tags FROM memos WHERE tags != '' AND created_at <= ? AND hidden = 0";
  const stmt = adminView ? env.DB.prepare(sql) : env.DB.prepare(sql).bind(now);
  const { results } = await stmt.all();
  const map = new Map();
  for (const r of results || []) {
    for (const t of String(r.tags).split(',').map((x) => x.trim()).filter(Boolean)) {
      map.set(t, (map.get(t) || 0) + 1);
    }
  }
  return [...map.entries()].map(([tag, c]) => ({ tag, c })).sort((a, b) => b.c - a.c).slice(0, 20);
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

// 「附件回复后可见」的解锁集合：管理员全解锁；游客按评论 IP 判断（在该动态下留过言即解锁）
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
      `SELECT DISTINCT memo_id FROM comments WHERE ip = ? AND flag = '' AND memo_id IN (${ph})`
    ).bind(ip, ...memoIds).all();
    for (const r of rows.results || []) out.add(r.memo_id);
  } catch { /* 查询失败按未解锁处理 */ }
  return out;
}

async function homePage(env, request, url, { tag = '' } = {}) {
  const [settings, adminView] = await Promise.all([getSettings(env), isAdmin(env, request)]);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const { memos, hasMore } = await listMemos(env, { page, tag, adminView });
  // 点赞/解锁/标签/每条动态的评论原本逐个串行查（一页 10 条就是十几趟），改为全部并行
  const ids = memos.map((m) => m.id);
  const [liked, unlocked, tags, commentsList] = await Promise.all([
    likedSet(env, request, ids),
    unlockedSet(env, request, ids, adminView),
    allTags(env, adminView),
    Promise.all(memos.map((m) => approvedComments(env, m.id, 500))),
  ]);
  const cards = memos.map((m, i) =>
    memoCard(m, settings, { comments: commentsList[i], liked: liked.has(m.id), isAdmin: adminView, filesUnlocked: unlocked.has(m.id) })
  );
  const base = tag ? `/tag/${encodeURIComponent(tag)}` : '/';
  const body = `
    ${noticeHtml(url.searchParams.get('c'))}
    ${tag ? `<div class="notice">正在看标签 <b>#${escapeXml(tag)}</b> 的动态，<a href="/">看全部</a></div>` : ''}
    <div class="feed-box">${cards.join('<div class="memo-sep"></div>') || '<div class="memo">还没有动态。</div>'}${linksBlock(settings)}</div>
    ${pagerHtml(page, hasMore, base)}
    ${tagChipsScript(tags, tag)}`;
  return htmlResponse(layout(await withUsage(env, settings), { title: tag ? `#${tag} · ${settings.site_name}` : settings.site_name, body, activeTag: tag, adminView }));
}

async function memoDetail(env, request, id) {
  const settings = await getSettings(env);
  const adminView = await isAdmin(env, request);
  const memo = await env.DB.prepare(
    `SELECT m.*,
      (SELECT COUNT(*) FROM likes WHERE memo_id = m.id) AS like_count,
      (SELECT COUNT(*) FROM comments WHERE memo_id = m.id AND status='approved' AND flag='') AS comment_count
     FROM memos m WHERE m.id = ?`
  ).bind(id).first();
  if (!memo || (!adminView && (memo.created_at > nowSec() || memo.hidden))) {
    return htmlResponse(layout(settings, { title: '没有找到', body: '<div class="memo">这条动态不存在。</div>', adminView }), 404);
  }
  const comments = await approvedComments(env, id, 500);
  const liked = await likedSet(env, request, [id]);
  const unlocked = await unlockedSet(env, request, [id], adminView);
  const url = new URL(request.url);
  const body = `${noticeHtml(url.searchParams.get('c'))}<div class="feed-box">${memoCard(memo, settings, { comments, liked: liked.has(id), detail: true, isAdmin: adminView, filesUnlocked: unlocked.has(id) })}</div>
    <div class="pager"><a href="/">← 回到时间线</a></div>`;
  return htmlResponse(layout(await withUsage(env, settings), { title: `${memo.title || plainTextExcerpt(memo.content_md, 40) || settings.site_name} · ${settings.site_name}`, body, adminView }));
}

async function likePost(env, request, id) {
  const memo = await env.DB.prepare('SELECT id FROM memos WHERE id = ?').bind(id).first();
  if (!memo) return Response.json({ error: 'not found' }, { status: 404 });
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
  const memo = await env.DB.prepare('SELECT id FROM memos WHERE id = ?').bind(id).first();
  if (!memo) return redirect('/');
  const form = await request.formData();
  const name = String(form.get('name') || '').replace(/["'<>]/g, '').trim().slice(0, 20);
  const content = String(form.get('content') || '').trim().slice(0, 500);
  if (!name || !content) return redirect(`${back}?c=empty`);
  // 回复：parent_id 必须指向同一动态下已通过的评论，reply_to 以库中昵称为准
  let parentId = 0;
  let replyTo = '';
  const wantParent = parseInt(String(form.get('parent_id') || '0'), 10);
  if (wantParent > 0) {
    const p = await env.DB.prepare(
      "SELECT id, parent_id, name FROM comments WHERE id = ? AND memo_id = ? AND status='approved'"
    ).bind(wantParent, id).first();
    if (p) {
      parentId = p.parent_id ? p.parent_id : p.id;
      replyTo = p.name;
    }
  }
  // 管理员本人评论：免验证码、免防垃圾判定、直接通过
  const adminReq = await isAdmin(env, request);
  if (!adminReq) {
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
  await env.DB.prepare(
    'INSERT INTO comments (memo_id, parent_id, reply_to, name, content, status, flag, ip, user_agent, geo, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(id, parentId, replyTo, name, content, status, flag, ip, ua.slice(0, 300), geo, now).run();
  return redirect(`${back}?c=${flag || moderation ? 'commented_mod' : 'commented'}`);
}

async function feed(env) {
  const settings = await getSettings(env);
  const { memos } = await listMemos(env, { page: 1 });
  const items = memos
    .map((m) => {
      const text = m.title || (m.content_gated ? '（回复后可见）' : plainTextExcerpt(m.content_md, 120) || '（图片动态）');
      const desc = m.content_gated ? '本动态内容需回复后可见' : plainTextExcerpt(m.content_md, 300);
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
        return mediaGet(env, 'site/favicon.png');
      }
      if (path.startsWith('/media/') && method === 'GET') {
        return mediaGet(env, ctx, request, decodeURIComponent(path.slice('/media/'.length)));
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
        if (path === '/admin/comments' && method === 'GET') return admin.commentsPage(env, url);
        if ((m = path.match(/^\/admin\/comments\/(\d+)\/(approve|spam|delete|hide|unhide)$/)) && method === 'POST') {
          return admin.commentAction(env, request, Number(m[1]), m[2]);
        }
        if (path === '/admin/settings' && method === 'GET') return admin.settingsPage(env, url);
        if (path === '/admin/settings' && method === 'POST') return admin.settingsSave(env, request);
        if (path === '/admin/settings/password' && method === 'POST') return admin.passwordChange(env, request);
        if (path === '/admin/upload' && method === 'POST') return admin.upload(env, request);
        if (path === '/admin/export' && method === 'GET') return admin.exportAll(env);
        if (path === '/admin/export-zip' && method === 'GET') return admin.exportZip(env);
        if (path === '/admin/import' && method === 'GET') return admin.importPage(env, url);
        if (path === '/admin/import' && method === 'POST') return admin.importRestore(env, request);
        return redirect('/admin');
      }

      // ---------- 前台 ----------
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
      return new Response('Not Found', { status: 404 });
    } catch (err) {
      return new Response('服务器开小差了：' + (err && err.message ? err.message : 'unknown'), { status: 500 });
    }
  },
};
