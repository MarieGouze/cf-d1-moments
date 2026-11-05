// D1 数据层：动态（memos）、评论、点赞、媒体、设置、会话。首次访问自动建表。
import { sha256Hex, randomToken, nowSec } from './utils.js';

// 版本号（2026-10-26 用户定）：三段式 2.中.尾——增减功能递增中段、尾段归零；修 bug 只递增尾段。
export const VERSION = '2.23.1';

const CREATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS memos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '',
    content_md TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    media TEXT NOT NULL DEFAULT '[]',
    ext_type TEXT NOT NULL DEFAULT '',
    ext_data TEXT NOT NULL DEFAULT '{}',
    pinned INTEGER NOT NULL DEFAULT 0,
    files_gated INTEGER NOT NULL DEFAULT 0,
    content_gated INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memo_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    flag TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS likes (
    memo_id INTEGER NOT NULL,
    ip_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (memo_id, ip_hash)
  )`,
  `CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    r2_key TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL DEFAULT '',
    mime TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS trash (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    ref_id INTEGER NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL,
    deleted_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS visitors (
    ip_hash TEXT PRIMARY KEY,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL DEFAULT '',
    reg_ip TEXT NOT NULL DEFAULT '',
    status INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER NOT NULL DEFAULT 0,
    login_count INTEGER NOT NULL DEFAULT 0,
    last_ip TEXT NOT NULL DEFAULT '',
    last_geo TEXT NOT NULL DEFAULT '',
    last_ua TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id INTEGER NOT NULL,
    from_name TEXT NOT NULL DEFAULT '',
    to_id INTEGER NOT NULL,
    to_name TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    del_from INTEGER NOT NULL DEFAULT 0,
    del_to INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_msg_to ON messages(to_id, is_read, id)`,
  `CREATE INDEX IF NOT EXISTS idx_msg_from ON messages(from_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS downloads (
    file_key TEXT PRIMARY KEY,
    cnt INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'reply',
    memo_id INTEGER NOT NULL DEFAULT 0,
    comment_id INTEGER NOT NULL DEFAULT 0,
    actor TEXT NOT NULL DEFAULT '',
    excerpt TEXT NOT NULL DEFAULT '',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_memos_created ON memos(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_memo ON comments(memo_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, id)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_ip ON comments(ip, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at DESC)`,
];

export const DEFAULT_SETTINGS = {
  site_name: '我的朋友圈',
  nickname: '主人',
  avatar_url: '',
  cover_url: '',
  cover_mode: 'manual',
  signature: '记录生活，留住瞬间。',
  comments_enabled: '1',
  comments_moderation: '1',
  registration_open: '1',
  users_can_post: '0',
  site_lock: '0',
  site_password_hash: '',
  site_gate_token: '',
  announce_text: '',
  trash_days: '30',
  site_since: '',
  spam_keywords: '博彩,赌场,澳门赌场,威尼斯人,线上棋牌,代开发票,贷款推广,SEO推广,刷单兼职,菠菜,六合彩,时时彩,加微信,微信号,代孕,发票代开',
  links: '[]',
};

let initialized = false;

export async function initDb(env) {
  if (initialized) return;
  // 建表 + 默认设置合并成一次 batch：冷启动从几十趟往返降到一趟
  const stmts = CREATE_STATEMENTS.map((sql) => env.DB.prepare(sql));
  const entries = Object.entries(DEFAULT_SETTINGS);
  stmts.push(
    env.DB.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ${entries.map(() => '(?, ?)').join(', ')}`)
      .bind(...entries.flatMap(([k, v]) => [k, v]))
  );
  await env.DB.batch(stmts);
  // 迁移：comments.parent_id / reply_to（评论回复：挂到顶层评论下，reply_to 存被回复者昵称）
  const cCols = await env.DB.prepare("PRAGMA table_info(comments)").all();
  const cNames = (cCols.results || []).map((c) => c.name);
  if (!cNames.includes('parent_id')) {
    await env.DB.prepare('ALTER TABLE comments ADD COLUMN parent_id INTEGER NOT NULL DEFAULT 0').run();
  }
  if (!cNames.includes('reply_to')) {
    await env.DB.prepare("ALTER TABLE comments ADD COLUMN reply_to TEXT NOT NULL DEFAULT ''").run();
  }
  if (!cNames.includes('geo')) {
    await env.DB.prepare("ALTER TABLE comments ADD COLUMN geo TEXT NOT NULL DEFAULT ''").run();
  }
  // 迁移：comments.admin_only（评论者勾选「仅管理员可见」时为 1，前台对非管理员不显示、不计入数量）
  if (!cNames.includes('admin_only')) {
    await env.DB.prepare('ALTER TABLE comments ADD COLUMN admin_only INTEGER NOT NULL DEFAULT 0').run();
  }
  // 迁移：messages.del_from / del_to（删除对话只删自己一侧：发信人删置 del_from、收信人删置 del_to）
  const msgCols = await env.DB.prepare("PRAGMA table_info(messages)").all();
  const msgNames = (msgCols.results || []).map((c) => c.name);
  if (msgNames.length && !msgNames.includes('del_from')) {
    await env.DB.prepare('ALTER TABLE messages ADD COLUMN del_from INTEGER NOT NULL DEFAULT 0').run();
  }
  if (msgNames.length && !msgNames.includes('del_to')) {
    await env.DB.prepare('ALTER TABLE messages ADD COLUMN del_to INTEGER NOT NULL DEFAULT 0').run();
  }
  // 迁移：memos.hidden（隐藏动态，仅管理员可见）
  const cols = await env.DB.prepare("PRAGMA table_info(memos)").all();
  if (!(cols.results || []).some((c) => c.name === 'hidden')) {
    await env.DB.prepare('ALTER TABLE memos ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0').run();
  }
  // 迁移：memos.title（可选标题，加粗独立一行显示在正文上方）
  if (!(cols.results || []).some((c) => c.name === 'title')) {
    await env.DB.prepare("ALTER TABLE memos ADD COLUMN title TEXT NOT NULL DEFAULT ''").run();
  }
  // 迁移：memos.files_gated（附件文件回复后可见）
  if (!(cols.results || []).some((c) => c.name === 'files_gated')) {
    await env.DB.prepare('ALTER TABLE memos ADD COLUMN files_gated INTEGER NOT NULL DEFAULT 0').run();
  }
  // 迁移：memos.content_gated（正文回复后可见：正文、媒体、附加内容整体门控，标题照常显示）
  if (!(cols.results || []).some((c) => c.name === 'content_gated')) {
    await env.DB.prepare('ALTER TABLE memos ADD COLUMN content_gated INTEGER NOT NULL DEFAULT 0').run();
  }
  // 迁移：memos.views（浏览量：详情页打开计数，同一浏览器同一天对同一条只计一次）
  if (!(cols.results || []).some((c) => c.name === 'views')) {
    await env.DB.prepare('ALTER TABLE memos ADD COLUMN views INTEGER NOT NULL DEFAULT 0').run();
  }
  // 迁移：memos.view_password_hash（单条动态观看密码的 sha256；空 = 无密码）
  if (!(cols.results || []).some((c) => c.name === 'view_password_hash')) {
    await env.DB.prepare("ALTER TABLE memos ADD COLUMN view_password_hash TEXT NOT NULL DEFAULT ''").run();
  }
  // 迁移：memos.comments_members_only（仅注册用户可评论，逐条动态可选）
  if (!(cols.results || []).some((c) => c.name === 'comments_members_only')) {
    await env.DB.prepare('ALTER TABLE memos ADD COLUMN comments_members_only INTEGER NOT NULL DEFAULT 0').run();
  }
  // 迁移：memos.members_only（仅注册用户可见：游客看不到正文与评论，只看到登录/注册提示）
  if (!(cols.results || []).some((c) => c.name === 'members_only')) {
    await env.DB.prepare('ALTER TABLE memos ADD COLUMN members_only INTEGER NOT NULL DEFAULT 0').run();
  }
  // 迁移：memos.author_id / author_name（投稿作者：0+空 = 站长本人；>0 = 注册用户投稿，记其用户名）
  if (!(cols.results || []).some((c) => c.name === 'author_id')) {
    await env.DB.prepare('ALTER TABLE memos ADD COLUMN author_id INTEGER NOT NULL DEFAULT 0').run();
  }
  if (!(cols.results || []).some((c) => c.name === 'author_name')) {
    await env.DB.prepare("ALTER TABLE memos ADD COLUMN author_name TEXT NOT NULL DEFAULT ''").run();
  }
  // 迁移：sessions.user_id（0 = 管理员会话，>0 = 注册用户 id）——注册用户与管理员共用会话表、不同 cookie
  const sCols = await env.DB.prepare("PRAGMA table_info(sessions)").all();
  if (!(sCols.results || []).some((c) => c.name === 'user_id')) {
    await env.DB.prepare('ALTER TABLE sessions ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0').run();
  }
  // 迁移：users.avatar（注册时随机绑定的头像路径，绑定后不可修改；老用户首次登录时补绑）
  const usrAvCols = await env.DB.prepare("PRAGMA table_info(users)").all();
  if (!(usrAvCols.results || []).some((c) => c.name === 'avatar')) {
    await env.DB.prepare("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''").run();
  }
  // 迁移：users 的状态与最后登录上下文（禁用标记 + 最后登录的 IP/地区/UA，后台用户管理页展示用）
  const uCols = await env.DB.prepare("PRAGMA table_info(users)").all();
  const uNames = (uCols.results || []).map((c) => c.name);
  if (uNames.length && !uNames.includes('status')) {
    await env.DB.prepare('ALTER TABLE users ADD COLUMN status INTEGER NOT NULL DEFAULT 0').run();
  }
  if (uNames.length && !uNames.includes('last_ip')) {
    await env.DB.prepare("ALTER TABLE users ADD COLUMN last_ip TEXT NOT NULL DEFAULT ''").run();
  }
  if (uNames.length && !uNames.includes('last_geo')) {
    await env.DB.prepare("ALTER TABLE users ADD COLUMN last_geo TEXT NOT NULL DEFAULT ''").run();
  }
  if (uNames.length && !uNames.includes('last_ua')) {
    await env.DB.prepare("ALTER TABLE users ADD COLUMN last_ua TEXT NOT NULL DEFAULT ''").run();
  }
  if (uNames.length && !uNames.includes('login_count')) {
    await env.DB.prepare('ALTER TABLE users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0').run();
  }
  // 建站时间：首次初始化时记为当前时间（页脚「建站第 N 天」用），之后不再变动
  const since = await env.DB.prepare("SELECT value FROM settings WHERE key = 'site_since'").first();
  if (!since || !since.value) {
    await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('site_since', ?)").bind(String(nowSec())).run();
  }
  // 站点密钥（验证码签名等用）：首次生成后固定存库
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'site_secret'").first();
  if (!row) {
    await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      .bind('site_secret', randomToken() + randomToken()).run();
  }
  initialized = true;
}

// 设置进程内缓存：同一 Worker 实例 15 秒内复用，省掉每次请求一趟全表查询；setSetting 写入时立即作废本机缓存
let settingsCache = { at: 0, val: null };
export async function getSettings(env) {
  if (settingsCache.val && Date.now() - settingsCache.at < 15000) return settingsCache.val;
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of results || []) out[r.key] = r.value;
  settingsCache = { at: Date.now(), val: out };
  return out;
}

export async function setSetting(env, key, value) {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(key, String(value ?? '')).run();
  settingsCache.val = null;
}

// ---------- 管理员与会话（密码哈希存 D1，部署冲不掉） ----------

export async function effectiveAdminHash(env) {
  const s = await getSettings(env);
  return s.admin_password_hash || '';
}

export async function isSetupPending(env) {
  const s = await getSettings(env);
  return !s.admin_password_hash;
}

export async function createSession(env) {
  const token = randomToken();
  const hash = await sha256Hex(token);
  const now = nowSec();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
  await env.DB.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)')
    .bind(hash, now, now + 30 * 24 * 3600).run();
  return token;
}

