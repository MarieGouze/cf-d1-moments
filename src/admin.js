// 后台：初始化设置密码、登录、发动态、评论审核、站点设置、R2 上传、导出备份。
// 管理员密码哈希只存 D1 settings（admin_password_hash），部署不会冲掉。
import {
  getSettings, setSetting, createSession, destroySession, isAdmin,
  sessionCookie, clearSessionCookie, parseTags, parseJsonSafe, effectiveAdminHash, gateCookie,
} from './db.js';
import { sha256Hex, randomToken, nowSec, escapeHtml as esc, htmlResponse, redirect, clientIp } from './utils.js';
import { renderContent, excerptOf } from './richtext.js';

const ACSS = `
*{box-sizing:border-box}
body{margin:0;background:#f4f4f6;color:#1f2329;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.box{max-width:860px;margin:0 auto;padding:18px 14px 50px}
.card{background:#fff;border-radius:14px;padding:18px;margin:14px 0;box-shadow:0 1px 3px rgba(0,0,0,.05)}
h1{font-size:20px} h2{font-size:16px;margin:4px 0 12px}
input,textarea,select{width:100%;padding:9px 11px;border:1px solid #ddd;border-radius:8px;font-size:14px;margin:5px 0 12px;font-family:inherit;background:#fff}
input:not([type=checkbox]),select{height:38px}
label{font-size:13px;color:#555;font-weight:600}
.btn{background:#1f2329;color:#fff;border:0;border-radius:8px;padding:9px 20px;font-size:14px;cursor:pointer}
.btn.ghost{background:#eef0f4;color:#1f2329}
.btn.danger{background:#d33}
a{color:#576b95;text-decoration:none}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.nav a{margin-right:14px;font-size:14px}
.err{background:#fdecec;border:1px solid #f3c2c2;color:#8c2323;border-radius:10px;padding:10px 14px;margin:12px 0;font-size:14px}
.ok{background:#e9f7e9;border:1px solid #bfe3bf;color:#1c5c1c;border-radius:10px;padding:10px 14px;margin:12px 0;font-size:14px}
table{width:100%;border-collapse:collapse;font-size:14px}
td,th{padding:8px 6px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}
.hint{font-size:12px;color:#888}
.thumbs{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0}
.thumbs .th{position:relative;width:76px;height:76px;border-radius:8px;overflow:hidden;background:#eee}
.thumbs .th img,.thumbs .th video{width:100%;height:100%;object-fit:cover}
.thumbs .th button{position:absolute;top:2px;right:2px;background:rgba(0,0,0,.6);color:#fff;border:0;border-radius:50%;width:20px;height:20px;cursor:pointer;line-height:1}
.thumbs .th.file{width:auto;height:auto;padding:8px 10px;font-size:12px;display:flex;align-items:center;gap:6px;background:#eef0f4}
.thumbs .th.file button{position:static;background:#999}
.editor-wrap{border:1px solid #ddd;border-radius:10px;overflow:hidden;margin:5px 0 12px;background:#fff}
.editor-toolbar{display:flex;flex-wrap:wrap;gap:2px;align-items:center;padding:6px 8px;border-bottom:1px solid #eee;background:#fafafa}
.editor-toolbar button{background:none;border:0;font-size:15px;padding:5px 7px;cursor:pointer;border-radius:6px;color:#333}
.editor-toolbar button:hover{background:#eee}
.editor-toolbar select{width:auto;margin:0;padding:4px}
.tb-sep{width:1px;height:18px;background:#ddd;margin:0 4px}
.tb-color{position:relative;cursor:pointer;padding:4px 6px;font-weight:700;margin:0}
.tb-color input{position:absolute;opacity:0;width:100%;height:100%;left:0;top:0;cursor:pointer;margin:0;padding:0}
.tc-hl{background:#fff3a3;padding:0 3px;border-radius:3px}
.tb-on{background:#dde3ee !important}
.emoji-panel{padding:8px;border-bottom:1px solid #eee}
.emoji-btn{background:none;border:0;font-size:18px;cursor:pointer;padding:3px}
.editor-body{min-height:150px;padding:12px;font-size:15px;line-height:1.65;outline:none}
.editor-body:empty:before{content:attr(data-placeholder);color:#aaa}
.editor-body img{max-width:100%}
.source-area{width:100%;min-height:150px;font-family:ui-monospace,monospace;font-size:13px;border:0;margin:0}
`;

