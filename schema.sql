-- cf-d1-moments 数据表（程序首次访问会自动建表，本文件仅作结构参考）
CREATE TABLE IF NOT EXISTS memos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  files_gated INTEGER NOT NULL DEFAULT 0,
  content_gated INTEGER NOT NULL DEFAULT 0,
  view_password_hash TEXT NOT NULL DEFAULT '',  -- 单条动态观看密码的 sha256，空 = 无密码
  content_md TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  media TEXT NOT NULL DEFAULT '[]',       -- JSON: [{type:'image'|'video', url}]
  ext_type TEXT NOT NULL DEFAULT '',     -- '', 'video', 'music', 'douban', 'link'
  ext_data TEXT NOT NULL DEFAULT '{}',    -- JSON: {url, embed, title, cover, desc}
  pinned INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,       -- 1 = 隐藏，仅管理员可见
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memo_id INTEGER NOT NULL,
  parent_id INTEGER NOT NULL DEFAULT 0,   -- 0=顶层评论；否则为顶层评论 id（回复挂在其下）
  reply_to TEXT NOT NULL DEFAULT '',       -- 被回复者昵称
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending / approved
  flag TEXT NOT NULL DEFAULT '',           -- '' / 'spam'
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS likes (
  memo_id INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (memo_id, ip_hash)
);
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS visitors (
  ip_hash TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trash (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ref_id INTEGER NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,
  deleted_at INTEGER NOT NULL
);