export async function isAdmin(env, request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)mm_session=([a-f0-9]{64})/);
  if (!m) return false;
  const hash = await sha256Hex(m[1]);
  const row = await env.DB.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').bind(hash).first();
  return !!row && row.expires_at > nowSec();
}

export async function destroySession(env, request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)mm_session=([a-f0-9]{64})/);
  if (m) {
    const hash = await sha256Hex(m[1]);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
  }
}

export function sessionCookie(token) {
  return `mm_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 3600}`;
}

// ---------- 注册用户会话（cookie mm_user，与管理员 mm_session 分开） ----------

export async function createUserSession(env, userId) {
  const token = randomToken();
  const hash = await sha256Hex(token);
  const now = nowSec();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
  await env.DB.prepare('INSERT INTO sessions (token_hash, created_at, expires_at, user_id) VALUES (?, ?, ?, ?)')
    .bind(hash, now, now + 30 * 24 * 3600, userId).run();
  return token;
}

export async function currentUser(env, request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)mm_user=([a-f0-9]{64})/);
  if (!m) return null;
  const hash = await sha256Hex(m[1]);
  const row = await env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').bind(hash).first();
  if (!row || !row.user_id || row.expires_at <= nowSec()) return null;
  const u = await env.DB.prepare('SELECT id, username, status, avatar FROM users WHERE id = ?').bind(row.user_id).first();
  if (!u || u.status) return null;
  return { id: u.id, username: u.username, avatar: u.avatar || '' };
}