function page(title, body) {
  return htmlResponse(
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${ACSS}</style></head><body><div class="box">${body}</div></body></html>`
  );
}

function nav(active) {
  return `<div class="card nav"><a href="/admin">📋 动态管理</a><a href="/admin/memos/new">✏️ 发布动态</a><a href="/admin/comments">💬 评论审核</a><a href="/admin/trash">🗑 垃圾桶</a><a href="/admin/settings">⚙️ 站点设置</a><a href="/admin/export">⬇️ 导出备份</a><a href="/admin/export-zip">📦 完整备份（含文件）</a><a href="/admin/import">📥 恢复备份</a><a href="/" target="_blank">🌐 查看站点</a><a href="/admin/logout">退出</a></div>`;
}

async function requireAdmin(env, request) {
  return isAdmin(env, request);
}

// ---------------- 初始化（一次性设置链接） ----------------

export async function setupPage(env, url) {
  const s = await getSettings(env);
  if (s.admin_password_hash) return redirect('/admin');
  const token = url.searchParams.get('token') || '';
  return page('初始化管理员密码', `
    <div class="card"><h1>👋 初始化：设置管理员密码</h1>
    <p class="hint">这是本站第一次设置密码。设置完成后此入口自动关闭，密码保存在数据库里，以后部署更新不会再丢。</p>
    <form method="post" action="/admin/setup">
      <label>初始化令牌</label><input name="token" value="${esc(token)}" required>
      <label>设置密码（至少 6 位）</label><input name="password" type="password" required minlength="6">
      <label>再输一遍</label><input name="password2" type="password" required minlength="6">
      <button class="btn" type="submit">设置密码并登录</button>
    </form></div>`);
}

export async function setupPost(env, request) {
  const s = await getSettings(env);
  if (s.admin_password_hash) return redirect('/admin');
  const form = await request.formData();
  const token = String(form.get('token') || '');
  const pw = String(form.get('password') || '');
  const pw2 = String(form.get('password2') || '');
  const tokenHash = await sha256Hex(token);
  const exp = parseInt(s.setup_expires || '0', 10);
  if (!s.setup_token_hash || s.setup_token_hash !== tokenHash || exp < nowSec()) {
    return page('初始化失败', `<div class="card"><div class="err">初始化令牌不对或已过期。</div><a href="/admin/setup">← 返回</a></div>`);
  }
  if (pw.length < 6 || pw !== pw2) {
    return page('初始化失败', `<div class="card"><div class="err">密码至少 6 位，且两次输入要一致。</div><a href="/admin/setup">← 返回</a></div>`);
  }
  await setSetting(env, 'admin_password_hash', await sha256Hex(pw));
  await setSetting(env, 'setup_token_hash', '');
  await setSetting(env, 'setup_expires', '0');
  const session = await createSession(env);
  return redirect('/admin', { 'Set-Cookie': sessionCookie(session) });
}

// ---------------- 登录 ----------------

// 登录防爆破：同一 IP 15 分钟内错满 5 次，暂停登录 10 分钟；成功登录清零。
// 记录存 settings 表，key 前缀区分场景：llock:（后台登录）/ glock:（全站密码门），后跟 IP。
async function getLock(env, ip, prefix = 'llock:') {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(prefix + ip).first();
  if (!row) return { n: 0, w: 0, u: 0 };
  try { return JSON.parse(row.value); } catch { return { n: 0, w: 0, u: 0 }; }
}
async function setLock(env, ip, rec, prefix = 'llock:') {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(prefix + ip, JSON.stringify(rec)).run();
}
async function clearLock(env, ip, prefix = 'llock:') {
  await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(prefix + ip).run();
}

export async function loginPage(env, url) {
  const s = await getSettings(env);
  if (!s.admin_password_hash) return redirect('/admin/setup');
  let err = '';
  if (url.searchParams.get('e') === 'lock') {
    err = `<div class="err">密码错误次数过多，已暂停登录，请约 ${esc(url.searchParams.get('m') || '10')} 分钟后再试。</div>`;
  } else if (url.searchParams.get('e')) {
    const n = url.searchParams.get('n');
    err = `<div class="err">密码不对，请重试。${n ? `（已错 ${esc(n)} 次，错满 5 次将暂停 10 分钟）` : ''}</div>`;
  }
  return page('后台登录', `
    <div class="card"><h1>🔐 后台登录</h1>${err}
    <form method="post" action="/admin/login">
      <label>管理员密码</label><input name="password" type="password" required autofocus>
      <button class="btn" type="submit">登录</button>
    </form>
    <p class="hint"><a href="/">← 回到首页</a></p></div>`);
}

export async function loginPost(env, request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const now = Math.floor(Date.now() / 1000);
  const rec = await getLock(env, ip);
  if (rec.u && rec.u > now) {
    return redirect(`/admin/login?e=lock&m=${Math.ceil((rec.u - now) / 60)}`);
  }
  const form = await request.formData();
  const pw = String(form.get('password') || '');
  const hash = await effectiveAdminHash(env);
  if (!hash || (await sha256Hex(pw)) !== hash) {
    const next = now - (rec.w || 0) > 900 ? { n: 0, w: now, u: 0 } : rec;
    next.n = (next.n || 0) + 1;
    if (!next.w) next.w = now;
    if (next.n >= 5) {
      next.u = now + 600;
      await setLock(env, ip, next);
      return redirect('/admin/login?e=lock&m=10');
    }
    await setLock(env, ip, next);
    return redirect(`/admin/login?e=1&n=${next.n}`);
  }
  await clearLock(env, ip);
  const session = await createSession(env);
  return redirect('/admin', { 'Set-Cookie': sessionCookie(session) });
}

// ---------------- 全站访问密码（密码门） ----------------

function safeNext(raw) {
  const nx = String(raw || '/');
  return nx.startsWith('/') && !nx.startsWith('//') ? nx : '/';
}

export async function gatePage(env, url) {
  const s = await getSettings(env);
  if (s.site_lock !== '1' || !s.site_password_hash) return redirect('/');
  let err = '';
  if (url.searchParams.get('e') === 'lock') {
    err = `<div class="err">密码错误次数过多，已暂停，请约 ${esc(url.searchParams.get('m') || '10')} 分钟后再试。</div>`;
  } else if (url.searchParams.get('e')) {
    const n = url.searchParams.get('n');
    err = `<div class="err">密码不对，请重试。${n ? `（已错 ${esc(n)} 次，错满 5 次将暂停 10 分钟）` : ''}</div>`;
  }
  const next = safeNext(url.searchParams.get('next'));
  return page('需要密码', `
    <div class="card"><h1>🔐 ${esc(s.site_name || '朋友圈')}</h1>${err}
    <p class="hint">本站已开启访问密码，输入密码后可浏览（30 天内不用重复输入）。</p>
    <form method="post" action="/gate">
      <input type="hidden" name="next" value="${esc(next)}">
      <label>访问密码</label><input name="password" type="password" required autofocus>
      <button class="btn" type="submit">进入</button>
    </form>
    <p class="hint"><a href="/admin/login">管理员登录 →</a></p></div>`);
}

export async function gatePost(env, request) {
  const s = await getSettings(env);
  if (s.site_lock !== '1' || !s.site_password_hash) return redirect('/');
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const now = Math.floor(Date.now() / 1000);
  const rec = await getLock(env, ip, 'glock:');
  if (rec.u && rec.u > now) {
    return redirect(`/gate?e=lock&m=${Math.ceil((rec.u - now) / 60)}`);
  }
  const form = await request.formData();
  const pw = String(form.get('password') || '');
  const next = safeNext(form.get('next'));
  if ((await sha256Hex(pw)) !== s.site_password_hash) {
    const nx = now - (rec.w || 0) > 900 ? { n: 0, w: now, u: 0 } : rec;
    nx.n = (nx.n || 0) + 1;
    if (!nx.w) nx.w = now;
    if (nx.n >= 5) {
      nx.u = now + 600;
      await setLock(env, ip, nx, 'glock:');
      return redirect('/gate?e=lock&m=10');
    }
    await setLock(env, ip, nx, 'glock:');
    return redirect(`/gate?e=1&n=${nx.n}&next=${encodeURIComponent(next)}`);
  }
  await clearLock(env, ip, 'glock:');
  if (!s.site_gate_token) return redirect('/');
  return redirect(next, { 'Set-Cookie': gateCookie(s.site_gate_token) });
}

export async function gateSettingsSave(env, request) {
  const f = await request.formData();
  const s = await getSettings(env);
  const pw = String(f.get('site_password') || '');
  let hash = s.site_password_hash || '';
  if (pw) {
    if (pw.length < 4) return redirect('/admin/settings?gerr=len');
    hash = await sha256Hex(pw);
    await setSetting(env, 'site_password_hash', hash);
    // 重设密码即轮换解锁令牌：所有访客要重新输一次新密码
    await setSetting(env, 'site_gate_token', randomToken() + randomToken());
  }
  const want = f.get('site_lock') ? '1' : '0';
  if (want === '1' && !hash) return redirect('/admin/settings?gerr=need');
  await setSetting(env, 'site_lock', want);
  return redirect('/admin/settings?gok=1');
}

// ---------------- 单条动态观看密码 ----------------
// 解锁 cookie 名 mm_view_<id>，值 = sha256(密码哈希:memoId:site_secret)：
// 管理员改密码后哈希变，旧 cookie 自动失效；防爆破与密码门共用锁（vlock:<id>: 前缀）。

export async function memoUnlock(env, request, id) {
  const back = `/memo/${id}`;
  const memo = await env.DB.prepare('SELECT id, view_password_hash FROM memos WHERE id = ?').bind(id).first();
  if (!memo || !memo.view_password_hash) return redirect(back);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const prefix = `vlock:${id}:`;
  const now = Math.floor(Date.now() / 1000);
  const rec = await getLock(env, ip, prefix);
  if (rec.u && rec.u > now) {
    return redirect(`${back}?e=lock&m=${Math.ceil((rec.u - now) / 60)}`);
  }
  const form = await request.formData();
  const pw = String(form.get('password') || '');
  if ((await sha256Hex(pw)) !== memo.view_password_hash) {
    const nx = now - (rec.w || 0) > 900 ? { n: 0, w: now, u: 0 } : rec;
    nx.n = (nx.n || 0) + 1;
    if (!nx.w) nx.w = now;
    if (nx.n >= 5) {
      nx.u = now + 600;
      await setLock(env, ip, nx, prefix);
      return redirect(`${back}?e=lock&m=10`);
    }
    await setLock(env, ip, nx, prefix);
    return redirect(`${back}?e=1&n=${nx.n}`);
  }
  await clearLock(env, ip, prefix);
  const s = await getSettings(env);
  const token = await sha256Hex(memo.view_password_hash + ':' + id + ':' + (s.site_secret || ''));
  return redirect(back, {
    'Set-Cookie': `mm_view_${id}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 3600}`,
  });
}

export async function logout(env, request) {
  await destroySession(env, request);
  return redirect('/', { 'Set-Cookie': clearSessionCookie });
}

// ---------------- 动态管理 ----------------

function toLocalInput(ts) {
  const d = new Date(ts * 1000 + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function fromLocalInput(v, fallback) {
  if (!v) return fallback;
  const t = Date.parse(v + (v.length === 16 ? ':00' : '') + '+08:00');
  return Number.isNaN(t) ? fallback : Math.floor(t / 1000);
}

export function buildExt(type, f) {
  const url = String(f.get('ext_url') || '').trim();
  const title = String(f.get('ext_title') || '').trim();
  const cover = String(f.get('ext_cover') || '').trim();
  const desc = String(f.get('ext_desc') || '').trim();
  if (!type || !url) return { type: '', data: {} };
  if (type === 'video') {
    const dy = url.match(/(?:douyin\.com|iesdouyin\.com)\/(?:share\/)?video\/(\d+)/);
    if (dy) return { type, data: { embed: `https://open.douyin.com/player/video?vid=${dy[1]}&autoplay=0`, url } };
    const bv = url.match(/BV[0-9A-Za-z]{10}/);
    if (bv) return { type, data: { embed: `//player.bilibili.com/player.html?bvid=${bv[0]}&page=1&high_quality=1`, url } };
    const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
    if (yt) return { type, data: { embed: `//www.youtube.com/embed/${yt[1]}`, url } };
    // 抖音/小红书链接没能解析出可嵌入地址时，降级成链接卡片（避免把网页地址当视频文件加载）
    if (/douyin\.com|iesdouyin\.com/.test(url)) return { type: 'link', data: { url, title: '抖音视频', desc: '抖音' } };
    if (/xiaohongshu\.com|xhslink\.com/.test(url)) return { type: 'link', data: { url, title: '小红书', desc: '小红书' } };
    return { type, data: { url } };
  }
  if (type === 'music') {
    const id = url.match(/[?&]id=(\d+)/) || url.match(/song\/(\d+)/);
    if (/music\.163\.com/.test(url) && id) {
      return { type, data: { embed: `//music.163.com/outchain/player?type=2&id=${id[1]}&auto=0&height=66`, url } };
    }
    return { type, data: { url } };
  }
  return { type, data: { url, title, cover, desc } };
}

