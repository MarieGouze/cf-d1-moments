// D1 数据层：动态（memos）、评论、点赞、媒体、设置、会话。首次访问自动建表。
import { sha256Hex, randomToken, nowSec } from './utils.js';

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
  `CREATE INDEX IF NOT EXISTS idx_memos_created ON memos(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_memo ON comments(memo_id, status)`,
];

export const DEFAULT_SETTINGS = {
  site_name: '我的朋友圈',
  nickname: '主人',
  avatar_url: '',
  cover_url: '',
  signature: '记录生活，留住瞬间。',
  comments_enabled: '1',
  comments_moderation: '1',
  site_lock: '0',
  site_password_hash: '',
  site_gate_token: '',
  trash_days: '30',
  site_since: '',
  spam_keywords: '博彩,赌场,澳门赌场,威尼斯人,线上棋牌,代开发票,贷款推广,SEO推广,刷单兼职,菠菜,六合彩,时时彩,加微信,微信号,代孕,发票代开',
  links: '[]',
};

let initialized = false;

export async function initDb(env) {
  if (initialized) return;
  for (const sql of CREATE_STATEMENTS) {
    await env.DB.prepare(sql).run();
  }
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind(k, v).run();
  }
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

export const clearSessionCookie = 'mm_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

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