// 注册时随机绑定的头像（内置 micah 头像包，绑定后不可修改）
export function randomAvatar() {
  return '/media/site/avatars/micah/' + Math.floor(Math.random() * 100) + '.svg';
}

export async function destroyUserSession(env, request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)mm_user=([a-f0-9]{64})/);
  if (m) {
    const hash = await sha256Hex(m[1]);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
  }
}

export function userCookie(token) {
  return `mm_user=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 3600}`;
}

export const clearUserCookie = 'mm_user=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

export const clearSessionCookie = 'mm_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

// ---------- 通知提醒（注册用户被回复 / 投稿被评论） ----------
// 一条已通过审核的评论产生通知的时机有二：发表时即通过（发表处调用）、
// 或先待审后由管理员通过（审核处调用，按 comment_id 去重，不会重复发）。
export async function notifyForComment(env, c) {
  try {
    if (!c || !c.id || !c.memo_id) return;
    const recipients = new Map(); // user_id -> type
    const settings = await getSettings(env);
    const adminName = settings.nickname || '';
    // 1) 被回复的人：reply_to 是评论里记下的被回复者昵称，能对上注册用户才通知
    if (c.reply_to && c.reply_to !== c.name) {
      const u = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(c.reply_to).first();
      if (u) recipients.set(u.id, 'reply');
    }
    // 1b) 被回复的是站长本人（reply_to 对上站长昵称）：站长以 user_id 0 收通知，前台信封角标可见
    if (adminName && c.reply_to === adminName && c.name !== adminName) recipients.set(0, 'reply');
    // 2) 投稿作者：有人评论了我发的动态（与被回复的是同一人时只发一条，按回复计）
    const memo = await env.DB.prepare('SELECT author_id FROM memos WHERE id = ?').bind(c.memo_id).first();
    if (memo && memo.author_id > 0 && !recipients.has(memo.author_id)) {
      const au = await env.DB.prepare('SELECT id, username FROM users WHERE id = ?').bind(memo.author_id).first();
      if (au && au.username !== c.name) recipients.set(au.id, 'comment');
    }
    // 2b) 站长的动态被评论：同样通知站长（站长自己评论不通知自己）
    if (memo && memo.author_id === 0 && adminName && c.name !== adminName && !recipients.has(0)) {
      recipients.set(0, 'comment');
    }
    const excerpt = String(c.content || '').slice(0, 60);
    const now = nowSec();
    for (const [uid, type] of recipients) {
      await env.DB.prepare(
        'INSERT INTO notifications (user_id, type, memo_id, comment_id, actor, excerpt, created_at) ' +
        'SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = ? AND comment_id = ?)'
      ).bind(uid, type, c.memo_id, c.id, String(c.name || ''), excerpt, now, uid, c.id).run();
    }
  } catch { /* 通知失败不影响评论本身 */ }
}