function memoForm(memo, settings) {
  const isNew = !memo;
  memo = memo || { title: '', content_md: '', tags: '', media: '[]', ext_type: '', ext_data: '{}', pinned: 0, hidden: 0, files_gated: 0, content_gated: 0, view_password_hash: '', created_at: nowSec() };
  const ext = parseJsonSafe(memo.ext_data, {});
  const media = parseJsonSafe(memo.media, []);
  const initialHtml = memo.content_md ? renderContent(memo.content_md) : '';
  const emojis = ['😀', '😁', '😂', '🙂', '😉', '😍', '😘', '😎', '🤔', '😅', '😭', '😡', '👍', '👏', '🙏', '💪', '❤️', '🔥', '✨', '🎉', '📷', '🌸', '🍺', '☕', '🌙', '⭐', '✅', '❌', '⚠️', '💡', '📌', '🚀'];
  const emojiButtons = emojis.map((e) => `<button type="button" class="emoji-btn">${e}</button>`).join('');
  return `<div class="card"><h2>${isNew ? '发布动态' : '编辑动态'}</h2>
  <form method="post" action="${isNew ? '/admin/memos/new' : `/admin/memos/${memo.id}/edit`}" id="memo-form">
    <label>标题（可选）</label>
    <input name="title" maxlength="80" value="${esc(memo.title || '')}" placeholder="填了标题会加粗、单独一行显示在正文上方；不填则照原样发布">
    <label>内容（富文本编辑，点 &lt;/&gt; 可切源码；旧的 Markdown 动态打开会自动转成富文本）</label>
    <div class="editor-wrap">
      <div class="editor-toolbar" id="editor-toolbar">
        <button type="button" data-cmd="undo" title="撤销">↩</button>
        <button type="button" data-cmd="redo" title="重做">↪</button>
        <span class="tb-sep"></span>
        <select id="format-select" title="格式">
          <option value="p">正文</option>
          <option value="h2">标题 2</option>
          <option value="h3">标题 3</option>
          <option value="h4">标题 4</option>
          <option value="blockquote">引用</option>
          <option value="pre">代码块</option>
        </select>
        <select id="fontsize-select" title="字号">
          <option value="">字号</option>
          <option value="2">小</option>
          <option value="3">正常</option>
          <option value="4">大</option>
          <option value="5">特大</option>
          <option value="6">超大</option>
        </select>
        <span class="tb-sep"></span>
        <button type="button" data-cmd="bold" title="粗体"><b>B</b></button>
        <button type="button" data-cmd="italic" title="斜体"><i>I</i></button>
        <button type="button" data-cmd="underline" title="下划线"><u>U</u></button>
        <button type="button" data-cmd="strikeThrough" title="删除线"><s>S</s></button>
        <label class="tb-color" title="文字颜色"><span>A</span><input type="color" id="fore-color" value="#18181b"></label>
        <label class="tb-color" title="背景高亮"><span class="tc-hl">A</span><input type="color" id="back-color" value="#fff3a3"></label>
        <span class="tb-sep"></span>
        <button type="button" id="link-btn" title="插入链接">🔗</button>
        <button type="button" id="image-btn" title="插入图片（填图片地址）">🖼️</button>
        <button type="button" id="video-btn" title="插入视频（YouTube / Bilibili 链接）">🎬</button>
        <button type="button" id="emoji-btn" title="插入表情">😊</button>
        <button type="button" id="source-btn" title="HTML 源码">&lt;/&gt;</button>
        <button type="button" data-cmd="removeFormat" title="清除格式">🧹</button>
        <span class="tb-sep"></span>
        <button type="button" data-cmd="justifyLeft" title="左对齐">⬅︎</button>
        <button type="button" data-cmd="justifyCenter" title="居中">↔</button>
        <button type="button" data-cmd="justifyRight" title="右对齐">➡︎</button>
        <button type="button" data-cmd="insertUnorderedList" title="无序列表">≣</button>
        <button type="button" data-cmd="insertOrderedList" title="有序列表">①</button>
        <button type="button" data-cmd="outdent" title="减少缩进">⇤</button>
        <button type="button" data-cmd="indent" title="增加缩进">⇥</button>
        <button type="button" id="hr-btn" title="分隔线">―</button>
      </div>
      <div id="emoji-panel" class="emoji-panel" hidden>${emojiButtons}</div>
      <div id="editor" class="editor-body" contenteditable="true" data-placeholder="这一刻的想法…">${initialHtml}</div>
      <textarea id="source-area" class="source-area" hidden placeholder="HTML 源码"></textarea>
      <textarea name="content_md" id="content-md" hidden></textarea>
    </div>
    <label>附件：图片 / 视频 / 任意文件（含压缩包，上传到 R2）或外链</label>
    <div class="thumbs" id="thumbs"></div>
    <div class="row">
      <input type="file" id="file-input" multiple style="width:auto;flex:1">
      <input id="ext-url" placeholder="或粘贴文件外链后点添加" style="flex:2">
      <button type="button" class="btn ghost" id="add-url">添加外链</button>
    </div>
    <input type="hidden" name="media_json" id="media-json" value="${esc(JSON.stringify(media))}">
    <label>标签（逗号分隔，最多 8 个）</label>
    <input name="tags" value="${esc(memo.tags)}" placeholder="生活, 随手记">
    <label>附加内容</label>
    <select name="ext_type" id="ext-type">
      <option value="">无</option>
      <option value="video" ${memo.ext_type === 'video' ? 'selected' : ''}>外部视频（B站/YouTube/抖音/直链）</option>
      <option value="music" ${memo.ext_type === 'music' ? 'selected' : ''}>音乐（网易云歌曲链接/直链）</option>
      <option value="douban" ${memo.ext_type === 'douban' ? 'selected' : ''}>豆瓣卡片（书/影）</option>
      <option value="link" ${memo.ext_type === 'link' ? 'selected' : ''}>链接卡片</option>
    </select>
    <div id="ext-fields">
      <label>链接地址</label><input name="ext_url" value="${esc(ext.url || '')}" placeholder="https://…">
      <label>标题（豆瓣/链接卡片用）</label><input name="ext_title" value="${esc(ext.title || '')}">
      <label>封面图地址（豆瓣/链接卡片用，可空）</label><input name="ext_cover" value="${esc(ext.cover || '')}">
      <label>描述（豆瓣/链接卡片用，可空）</label><input name="ext_desc" value="${esc(ext.desc || '')}">
    </div>
    <label>发布时间（可改：设为未来时间 = 定时发布，到点前游客看不到）</label>
    <input type="datetime-local" name="created_at" value="${toLocalInput(memo.created_at)}">
    <label style="display:block;margin:8px 0"><input type="checkbox" name="pinned" value="1" style="width:auto" ${memo.pinned ? 'checked' : ''}> 置顶</label>
    <label style="display:block;margin:8px 0"><input type="checkbox" name="hidden" value="1" style="width:auto" ${memo.hidden ? 'checked' : ''}> 隐藏（仅自己在登录状态下可见，游客看不到）</label>
    <label style="display:block;margin:8px 0"><input type="checkbox" name="files_gated" value="1" style="width:auto" ${memo.files_gated ? 'checked' : ''}> 附件文件回复后可见（游客在这条动态下评论后，才能看到下载文件；图片、视频不受影响）</label>
    <label style="display:block;margin:8px 0"><input type="checkbox" name="content_gated" value="1" style="width:auto" ${memo.content_gated ? 'checked' : ''}> 正文回复后可见（游客评论后才能看正文、图片和附件；标题照常显示，勾了这个就不必再勾上一项）</label>
    <label>观看密码（可选${memo.view_password_hash ? '，已设置' : ''}；留空 = ${memo.view_password_hash ? '不修改' : '不设密码'}；设了后访客输对密码才能看这条的正文、图片、附件与评论，输对一次 30 天免输）</label>
    <input type="password" name="view_password" autocomplete="new-password" placeholder="至少 4 位">
    ${memo.view_password_hash ? '<label style="display:block;margin:8px 0"><input type="checkbox" name="view_password_clear" value="1" style="width:auto"> 清除观看密码（取消这条的密码保护）</label>' : ''}
    <button class="btn" type="submit">${isNew ? '发布' : '保存修改'}</button>
    <a href="/admin" style="margin-left:10px">取消</a>
  </form></div>
  <script>
    // ---------- 富文本编辑器 ----------
    var editor = document.getElementById('editor');
    var source = document.getElementById('source-area');
    var contentHidden = document.getElementById('content-md');
    var sourceMode = false;
    var savedRange = null;
    document.execCommand('styleWithCSS', false, true);
    function saveRange(){
      var sel = window.getSelection();
      if (sel.rangeCount && editor.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
    }
    document.addEventListener('selectionchange', saveRange);
    function restoreRange(){
      if (!savedRange) { editor.focus(); return; }
      var sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(savedRange);
    }
    function exec(cmd, val){ restoreRange(); document.execCommand(cmd, false, val || null); editor.focus(); saveRange(); }
    function insertHtml(html){ restoreRange(); document.execCommand('insertHTML', false, html); editor.focus(); saveRange(); }
    document.getElementById('editor-toolbar').addEventListener('mousedown', function(e){
      if (e.target.closest('button')) e.preventDefault();
    });
    document.querySelectorAll('#editor-toolbar [data-cmd]').forEach(function(btn){
      btn.addEventListener('click', function(){ exec(btn.getAttribute('data-cmd')); });
    });
    document.getElementById('format-select').addEventListener('change', function(e){
      exec('formatBlock', e.target.value); e.target.value = 'p';
    });
    document.getElementById('fontsize-select').addEventListener('change', function(e){
      if (e.target.value) exec('fontSize', e.target.value); e.target.value = '';
    });
    document.getElementById('fore-color').addEventListener('input', function(e){ exec('foreColor', e.target.value); });
    document.getElementById('back-color').addEventListener('input', function(e){
      restoreRange();
      if (!document.execCommand('hiliteColor', false, e.target.value)) document.execCommand('backColor', false, e.target.value);
      editor.focus(); saveRange();
    });
    document.getElementById('link-btn').addEventListener('click', function(){
      var url = prompt('链接地址', 'https://');
      if (!url) return;
      if (savedRange && !savedRange.collapsed) exec('createLink', url);
      else insertHtml('<a href="' + url.replace(/"/g, '&quot;') + '">' + url + '</a>');
    });
    document.getElementById('image-btn').addEventListener('click', function(){
      var url = prompt('图片地址（https://…）', '');
      if (url) exec('insertImage', url);
    });
    document.getElementById('video-btn').addEventListener('click', function(){
      var url = prompt('粘贴 YouTube 或 Bilibili 视频链接', '');
      if (!url) return;
      var src = '';
      var m = url.match(/(?:youtube\\.com\\/watch\\?v=|youtu\\.be\\/)([\\w-]{6,})/);
      if (m) src = 'https://www.youtube.com/embed/' + m[1];
      var b = url.match(/bilibili\\.com\\/video\\/(BV[\\w]+)/);
      if (b) src = 'https://player.bilibili.com/player.html?bvid=' + b[1] + '&autoplay=0';
      if (!src) { alert('只支持 YouTube 和 Bilibili 的视频链接'); return; }
      insertHtml('<p><iframe src="' + src + '" width="560" height="315" allowfullscreen frameborder="0"></iframe></p><p><br></p>');
    });
    var panel = document.getElementById('emoji-panel');
    document.getElementById('emoji-btn').addEventListener('click', function(){ panel.hidden = !panel.hidden; });
    panel.querySelectorAll('.emoji-btn').forEach(function(btn){
      btn.addEventListener('click', function(){ exec('insertText', btn.textContent); panel.hidden = true; });
    });
    document.getElementById('hr-btn').addEventListener('click', function(){ exec('insertHorizontalRule'); });
    var sourceBtn = document.getElementById('source-btn');
    sourceBtn.addEventListener('click', function(){
      sourceMode = !sourceMode;
      sourceBtn.classList.toggle('tb-on', sourceMode);
      if (sourceMode) { source.value = editor.innerHTML; editor.hidden = true; source.hidden = false; }
      else { editor.innerHTML = source.value; source.hidden = true; editor.hidden = false; editor.focus(); }
    });
    document.getElementById('memo-form').addEventListener('submit', function(){
      contentHidden.value = sourceMode ? source.value : editor.innerHTML;
    });

    // 图片自动压缩：JPEG/PNG/WebP 且大于 300KB 时，浏览器内缩到长边 1920 并转 WebP(0.82) 再上传；压不动或不支持就传原图
    async function shrinkImage(file){
      if(!file || !/^image\\/(jpeg|png|webp)$/.test(file.type || '') || file.size < 300*1024) return file;
      try{
        var bmp = await createImageBitmap(file);
        var sc = Math.min(1, 1920/Math.max(bmp.width, bmp.height));
        var w = Math.max(1, Math.round(bmp.width*sc)), h = Math.max(1, Math.round(bmp.height*sc));
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
        var blob = await new Promise(function(res){ cv.toBlob(res, 'image/webp', 0.82); });
        if(!blob || blob.size >= file.size) return file;
        return new File([blob], (file.name || 'image').replace(/\\.[^.]+$/, '') + '.webp', {type: 'image/webp'});
      }catch(e){ return file; }
    }
    // ---------- 附件 ----------
    var media = ${JSON.stringify(media)};
    var thumbs = document.getElementById('thumbs');
    var hidden = document.getElementById('media-json');
    function draw(){
      hidden.value = JSON.stringify(media);
      thumbs.innerHTML = media.map(function(m,i){
        if (m.type==='file') return '<div class="th file">📄 ' + (m.name || '附件') + '<button type="button" onclick="delMedia('+i+')">×</button></div>';
        var inner = m.type==='video' ? '<video src="'+m.url+'" muted></video>' : '<img src="'+m.url+'">';
        return '<div class="th">'+inner+'<button type="button" onclick="delMedia('+i+')">×</button></div>';
      }).join('');
    }
    function delMedia(i){ media.splice(i,1); draw(); }
    document.getElementById('file-input').addEventListener('change', async function(e){
      for (var file of e.target.files){
        file = await shrinkImage(file);
        var fd = new FormData(); fd.append('file', file);
        var r = await fetch('/admin/upload', {method:'POST', body: fd});
        var d = await r.json();
        if (d.url) {
          var t = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file';
          media.push({type: t, url: d.url, name: file.name});
        } else alert('上传失败：' + (d.error || '未知错误'));
      }
      e.target.value=''; draw();
    });
    document.getElementById('add-url').addEventListener('click', function(){
      var v = document.getElementById('ext-url').value.trim();
      if(!v) return;
      var t = /\\.(png|jpe?g|gif|webp|svg|avif|bmp)(\\?|$)/i.test(v) ? 'image'
            : /\\.(mp4|webm|mov|m4v)(\\?|$)/i.test(v) ? 'video' : 'file';
      var name = t === 'file' ? decodeURIComponent((v.split('/').pop() || '外链文件').split('?')[0]) : undefined;
      media.push({type: t, url: v, name: name});
      document.getElementById('ext-url').value=''; draw();
    });
    draw();
  </script>`;
}

