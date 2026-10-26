# cf-d1-moments · 极简朋友圈（Cloudflare 版）

照 [kingwrcy/moments](https://github.com/kingwrcy/moments) 的版面，在 Cloudflare 上自研重写的「朋友圈」式极简微博：封面 + 头像时间线、发动态、图片/视频九宫格、点赞评论，全部跑在 Cloudflare 免费额度里，零服务器、零依赖。

- 一个 **Worker**（原生 JavaScript，无框架、无构建）跑全部页面与接口
- **D1**（SQLite）存动态、评论、设置与密码；**R2** 存图片/视频/附件（经 Worker 代理读取，桶不公开）
- 一切配置只存 D1，重新部署不会冲掉密码

**当前版本 2.9.1**（版本号：增减功能进中段、修 bug 进尾段；页脚显示当前版本）

## 功能一览

- **发动态**：富文本 / Markdown 双模式；标题、标签、置顶、定时发布、隐藏；图片视频九宫格、任意文件、B 站/YouTube/网易云/豆瓣/链接卡片、抖音嵌入；上传图片自动压缩
- **可见范围**（逐条可选）：公开 / 观看密码 / 回复后可见（正文或附件）/ 仅注册用户可评论 / 仅注册用户可见
- **全站密码门**（可选）：访客输对密码才能浏览全站，30 天免输
- **互动**：点赞（IP 去重）；评论（回复、表情、50 字上限）；首页点 💬 原地弹评论框
- **访客账号**（可开关）：自助注册（图形验证码）；登录后用用户名评论、免验证码；游客免填昵称、只填验证码，随机显示「游客XXX」；评论可勾「仅管理员可见」（别人只看到橙色「隐藏评论」占位）
- **评论治理**：先审后显可切换；六道防垃圾（蜜罐、过快提交、关键词、链接数、重复、频率），命中进垃圾箱
- **后台**：动态管理、评论审核、注册用户管理（看最后登录的设备/系统/IP/地址，可禁用、删除）、站点设置、完整备份（ZIP）与恢复；登录防爆破
- **其它**：跑马灯公告、暗黑模式、友链、RSS、页脚建站天数/到访人数/用量显示

## 架构

| 组件 | 用途 | 名字（可改，三处保持一致即可） |
| --- | --- | --- |
| Worker | 页面、接口、媒体代理 | `cf-d1-moments` |
| D1 数据库 | 全部数据（绑定名 `DB`） | `cf-d1-moments-db` |
| R2 桶 | 上传文件（绑定名 `MEDIA`） | `cf-d1-moments-media` |

```
src/index.js 路由与页面组装 · render.js 前台 · admin.js 后台
src/db.js 建表与会话 · markdown.js / richtext.js 内容渲染 · utils.js 工具
schema.sql 表结构参考（运行时自动建表，不用手动执行）
```

---

## 搭建步骤

### 1. 准备

一个 Cloudflare 账号（免费版即可）。本地部署需 Node.js 18+；也可以全程用网页后台（见第 5 步方式 B）。

### 2. 拿到代码

```bash
git clone https://github.com/sandeli/cf-d1-moments.git
cd cf-d1-moments
```

### 3. 建 D1 数据库

控制台 → **存储和数据库 → D1 → 创建数据库**，名字 `cf-d1-moments-db`，记下它的**数据库 ID**（UUID）。或命令行：`npx wrangler d1 create cf-d1-moments-db`。

数据表不用建，Worker 首次被访问时自动建表。

### 4. 建 R2 桶

控制台 → **R2 对象存储 → 创建存储桶**，名字 `cf-d1-moments-media`。**不要**开公开访问，文件都由 Worker 代理。

### 5. 改配置并部署

把 `wrangler.jsonc` 里的 `database_id` 换成第 3 步的 ID（名字改了的话三处同步改）：

```jsonc
{
  "name": "cf-d1-moments",
  "main": "src/index.js",
  "compatibility_date": "2025-01-01",
  "d1_databases": [{ "binding": "DB", "database_name": "cf-d1-moments-db", "database_id": "<你的数据库 ID>" }],
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "cf-d1-moments-media" }]
}
```

部署，二选一：

- **方式 A 命令行**：`npx wrangler login` 授权一次，再 `npx wrangler deploy`
- **方式 B 网页后台**：控制台 → **Workers 和 Pages → 创建 → 导入存储库**，构建命令**留空**，部署命令填 `npx wrangler deploy`

得到地址 `https://cf-d1-moments.<你的子域>.workers.dev`。想绑自己的域名：进该 Worker → **设置 → 域和路由 → 添加自定义域**。

### 6. 设置管理员密码（一次性）

密码通过一次性令牌初始化，令牌只存哈希、用完作废：

1. 想一个令牌，如 `my-secret-token-123`，算它的 SHA-256 小写十六进制：
   `printf 'my-secret-token-123' | sha256sum`（Windows 可用在线工具算）
2. 先打开一次站点首页（触发建表），再到控制台 → D1 → 你的库 → **控制台**执行（第二行的过期时间 = 当前 unix 秒 + 172800，即 48 小时内有效）：
   ```sql
   INSERT INTO settings (key, value) VALUES ('setup_token_hash', '<算出的 SHA-256>');
   INSERT INTO settings (key, value) VALUES ('setup_expires', '<当前 unix 秒 + 172800>');
   ```
3. 打开 `https://<你的域名>/admin/setup?token=my-secret-token-123`，设好密码即自动登录后台。

**忘记密码**：在 D1 控制台执行 `UPDATE settings SET value = '' WHERE key = 'admin_password_hash';`，再重复本步即可重设。

### 7. 后台完善站点

进 `/admin` → **站点设置**：填站名、昵称、签名；头像/封面点「上传替换」即可。页脚 GitHub 图标是 R2 里的 `site/gh.png`，把图标传到桶里这个路径就显示，不需要可删 `src/render.js` 页脚的 `gh-ico` 图片。

完成，开始发动态。

---

## 日常使用

| 想做的事 | 去哪里 |
| --- | --- |
| 发 / 改 / 删动态 | 后台 → 动态（或首页工具栏） |
| 审核评论、看垃圾评论 | 后台 → 评论审核 |
| 注册开关、评论审核模式、防垃圾关键词 | 后台 → 站点设置 |
| 管理注册用户（禁用/删除） | 后台 → 注册用户 |
| 备份 / 恢复 | 后台 → 完整备份 / 恢复备份 |

## 用量监控（可选）

页脚两行：`存储已用 x%` 开箱即有（按 R2 免费 10 GB 换算）；`今日请求已用 x%` 需外部脚本定时把全账号今日请求数写进 D1 的 `settings.acct_usage`（JSON `{"n": 请求数, "t": unix 秒}`），可参考仓库 `tools_acct_usage.py` 的思路自备。Cloudflare 不按流量计费，下载只消耗请求计数，个人站点无需担心。

## 免费额度参考（免费版）

| 项目 | 额度 | 重置 |
| --- | --- | --- |
| Workers 请求 | 10 万次/天（全账号共享） | 每日 UTC 00:00 |
| D1 读 / 写 | 500 万行 / 10 万行每天 | 每日 UTC 00:00 |
| D1 存储 | 5 GB（全账号） | — |
| R2 存储 / 读操作 | 10 GB / 1000 万次每月 | 按月 |
| R2 出口流量 | 免费 | — |

## 本地开发

`npx wrangler dev` 启动（默认 8787，D1/R2 为本地模拟）。初始化管理员同第 6 步，SQL 换成对本地库执行：`npx wrangler d1 execute cf-d1-moments-db --local --command "<SQL>"`（`setup_expires` 可直接填 `9999999999`）。

## 常见问题

- **评论提交了不显示**：多半开了「先审后显」，去后台评论审核通过；或被防垃圾拦进了垃圾箱。
- **初始化提示令牌不对/过期**：检查 SHA-256 算的是令牌原文、`setup_expires` 是 unix 秒且没过期、执行 SQL 前是否先打开过首页建表。
- **图片打不开**：检查 R2 绑定名是 `MEDIA` 且桶名与配置一致。
- **workers.dev 报 1101**：偶发平台故障，等恢复即可；绑自定义域名一般不受影响。

## 说明

版面与功能灵感来自 kingwrcy/moments（GPL-3.0）；本项目为 Cloudflare 平台上的独立重写，未使用其代码。