// 站长信封角标 = 站长未读通知（user_id 0）+ 发给站长的未读私信
export async function unreadAdminCount(env) {
  try {
    const r = await env.DB.prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = 0 AND is_read = 0 AND type != 'dm'").first();
    const d = await env.DB.prepare('SELECT COUNT(*) AS c FROM messages WHERE to_id = 0 AND is_read = 0 AND del_to = 0').first();
    return (r ? r.c : 0) + (d ? d.c : 0);
  } catch { return 0; }
}

export async function unreadNotifCount(env, userId) {
  if (!userId) return 0;
  try {
    // 铃铛角标 = 未读通知（评论/回复，dm 旧行不计）+ 未读私信条数，两边共用一个铃铛
    const r = await env.DB.prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0 AND type != 'dm'").bind(userId).first();
    const d = await env.DB.prepare('SELECT COUNT(*) AS c FROM messages WHERE to_id = ? AND is_read = 0 AND del_to = 0').bind(userId).first();
    return (r ? r.c : 0) + (d ? d.c : 0);
  } catch { return 0; }
}

// ---------- 全站访问密码（密码门） ----------
// 访客输对密码后下发 mm_gate cookie，值为 settings.site_gate_token；
// 管理员在后台重设全站密码时轮换 token，所有访客的旧 cookie 自动失效。

export function gateCookieOk(request, s) {
  if (!s.site_gate_token) return false;
  const c = request.headers.get('Cookie') || '';
  const m = c.match(/(?:^|;\s*)mm_gate=([A-Za-z0-9_-]+)/);
  return !!m && m[1] === s.site_gate_token;
}

export function gateCookie(token) {
  return `mm_gate=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 3600}`;
}

// ---------- 动态 ----------

export function parseTags(text) {
  return String(text || '')
    .split(/[,，#\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function parseJsonSafe(text, fallback) {
  try {
    const v = JSON.parse(text || '');
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