export async function dashboard(env) {
  const { results } = await env.DB.prepare(
    `SELECT m.*, (SELECT COUNT(*) FROM likes WHERE memo_id=m.id) AS like_count,
     (SELECT COUNT(*) FROM comments WHERE memo_id=m.id AND status='approved') AS cc,
     (SELECT COUNT(*) FROM comments WHERE memo_id=m.id AND status='pending') AS pc
     FROM memos m ORDER BY m.pinned DESC, m.created_at DESC LIMIT 100`
  ).all();
  const pending = await env.DB.prepare("SELECT COUNT(*) AS c FROM comments WHERE status='pending'").first();
  const rows = (results || [])
    .map((m) => {
      const future = m.created_at > nowSec() ? ' <span class="hint">（定时，未发布）</span>' : '';
      const hid = m.hidden ? ' <span class="hint">（🔒 隐藏）</span>' : '';
      const text = esc(excerptOf(m.content_md, 60)) || '<span class="hint">（无文字）</span>';
      return `<tr><td>${m.pinned ? '📌 ' : ''}${text}${future}${hid}<div class="hint">${new Date((m.created_at + 28800) * 1000).toISOString().slice(0, 16).replace('T', ' ')} · ❤ ${m.like_count} · 💬 ${m.cc}${m.pc ? `（待审 ${m.pc}）` : ''}</div></td>
      <td style="white-space:nowrap"><a href="/admin/memos/${m.id}/edit">编辑</a>
      <form method="post" action="/admin/memos/${m.id}/delete" style="display:inline" onsubmit="return confirm('删除这条动态？评论和点赞也会一起删。')"><button class="btn danger" style="padding:4px 10px">删除</button></form></td></tr>`;
    })
    .join('');
  return page('后台 · 动态管理', `${nav()}
    ${pending && pending.c ? `<div class="ok">有 ${pending.c} 条评论待审核 → <a href="/admin/comments">去审核</a></div>` : ''}
    <div class="card"><h2>动态管理（共 ${(results || []).length} 条）</h2>
    <table>${rows || '<tr><td>还没有动态，去发布第一条吧。</td></tr>'}</table></div>`);
}

export async function memoSave(env, request, id) {
  const f = await request.formData();
  // 抖音分享：粘贴整段口令文本时先提取里面的链接；短链接（v.douyin.com）保存时跟跳转解析成带视频 ID 的长链接
  if (String(f.get('ext_type') || '') === 'video') {
    let u = String(f.get('ext_url') || '');
    const mUrl = u.match(/https?:\/\/[^\s，。]+/);
    if (mUrl) u = mUrl[0];
    if (/v\.douyin\.com\//.test(u) && !/video\/\d+/.test(u)) {
      try {
        const resp = await fetch(u, {
          redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.url && /video\/\d+/.test(resp.url)) u = resp.url;
      } catch { /* 解析失败就按原链接存，走链接卡片兜底 */ }
    }
    f.set('ext_url', u);
  }
  const title = String(f.get('title') || '').trim().slice(0, 80);
  const content = String(f.get('content_md') || '').trim();
  const media = String(f.get('media_json') || '[]');
  const tags = parseTags(f.get('tags')).join(',');
  const ext = buildExt(String(f.get('ext_type') || ''), f);
  const pinned = f.get('pinned') ? 1 : 0;
  const hiddenPost = f.get('hidden') ? 1 : 0;
  const filesGated = f.get('files_gated') ? 1 : 0;
  const contentGated = f.get('content_gated') ? 1 : 0;
  const now = nowSec();
  if (!content && parseJsonSafe(media, []).length === 0 && !ext.type) {
    return page('内容为空', `<div class="card"><div class="err">文字、图片、附加内容至少要有一项。</div><a href="/admin">← 返回</a></div>`);
  }
  // 观看密码：填了新密码（≥4 位）就更新哈希；勾了清除就取消；都没有则保持原样
  let viewPwHash = '';
  if (id) {
    const old0 = await env.DB.prepare('SELECT view_password_hash FROM memos WHERE id = ?').bind(id).first();
    viewPwHash = (old0 && old0.view_password_hash) || '';
  }
  if (f.get('view_password_clear')) viewPwHash = '';
  const vpw = String(f.get('view_password') || '');
  if (vpw) {
    if (vpw.length < 4) {
      return page('观看密码太短', `<div class="card"><div class="err">观看密码至少 4 位，这次没有保存。</div><a href="javascript:history.back()">← 返回修改</a></div>`);
    }
    viewPwHash = await sha256Hex(vpw);
  }
  if (id) {
    const old = await env.DB.prepare('SELECT created_at FROM memos WHERE id = ?').bind(id).first();
    if (!old) return redirect('/admin');
    const created = fromLocalInput(String(f.get('created_at') || ''), old.created_at);
    await env.DB.prepare(
      'UPDATE memos SET title=?, content_md=?, tags=?, media=?, ext_type=?, ext_data=?, pinned=?, hidden=?, files_gated=?, content_gated=?, view_password_hash=?, created_at=?, updated_at=? WHERE id=?'
    ).bind(title, content, tags, media, ext.type, JSON.stringify(ext.data), pinned, hiddenPost, filesGated, contentGated, viewPwHash, created, now, id).run();
  } else {
    const created = fromLocalInput(String(f.get('created_at') || ''), now);
    await env.DB.prepare(
      'INSERT INTO memos (title, content_md, tags, media, ext_type, ext_data, pinned, hidden, files_gated, content_gated, view_password_hash, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(title, content, tags, media, ext.type, JSON.stringify(ext.data), pinned, hiddenPost, filesGated, contentGated, viewPwHash, created, now).run();
  }
  return redirect('/admin');
}

// ---------------- 垃圾桶 ----------------
// 删除动态/评论先进垃圾桶（整行快照存 trash.data），可还原；超过保留天数自动清掉。

function fmtT(ts) {
  return new Date(ts * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

async function insertRow(env, table, row) {
  const cols = Object.keys(row);
  if (!cols.length) return;
  const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  await env.DB.prepare(sql).bind(...cols.map((c) => row[c])).run();
}

async function toTrash(env, kind, refId, summary, data) {
  await env.DB.prepare('INSERT INTO trash (kind, ref_id, summary, data, deleted_at) VALUES (?, ?, ?, ?, ?)')
    .bind(kind, refId, summary, JSON.stringify(data), nowSec()).run();
}

// 动态自己上传到 R2 的文件 key（外链文件不在本站，不动）
function memoFileKeys(memo) {
  const keys = [];
  for (const mm of parseJsonSafe(memo && memo.media, [])) {
    const u = String((mm && mm.url) || '');
    if (u.startsWith('/media/uploads/')) keys.push(u.slice('/media/'.length));
  }
  return keys;
}

// 彻底删除垃圾桶条目时，连带删掉「再没有任何地方引用」的 R2 文件（普通删进垃圾桶不删文件，保证能还原）
async function deleteOrphanFilesOfTrashRows(env, rows) {
  const memoRows = (rows || []).filter((r) => r.kind === 'memo');
  if (!memoRows.length) return;
  const doomed = new Set();
  for (const r of memoRows) {
    let data = {};
    try { data = JSON.parse(r.data || '{}'); } catch { data = {}; }
    if (data.memo) for (const k of memoFileKeys(data.memo)) doomed.add(k);
  }
  if (!doomed.size) return;
  // 仍被引用就不能删：现存动态、其余垃圾桶条目、站点封面/头像
  const purgingIds = new Set(memoRows.map((r) => r.id));
  const stillUsed = new Set();
  const live = await env.DB.prepare('SELECT media FROM memos').all();
  for (const m of live.results || []) for (const k of memoFileKeys(m)) stillUsed.add(k);
  const rest = await env.DB.prepare('SELECT id, kind, data FROM trash').all();
  for (const r of rest.results || []) {
    if (purgingIds.has(r.id) || r.kind !== 'memo') continue;
    let data = {};
    try { data = JSON.parse(r.data || '{}'); } catch { data = {}; }
    if (data.memo) for (const k of memoFileKeys(data.memo)) stillUsed.add(k);
  }
  const s = await getSettings(env);
  for (const u of [s.cover_url, s.avatar_url]) {
    if (u && String(u).startsWith('/media/')) stillUsed.add(String(u).slice('/media/'.length));
  }
  for (const key of doomed) {
    if (stillUsed.has(key)) continue;
    try { await env.MEDIA.delete(key); } catch { /* 单个文件删除失败不阻断 */ }
    await env.DB.prepare('DELETE FROM media WHERE r2_key = ?').bind(key).run();
  }
}

export async function purgeTrash(env) {
  const s = await getSettings(env);
  const days = parseInt(s.trash_days || '30', 10);
  if (!Number.isFinite(days) || days <= 0) return; // 0 或非法 = 不自动清空
  const cutoff = nowSec() - days * 86400;
  const expired = await env.DB.prepare('SELECT * FROM trash WHERE deleted_at < ?').bind(cutoff).all();
  if ((expired.results || []).length) {
    await deleteOrphanFilesOfTrashRows(env, expired.results);
    await env.DB.prepare('DELETE FROM trash WHERE deleted_at < ?').bind(cutoff).run();
  }
}

export async function memoDelete(env, request, id) {
  const memo = await env.DB.prepare('SELECT * FROM memos WHERE id = ?').bind(id).first();
  if (memo) {
    const cs = await env.DB.prepare('SELECT * FROM comments WHERE memo_id = ?').bind(id).all();
    const ls = await env.DB.prepare('SELECT * FROM likes WHERE memo_id = ?').bind(id).all();
    await toTrash(env, 'memo', id, excerptOf(memo.content_md, 80) || '（无文字内容）', {
      memo, comments: cs.results || [], likes: ls.results || [],
    });
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM memos WHERE id = ?').bind(id),
    env.DB.prepare('DELETE FROM comments WHERE memo_id = ?').bind(id),
    env.DB.prepare('DELETE FROM likes WHERE memo_id = ?').bind(id),
  ]);
  await purgeTrash(env);
  // 从前台删的回前台（删的正是当前详情页时回首页）；从后台删的回后台
  try {
    const ref = request && request.headers ? request.headers.get('referer') : null;
    if (ref) {
      const p = new URL(ref).pathname;
      if (p === `/memo/${id}`) return redirect('/');
      if (p === '/' || p.startsWith('/memo/') || p.startsWith('/tag/')) return redirect(p);
    }
  } catch { /* 忽略来源解析失败 */ }
  return redirect('/admin');
}

export async function trashPage(env, url) {
  await purgeTrash(env);
  const s = await getSettings(env);
  const days = parseInt(s.trash_days || '30', 10);
  const rows = await env.DB.prepare('SELECT id, kind, ref_id, summary, deleted_at FROM trash ORDER BY deleted_at DESC').all();
  const items = rows.results || [];
  const msg = url.searchParams.get('ok') ? '<div class="ok">已保存。</div>' : '';
  const restored = url.searchParams.get('restored') ? '<div class="ok">已还原。</div>' : '';
  const err = url.searchParams.get('e') === 'memo-gone'
    ? '<div class="err">还原失败：这条评论所属的动态已经不在了（可能被彻底删除）。可以先还原那条动态，或把这条评论彻底删除。</div>' : '';
  const body = items.length
    ? items.map((t) => {
        const left = days > 0 ? Math.max(0, Math.ceil((t.deleted_at + days * 86400 - nowSec()) / 86400)) : null;
        return `<div class="card">
          <div><span class="hint">${t.kind === 'memo' ? '📝 动态' : '💬 评论'} · 删除于 ${fmtT(t.deleted_at)}${left !== null ? ` · 还剩 ${left} 天到期清空` : ''}</span></div>
          <div style="margin:6px 0 10px">${esc(t.summary)}</div>
          <form method="post" action="/admin/trash/${t.id}/restore" style="display:inline"><button class="btn" style="padding:5px 14px">还原</button></form>
          <form method="post" action="/admin/trash/${t.id}/purge" style="display:inline" onsubmit="return confirm('彻底删除后无法恢复，确定？')"><button class="btn danger" style="padding:5px 14px">彻底删除</button></form>
        </div>`;
      }).join('')
    : '<div class="card">垃圾桶是空的。</div>';
  return page('后台 · 垃圾桶', `${nav()}${msg}${restored}${err}
    <div class="card">
      <h2>🗑 垃圾桶</h2>
      <p class="hint">删除的动态和评论会先放在这里，可以还原；超过保留天数后自动清空。动态还原时，它的评论和点赞会一并恢复。彻底删除（含到期自动清空）时，这条动态独有的上传文件也会一并删掉；被其他动态共用的文件会保留。</p>
      <form method="post" action="/admin/trash/settings" class="row">
        <label>保留天数 <input name="trash_days" type="number" min="0" max="3650" value="${days}" style="width:90px;display:inline-block;margin:0 6px"></label>
        <button class="btn" style="padding:7px 16px">保存</button>
        <span class="hint">填 0 = 不自动清空（一直保留，直到手动处理）。</span>
      </form>
      ${items.length ? '<form method="post" action="/admin/trash/empty" onsubmit="return confirm(\'确定清空垃圾桶？全部内容将彻底删除，无法恢复。\')" style="margin-top:8px"><button class="btn danger" style="padding:7px 16px">清空垃圾桶</button></form>' : ''}
    </div>
    ${body}`);
}

export async function trashSettings(env, request) {
  const form = await request.formData();
  let days = parseInt(String(form.get('trash_days') || '30'), 10);
  if (!Number.isFinite(days) || days < 0) days = 30;
  if (days > 3650) days = 3650;
  await setSetting(env, 'trash_days', String(days));
  await purgeTrash(env);
  return redirect('/admin/trash?ok=1');
}

export async function trashEmpty(env) {
  const all = await env.DB.prepare('SELECT * FROM trash').all();
  await deleteOrphanFilesOfTrashRows(env, all.results || []);
  await env.DB.prepare('DELETE FROM trash').run();
  return redirect('/admin/trash?ok=1');
}

export async function trashAction(env, id, action) {
  const row = await env.DB.prepare('SELECT * FROM trash WHERE id = ?').bind(id).first();
  if (!row) return redirect('/admin/trash');
  if (action === 'purge') {
    await deleteOrphanFilesOfTrashRows(env, [row]);
    await env.DB.prepare('DELETE FROM trash WHERE id = ?').bind(id).run();
    return redirect('/admin/trash?ok=1');
  }
  // restore
  let data = {};
  try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
  if (row.kind === 'memo' && data.memo) {
    await insertRow(env, 'memos', data.memo);
    for (const c of data.comments || []) await insertRow(env, 'comments', c);
    for (const l of data.likes || []) await insertRow(env, 'likes', l);
  } else if (row.kind === 'comment' && data.comment) {
    const memo = await env.DB.prepare('SELECT id FROM memos WHERE id = ?').bind(data.comment.memo_id).first();
    if (!memo) return redirect('/admin/trash?e=memo-gone');
    await insertRow(env, 'comments', data.comment);
  }
  await env.DB.prepare('DELETE FROM trash WHERE id = ?').bind(id).run();
  return redirect('/admin/trash?restored=1');
}

// ---------------- 评论审核 ----------------

// 把 User-Agent 原文解析成「浏览器 · 操作系统」的可读文字（悬停可看原文）
export function parseUa(ua) {
  if (!ua) return '';
  let browser = '未知浏览器';
  let m;
  if ((m = ua.match(/MicroMessenger\/([\d.]+)/))) browser = '微信 ' + m[1];
  else if ((m = ua.match(/Edg\/([\d.]+)/))) browser = 'Edge ' + m[1].split('.')[0];
  else if ((m = ua.match(/(?:OPR|Opera)[\/ ]([\d.]+)/))) browser = 'Opera ' + m[1].split('.')[0];
  else if ((m = ua.match(/QQBrowser\/([\d.]+)/))) browser = 'QQ浏览器 ' + m[1].split('.')[0];
  else if ((m = ua.match(/Chrome\/([\d.]+)/))) browser = 'Chrome ' + m[1].split('.')[0];
  else if ((m = ua.match(/Firefox\/([\d.]+)/))) browser = 'Firefox ' + m[1].split('.')[0];
  else if ((m = ua.match(/Version\/([\d.]+)[^)]*Safari/))) browser = 'Safari ' + m[1].split('.')[0];
  let os = '未知系统';
  if ((m = ua.match(/Windows NT ([\d.]+)/))) {
    os = { '10.0': 'Windows 10/11', '6.3': 'Windows 8.1', '6.2': 'Windows 8', '6.1': 'Windows 7' }[m[1]] || 'Windows';
  } else if ((m = ua.match(/Android ([\d.]+)/))) os = 'Android ' + m[1];
  else if ((m = ua.match(/(?:iPhone OS|CPU OS) ([\d_]+)/))) os = 'iOS ' + m[1].replace(/_/g, '.');
  else if ((m = ua.match(/Mac OS X ([\d_]+)/))) os = 'macOS ' + m[1].replace(/_/g, '.');
  else if (/Linux/.test(ua)) os = 'Linux';
  return `${browser} · ${os}`;
}

// 评论里存的地理 JSON（Cloudflare 边缘给的国家/省/市）转可读文字
function geoText(geo) {
  if (!geo) return '';
  try {
    const g = JSON.parse(geo);
    return [g.country, g.region, g.city].filter(Boolean).join(' ');
  } catch { return ''; }
}

export async function commentsPage(env, url) {
  const filter = url.searchParams.get('f') || 'pending';
  const where = filter === 'all' ? '' : filter === 'spam' ? "WHERE c.flag='spam'" : `WHERE c.status='${filter === 'approved' ? 'approved' : 'pending'}' AND c.flag=''`;
  const { results } = await env.DB.prepare(
    `SELECT c.*, m.content_md FROM comments c LEFT JOIN memos m ON m.id = c.memo_id ${where} ORDER BY c.created_at DESC LIMIT 100`
  ).all();
  const rows = (results || [])
    .map((c) => `<tr>
      <td><b>${esc(c.name)}</b>${c.flag === 'hidden' ? ' <span class="hint" style="color:#b58900">（已隐藏）</span>' : ''}${c.admin_only ? ' <span class="hint" style="color:#b58900">（🔒 仅管理员可见）</span>' : ''}${c.reply_to ? ` <span class="hint">回复 @${esc(c.reply_to)}</span>` : ''}：${esc(c.content)}<div class="hint">动态：${esc(String(c.memo_id ? c.content_md || '' : '').slice(0, 40))}（#${c.memo_id}）<br>${new Date((c.created_at + 28800) * 1000).toISOString().slice(0, 16).replace('T', ' ')} · IP ${esc(c.ip)}${geoText(c.geo) ? ` · ${esc(geoText(c.geo))}` : ''}${parseUa(c.user_agent) ? `<br><span title="${esc(c.user_agent)}">${esc(parseUa(c.user_agent))}</span>` : ''}</div></td>
      <td style="white-space:nowrap">
        ${c.status !== 'approved' ? `<form method="post" action="/admin/comments/${c.id}/approve" style="display:inline"><button class="btn" style="padding:4px 10px">通过</button></form>` : ''}
        ${c.flag !== 'spam' ? `<form method="post" action="/admin/comments/${c.id}/spam" style="display:inline"><button class="btn ghost" style="padding:4px 10px">标垃圾</button></form>` : ''}
        ${filter === 'all' ? (c.flag === 'hidden'
          ? `<form method="post" action="/admin/comments/${c.id}/unhide" style="display:inline"><button class="btn" style="padding:4px 10px">取消隐藏</button></form>`
          : `<form method="post" action="/admin/comments/${c.id}/hide" style="display:inline"><button class="btn ghost" style="padding:4px 10px">隐藏</button></form>`) : ''}
        <form method="post" action="/admin/comments/${c.id}/delete" style="display:inline"><button class="btn danger" style="padding:4px 10px">删除</button></form>
      </td></tr>`)
    .join('');
  const tab = (k, label) => `<a href="/admin/comments?f=${k}" style="${filter === k ? 'font-weight:700' : ''}">${label}</a>`;
  return page('后台 · 评论审核', `${nav()}
    <div class="card"><h2>评论审核</h2>
    <p>${tab('pending', '待审核')} · ${tab('approved', '已通过')} · ${tab('spam', '垃圾留言')} · ${tab('all', '全部')}</p>
    <table>${rows || '<tr><td>没有符合条件的评论。</td></tr>'}</table></div>`);
}

export async function commentAction(env, request, id, action) {
  if (action === 'approve') {
    await env.DB.prepare("UPDATE comments SET status='approved', flag='' WHERE id = ?").bind(id).run();
  } else if (action === 'spam') {
    await env.DB.prepare("UPDATE comments SET flag='spam' WHERE id = ?").bind(id).run();
  } else if (action === 'hide') {
    await env.DB.prepare("UPDATE comments SET flag='hidden' WHERE id = ? AND flag <> 'spam'").bind(id).run();
    return redirect('/admin/comments?f=all');
  } else if (action === 'unhide') {
    await env.DB.prepare("UPDATE comments SET flag='' WHERE id = ? AND flag = 'hidden'").bind(id).run();
    return redirect('/admin/comments?f=all');
  } else if (action === 'delete') {
    const c = await env.DB.prepare('SELECT * FROM comments WHERE id = ?').bind(id).first();
    if (c) {
      await toTrash(env, 'comment', id, `${c.name}：${String(c.content || '').slice(0, 60)}`, { comment: c });
    }
    await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
    await purgeTrash(env);
    // 从前台动态页删的，删完回原页面；从后台审核页删的，回审核页
    try {
      const ref = request && request.headers ? request.headers.get('referer') : null;
      if (ref) {
        const p = new URL(ref).pathname;
        if (p === '/' || p.startsWith('/memo/') || p.startsWith('/tag/')) return redirect(p);
      }
    } catch { /* 忽略来源解析失败 */ }
  }
  return redirect('/admin/comments');
}

// ---------------- 设置 ----------------

export async function settingsPage(env, url) {
  const s = await getSettings(env);
  const links = parseJsonSafe(s.links, [])
    .map((l) => `${l.name}|${l.url}`)
    .join('\n');
  const msg = url.searchParams.get('ok') ? '<div class="ok">已保存。</div>' : '';
  const perr = url.searchParams.get('perr') ? '<div class="err">改密失败：当前密码不对，或新密码不足 6 位 / 两次不一致。</div>' : '';
  const pok = url.searchParams.get('pok') ? '<div class="ok">密码已修改，新密码保存在数据库中。</div>' : '';
  const gok = url.searchParams.get('gok') ? '<div class="ok">全站访问密码设置已保存。</div>' : '';
  const gerr = url.searchParams.get('gerr') === 'need'
    ? '<div class="err">要开启全站密码，请先在下面设置一个访问密码。</div>'
    : url.searchParams.get('gerr') === 'len'
      ? '<div class="err">访问密码至少 4 位。</div>' : '';
  return page('后台 · 站点设置', `${nav()}${msg}${perr}${pok}${gok}${gerr}
    <div class="card"><h2>站点设置</h2>
    <form method="post" action="/admin/settings">
      <label>站点名称</label><input name="site_name" value="${esc(s.site_name)}">
      <label>昵称（显示在封面与每条动态上）</label><input name="nickname" value="${esc(s.nickname)}">
      <label>个性签名</label><input name="signature" value="${esc(s.signature)}">
      <label>公告（跑马灯：显示在首页时间线顶部横向滚动；留空 = 不显示）</label><input name="announce_text" value="${esc(s.announce_text || '')}" maxlength="200" placeholder="例如：欢迎来到我的朋友圈，本站已开启……">
      <label>头像图片（上传后自动保存替换，也可以直接填地址）</label>
      ${s.avatar_url ? `<img class="upl-prev" src="${esc(s.avatar_url)}" alt="">` : ''}
      <div class="upl-row"><input name="avatar_url" value="${esc(s.avatar_url)}" placeholder="/media/… 或 https://…"><label class="btn upl-btn">上传替换<input type="file" accept="image/*" data-for="avatar_url" hidden></label></div>
      <label>封面图片（页眉大图，上传后自动保存替换，也可以直接填地址）</label>
      ${s.cover_url ? `<img class="upl-prev wide" src="${esc(s.cover_url)}" alt="">` : ''}
      <div class="upl-row"><input name="cover_url" value="${esc(s.cover_url)}" placeholder="/media/… 或 https://…"><label class="btn upl-btn">上传替换<input type="file" accept="image/*" data-for="cover_url" hidden></label></div>
      <label style="display:block;margin:8px 0"><input type="checkbox" name="comments_enabled" value="1" style="width:auto" ${s.comments_enabled === '1' ? 'checked' : ''}> 开启评论</label>
      <label>评论是否审核</label>
      <select name="comments_moderation">
        <option value="1" ${s.comments_moderation !== '0' ? 'selected' : ''}>先审后显（评论要后台点通过才显示）</option>
        <option value="0" ${s.comments_moderation === '0' ? 'selected' : ''}>直接显示（正常评论立即显示，垃圾评论仍会被拦进垃圾箱）</option>
      </select>
      <label>防垃圾关键词（逗号分隔，昵称或评论命中任意一个即进垃圾箱）</label>
      <textarea name="spam_keywords" rows="2">${esc(s.spam_keywords || '')}</textarea>
      <label>友情链接（每行一条：名称|网址）</label>
      <textarea name="links" rows="4" placeholder="朋友的小站|https://example.com">${esc(links)}</textarea>
      <button class="btn" type="submit">保存设置</button>
    </form></div>
    <div class="card"><h2>全站访问密码</h2>
    <form method="post" action="/admin/settings/gate">
      <label style="display:block;margin:8px 0"><input type="checkbox" name="site_lock" value="1" style="width:auto" ${s.site_lock === '1' ? 'checked' : ''}> 开启全站密码（访客输对密码才能浏览全站，管理员登录状态不受影响）</label>
      <label>访问密码（${s.site_password_hash ? '已设置' : '尚未设置'}；留空 = 不修改）</label>
      <input name="site_password" type="password" autocomplete="new-password" placeholder="至少 4 位">
      <p class="hint">访客输对一次后 30 天内免输；重新设置密码会让所有访客重新输入新密码。图片、附件与 RSS 也一并受保护，后台路径 /admin 不受影响。</p>
      <button class="btn" type="submit">保存</button>
    </form></div>
    <div class="card"><h2>修改管理员密码</h2>
    <form method="post" action="/admin/settings/password">
      <label>当前密码</label><input name="current" type="password" required>
      <label>新密码（至少 6 位）</label><input name="next" type="password" required minlength="6">
      <label>再输一遍新密码</label><input name="next2" type="password" required minlength="6">
      <button class="btn" type="submit">修改密码</button>
    </form></div>
    <style>.upl-row{display:flex;gap:8px;align-items:center}.upl-row input{flex:1}.upl-btn{cursor:pointer;white-space:nowrap;margin:0}.upl-prev{width:64px;height:64px;object-fit:cover;border-radius:8px;display:block;margin:2px 0 6px}.upl-prev.wide{width:220px;height:80px}</style>
    <script>
    async function shrinkImage(file){
      if(!file || !/^image\\/(jpeg|png|webp)$/.test(file.type || '') || file.size < 300*1024) return file;
      try{
        var bmp = await createImageBitmap(file);
        var sc = Math.min(1, 1920/Math.max(bmp.width, bmp.height));
        var w = Math.max(1, Math.round(bmp.width*sc)), h = Math.max(1, Math.round(bmp.height*sc));
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
        var blob = await new Promise(function(res){ cv.toBlob(res, 'image/webp', 0.82); });
        if(!blob || blob.size >= file.size) return file;
        return new File([blob], (file.name || 'image').replace(/\\.[^.]+$/, '') + '.webp', {type: 'image/webp'});
      }catch(e){ return file; }
    }
    document.querySelectorAll('input[type=file][data-for]').forEach(function(inp){
      inp.addEventListener('change', async function(){
        var file = inp.files && inp.files[0]; if(!file) return;
        file = await shrinkImage(file);
        var fd = new FormData(); fd.append('file', file);
        try {
          var r = await fetch('/admin/upload', {method:'POST', body: fd});
          var j = await r.json();
          if(!j.url) throw new Error(j.error || '上传失败');
          document.querySelector('input[name="' + inp.dataset.for + '"]').value = j.url;
          inp.closest('form').submit();
        } catch(e){ alert('上传失败：' + e.message); }
        inp.value = '';
      });
    });
    </script>`);
}

export async function settingsSave(env, request) {
  const f = await request.formData();
  const links = String(f.get('links') || '')
    .split('\n')
    .map((line) => {
      const [name, url] = line.split('|').map((x) => (x || '').trim());
      return name && url ? { name, url } : null;
    })
    .filter(Boolean)
    .slice(0, 30);
  await setSetting(env, 'site_name', f.get('site_name'));
  await setSetting(env, 'nickname', f.get('nickname'));
  await setSetting(env, 'signature', f.get('signature'));
  await setSetting(env, 'announce_text', String(f.get('announce_text') || '').trim().slice(0, 200));
  await setSetting(env, 'avatar_url', f.get('avatar_url'));
  await setSetting(env, 'cover_url', f.get('cover_url'));
  await setSetting(env, 'comments_enabled', f.get('comments_enabled') ? '1' : '0');
  await setSetting(env, 'comments_moderation', f.get('comments_moderation') === '0' ? '0' : '1');
  await setSetting(env, 'spam_keywords', String(f.get('spam_keywords') || '').slice(0, 2000));
  await setSetting(env, 'links', JSON.stringify(links));
  return redirect('/admin/settings?ok=1');
}

export async function passwordChange(env, request) {
  const f = await request.formData();
  const cur = String(f.get('current') || '');
  const next = String(f.get('next') || '');
  const next2 = String(f.get('next2') || '');
  const hash = await effectiveAdminHash(env);
  if (!hash || (await sha256Hex(cur)) !== hash || next.length < 6 || next !== next2) {
    return redirect('/admin/settings?perr=1');
  }
  await setSetting(env, 'admin_password_hash', await sha256Hex(next));
  return redirect('/admin/settings?pok=1');
}

// ---------------- 上传与导出 ----------------

export async function upload(env, request) {
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string' || !file.size) {
    return Response.json({ error: '没有文件' }, { status: 400 });
  }
  if (file.size > 25 * 1024 * 1024) {
    return Response.json({ error: '文件超过 25MB' }, { status: 400 });
  }
  const safe = (file.name || 'file').replace(/[^\w.\-]+/g, '_').slice(-60);
  const key = `uploads/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  await env.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });
  await env.DB.prepare('INSERT INTO media (r2_key, filename, mime, size, created_at) VALUES (?,?,?,?,?)')
    .bind(key, file.name || '', file.type || '', file.size, nowSec()).run();
  return Response.json({ url: '/media/' + key, key });
}

async function buildExportObject(env) {
  const out = {};
  for (const t of ['memos', 'comments', 'likes', 'media', 'settings']) {
    if (t === 'settings') {
      const { results } = await env.DB.prepare(
        "SELECT key, value FROM settings WHERE key NOT IN ('admin_password_hash','site_secret','setup_token_hash','site_password_hash','site_gate_token')"
      ).all();
      out[t] = results;
    } else {
      const { results } = await env.DB.prepare(`SELECT * FROM ${t}`).all();
      out[t] = results;
    }
  }
  return out;
}

export async function exportAll(env) {
  const out = await buildExportObject(env);
  return new Response(JSON.stringify(out, null, 1), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="moments-export.json"',
    },
  });
}

// ---- 完整备份：ZIP 流式打包（不压缩、数据描述符，边读 R2 边写，内存占用恒定） ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32Feed(state, bytes) {
  let c = state;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return c >>> 0;
}
function dosDateTime(d = new Date()) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
  const date = (((Math.max(0, d.getFullYear() - 1980)) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

export async function exportZip(env) {
  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const central = [];
  let offset = 0;
  const write = async (bytes) => { await writer.write(bytes); offset += bytes.length; };

  async function addEntry(name, produce) {
    const nameBytes = enc.encode(name);
    const { time, date } = dosDateTime();
    const localOffset = offset;
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0808, true); // bit3 数据描述符 + bit11 UTF-8 文件名
    head.setUint16(8, 0, true); // method: store
    head.setUint16(10, time, true);
    head.setUint16(12, date, true);
    head.setUint32(14, 0, true);
    head.setUint32(18, 0, true);
    head.setUint32(22, 0, true);
    head.setUint16(26, nameBytes.length, true);
    head.setUint16(28, 0, true);
    await write(new Uint8Array(head.buffer));
    await write(nameBytes);
    let crcState = 0xFFFFFFFF;
    let size = 0;
    const sink = async (chunk) => { crcState = crc32Feed(crcState, chunk); size += chunk.length; await write(chunk); };
    await produce(sink);
    const crc = (crcState ^ 0xFFFFFFFF) >>> 0;
    const desc = new DataView(new ArrayBuffer(16));
    desc.setUint32(0, 0x08074b50, true);
    desc.setUint32(4, crc, true);
    desc.setUint32(8, size, true);
    desc.setUint32(12, size, true);
    await write(new Uint8Array(desc.buffer));
    central.push({ nameBytes, time, date, crc, size, localOffset });
  }

  (async () => {
    try {
      const json = JSON.stringify(await buildExportObject(env), null, 1);
      await addEntry('moments-export.json', async (sink) => { await sink(enc.encode(json)); });
      // 上传文件（uploads/）+ 站点自有资源（site/，排除批量生成的游客头像包）
      const keys = [];
      for (const prefix of ['uploads/', 'site/']) {
        let cursor;
        do {
          const page = await env.MEDIA.list({ prefix, cursor, limit: 500 });
          for (const o of page.objects) {
            if (o.key.startsWith('site/avatars/')) continue;
            keys.push(o.key);
          }
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
      }
      for (const key of keys) {
        const obj = await env.MEDIA.get(key);
        if (!obj || !obj.body) continue;
        await addEntry('media/' + key, async (sink) => {
          const reader = obj.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            await sink(value);
          }
        });
      }
      const cdStart = offset;
      for (const c of central) {
        const cd = new DataView(new ArrayBuffer(46));
        cd.setUint32(0, 0x02014b50, true);
        cd.setUint16(4, 20, true);
        cd.setUint16(6, 20, true);
        cd.setUint16(8, 0x0808, true);
        cd.setUint16(10, 0, true);
        cd.setUint16(12, c.time, true);
        cd.setUint16(14, c.date, true);
        cd.setUint32(16, c.crc, true);
        cd.setUint32(20, c.size, true);
        cd.setUint32(24, c.size, true);
        cd.setUint16(28, c.nameBytes.length, true);
        cd.setUint32(42, c.localOffset, true);
        await write(new Uint8Array(cd.buffer));
        await write(c.nameBytes);
      }
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true);
      end.setUint16(8, central.length, true);
      end.setUint16(10, central.length, true);
      end.setUint32(12, offset - cdStart, true);
      end.setUint32(16, cdStart, true);
      await write(new Uint8Array(end.buffer));
    } catch {
      // 写流失败时直接关闭，浏览器会得到截断文件（极少发生）
    } finally {
      try { await writer.close(); } catch { /* already closed */ }
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="moments-backup.zip"',
    },
  });
}

// ---- 恢复备份：上传完整备份 ZIP（或旧版 JSON）整站覆盖恢复 ----
const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', ico: 'image/x-icon', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', pdf: 'application/pdf', zip: 'application/zip',
  txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', json: 'application/json',
};
function mimeOf(key, known) {
  if (known) return known;
  const ext = String(key).split('.').pop().toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

async function unzipAll(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  const min = Math.max(0, buf.length - 65558);
  for (let i = buf.length - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    if (!name.endsWith('/')) {
      if (method === 0) {
        files.set(name, comp.slice());
      } else if (method === 8) {
        const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        files.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
      } else {
        throw new Error(`不支持的 ZIP 压缩方式（method ${method}）`);
      }
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const PROTECTED_SETTING_KEYS = new Set(['admin_password_hash', 'site_secret', 'setup_token_hash', 'site_password_hash', 'site_gate_token']);

async function restoreFromData(env, data, mediaFiles) {
  if (!data || !Array.isArray(data.memos) || !Array.isArray(data.comments)) {
    throw new Error('备份内容不对：缺少动态/评论数据');
  }
  // 恢复前先把当前数据存一份快照到 R2（只存数据 JSON；文件同名覆盖、多余不删，文件层面基本无损）
  try {
    const snap = JSON.stringify(await buildExportObject(env));
    await env.MEDIA.put(`backups/pre-restore-${Date.now()}.json`, snap, { httpMetadata: { contentType: 'application/json' } });
  } catch { /* 快照失败不阻断恢复 */ }

  // 先写文件（同 key 覆盖），后换数据，避免数据指向不存在的文件
  const mimeByKey = new Map((data.media || []).map((r) => [r.r2_key, r.mime]));
  let fileCount = 0;
  for (const [key, bytes] of mediaFiles) {
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mimeOf(key, mimeByKey.get(key)) } });
    fileCount++;
  }

  // 按各表实际列名过滤备份行（容忍版本差异），保留原 ID 让 /memo/<id> 链接不变
  const tableCols = {};
  for (const t of ['memos', 'comments', 'likes', 'media']) {
    const { results } = await env.DB.prepare(`SELECT name FROM pragma_table_info('${t}')`).all();
    tableCols[t] = results.map((r) => r.name);
  }
  const stmts = [
    env.DB.prepare('DELETE FROM comments'),
    env.DB.prepare('DELETE FROM likes'),
    env.DB.prepare('DELETE FROM media'),
    env.DB.prepare('DELETE FROM memos'),
    env.DB.prepare('DELETE FROM trash'),
  ];
  for (const t of ['memos', 'comments', 'likes', 'media']) {
    for (const row of data[t] || []) {
      const cols = tableCols[t].filter((c) => Object.prototype.hasOwnProperty.call(row, c));
      if (!cols.length) continue;
      const sql = `INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
      stmts.push(env.DB.prepare(sql).bind(...cols.map((c) => row[c])));
    }
  }
  for (let i = 0; i < stmts.length; i += 100) {
    await env.DB.batch(stmts.slice(i, i + 100));
  }
  for (const row of data.settings || []) {
    if (!row.key || PROTECTED_SETTING_KEYS.has(row.key)) continue;
    if (/^(acct_usage|r2_usage|reqcnt:|llock:)/.test(row.key)) continue;
    await setSetting(env, row.key, row.value);
  }
  return {
    memos: (data.memos || []).length,
    comments: (data.comments || []).length,
    files: fileCount,
  };
}

export async function importPage(env, url) {
  const ok = url.searchParams.get('ok');
  const err = url.searchParams.get('err');
  const stats = ok ? `<div class="ok">恢复完成：动态 ${esc(url.searchParams.get('m') || '0')} 条、评论 ${esc(url.searchParams.get('c') || '0')} 条、文件 ${esc(url.searchParams.get('f') || '0')} 个。</div>` : '';
  const errBox = err ? `<div class="err">恢复失败：${esc(err)}</div>` : '';
  return page('后台 · 恢复备份', `${nav()}${stats}${errBox}
    <div class="card"><h2>📥 恢复备份</h2>
    <p class="hint" style="margin-bottom:10px">上传「完整备份」的 ZIP 文件（或旧的 moments-export.json，只有数据、没有文件）。<b>恢复是整站覆盖</b>：现有的动态、评论、点赞会被备份内容替换（原链接 ID 保持不变）；管理员密码不会被覆盖，你不会被锁在外面。恢复开始前，系统会自动把当前数据存一份快照到 R2 的 backups/ 目录，万一恢复错了还能找回来。</p>
    <form method="post" action="/admin/import" enctype="multipart/form-data" onsubmit="return document.getElementById('ack').checked && confirm('确定用这份备份覆盖当前全站数据？')">
      <label>选择备份文件</label>
      <input type="file" name="backup" accept=".zip,.json,application/zip,application/json" required>
      <label style="display:block;margin:8px 0"><input type="checkbox" id="ack" style="width:auto"> 我明白：恢复会覆盖当前全部动态与评论数据</label>
      <button class="btn danger" type="submit">开始恢复</button>
    </form></div>`);
}

export async function importRestore(env, request) {
  const f = await request.formData();
  const file = f.get('backup');
  if (!file || typeof file === 'string' || !file.size) return redirect('/admin/import?err=' + encodeURIComponent('没有选择文件'));
  if (file.size > 100 * 1024 * 1024) return redirect('/admin/import?err=' + encodeURIComponent('备份文件超过 100MB，暂不支持'));
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    let data;
    let mediaFiles = new Map();
    if (buf[0] === 0x7B) { // '{' 开头 = 纯 JSON 导出
      data = JSON.parse(new TextDecoder().decode(buf));
    } else {
      const files = await unzipAll(buf);
      const jsonBytes = files.get('moments-export.json');
      if (!jsonBytes) throw new Error('ZIP 里没有 moments-export.json，这不是本站的完整备份');
      data = JSON.parse(new TextDecoder().decode(jsonBytes));
      for (const [name, bytes] of files) {
        if (name.startsWith('media/') && name.length > 6) mediaFiles.set(name.slice(6), bytes);
      }
    }
    const r = await restoreFromData(env, data, mediaFiles);
    return redirect(`/admin/import?ok=1&m=${r.memos}&c=${r.comments}&f=${r.files}`);
  } catch (e) {
    return redirect('/admin/import?err=' + encodeURIComponent(String((e && e.message) || e).slice(0, 120)));
  }
}

export async function formPage(env, id) {
  const settings = await getSettings(env);
  let memo = null;
  if (id) {
    memo = await env.DB.prepare('SELECT * FROM memos WHERE id = ?').bind(id).first();
    if (!memo) return redirect('/admin');
  }
  return page(id ? '后台 · 编辑动态' : '后台 · 发布动态', `${nav()}${memoForm(memo, settings)}`);
}

export { requireAdmin, memoForm };
