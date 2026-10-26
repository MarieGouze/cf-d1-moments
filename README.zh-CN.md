# cf-d1-moments · 极简朋友圈（Cloudflare 版）

照 [kingwrcy/moments](https://github.com/kingwrcy/moments) 的版面与功能，在 Cloudflare 上自研重写的「朋友圈」式极简微博：封面 + 头像的时间线、发动态、图片/视频九宫格、点赞评论，一套全跑在 Cloudflare 免费额度里，零服务器、零依赖。

- **前端 + 后端**：一个 Cloudflare Worker（原生 JavaScript，无框架、无构建步骤）
- **数据**：Cloudflare D1（SQLite）存动态、评论、设置、管理员密码
- **文件**：Cloudflare R2 存图片/视频/附件，经 Worker 的 `/media/*` 代理读取，桶本身不公开
- **单管理员模式**：站长发动态，访客点赞、评论

页脚带 Cloudflare 用量监控（存储占用 + 全账号请求量），部署方法见下文。

---

## 功能一览

- 时间线：封面图 + 头像 + 昵称/签名头部、单列信息流、相对时间显示（24 小时内显示「x 小时前」，更久显示具体日期时间）
- 动态标题（可选）：显示在正文上方，也用作详情页标题与 RSS 标题
- 发动态：富文本编辑器（默认）/ Markdown 源码两种模式可切换；图片、视频九宫格；任意文件上传（压缩包、文档、安装包等）与外链文件卡片；B 站 / YouTube / 网易云音乐 / 豆瓣 / 普通链接卡片；抖音官方播放器嵌入（粘贴长链、`v.douyin.com` 短链或整段分享口令均可）
- 视频框：直链/B 站/YouTube 统一框规格（整列宽、最大 460、不裁切、无滚动条）；抖音为靠左的紧凑框（高约 380），播放器拉伸撑满整框
- 回复后可见：正文和/或附件文件可设为游客评论后才可见（按评论 IP 解锁，RSS 同步脱敏）
- 上传自动压缩：图片在浏览器内先压缩再上传——JPEG/PNG/WebP 超过 300KB 时缩到长边 1920 并转 WebP（GIF、视频、其他文件不压缩）
- 动态管理：标签、置顶、定时发布（未来时间的动态游客看不到）、隐藏动态（仅管理员可见）、编辑/删除；删除先进垃圾桶可还原，彻底删除时连带删掉其独占的上传文件
- 互动：点赞（按 IP 去重，可取消）；评论（图形验证码、回复、表情）；首页默认露出前 2 条评论，其余原地展开
- 评论治理：先审后显 / 直接显示可切换；六道防垃圾（蜜罐字段、提交过快、关键词、昵称带链接、内容链接数、重复与频率限制），命中的进后台垃圾箱；关键词列表可在后台修改
- 后台：动态管理、评论审核、站点设置（封面/头像可直接上传替换）、修改密码、数据导出（JSON）、完整备份（ZIP 含媒体文件）与恢复备份；登录防爆破（同一 IP 15 分钟内错满 5 次锁定 10 分钟）
- 其它：暗黑模式（页眉右上角月亮/太阳图标切换）、图标工具栏（首页/发布/退出）、友链（并入信息流大框底部）、RSS（`/feed.xml`）、标签页、分页（默认每页 10 条）、页面空白处淡淡的斜向水印、页脚显示建站天数与累计到访人数
- 性能：首页数据库查询并行执行、站点设置 15 秒进程内缓存、媒体响应走边缘缓存（浏览器长缓存；站点资源边缘长存、动态图片边缘存 1 天、视频不缓存）
- 页脚用量：R2 存储已用百分比 + 距月重置天数；全账号今日请求已用百分比 + 距日重置小时数（见文末「用量监控」）

---

## 架构与目录

| 组件 | 用途 | 在 Cloudflare 里的名字（可改） |
| --- | --- | --- |
| Worker | 全部页面、接口、鉴权、媒体代理 | `cf-d1-moments` |
| D1 数据库 | 动态、评论、设置、会话 | `cf-d1-moments-db`（绑定名 `DB`） |
| R2 桶 | 上传的图片/视频/文件、站点图片 | `cf-d1-moments-media`（绑定名 `MEDIA`） |

```
src/
  index.js    路由入口、页面组装、用量统计
  render.js   前台页面（时间线、详情、页脚）
  admin.js    后台（登录、发布、评论管理、设置）
  db.js       建表（首次访问自动执行）、设置读写、会话
  markdown.js Markdown 渲染
  richtext.js 富文本 HTML 白名单过滤
  utils.js    通用工具
schema.sql    数据表结构（参考用，运行时自动建表，不必手动执行）
wrangler.jsonc 部署配置（绑定关系写在这里）
tools_acct_usage.py 可选：全账号请求量同步脚本（见「用量监控」）
```

**重要设计**：管理员密码、站点设置等一切配置只存 D1，`wrangler.jsonc` 里不放任何机密。这样重新部署永远不会把密码冲掉。

---

## 部署步骤

### 0. 准备

- 一个 Cloudflare 账号（免费版即可）
- 本地需要 Node.js 18+（用 wrangler 命令行部署时）；或者全程只用 Cloudflare 网页后台 + GitHub，也行（见步骤 5 方式 B）

### 1. 拿到代码

```bash
git clone https://github.com/sandeli/cf-d1-moments.git
cd cf-d1-moments
```

（也可以先 Fork 到自己的账号再克隆。）

### 2. 创建 D1 数据库

网页后台：Cloudflare 控制台 → **存储和数据库 → D1 SQL 数据库 → 创建数据库**，名字填 `cf-d1-moments-db`，创建后记下它的**数据库 ID**（一串 UUID）。

或者命令行：

```bash
npx wrangler d1 create cf-d1-moments-db
```

命令输出里就有 `database_id`。

> 数据表不用手动建：Worker 第一次被访问时会自动建好全部表。

### 3. 创建 R2 桶

网页后台：控制台 → **R2 对象存储**（第一次用需先开通）→ **创建存储桶**，名字填 `cf-d1-moments-media`。

桶**不要**开启公开访问（不要绑 r2.dev 公开域名）：所有文件都由 Worker 代理读取，自带权限控制（比如隐藏动态的附件不会被外人直链猜到）。

### 4. 修改 wrangler.jsonc

把 D1 的 `database_id` 换成第 2 步拿到的你自己的 ID；名字想改也可以，注意三处要和你实际创建的一致：

```jsonc
{
  "name": "cf-d1-moments",
  "main": "src/index.js",
  "compatibility_date": "2025-01-01",
  "d1_databases": [
    { "binding": "DB", "database_name": "cf-d1-moments-db", "database_id": "<换成你的数据库 ID>" }
  ],
  "r2_buckets": [
    { "binding": "MEDIA", "bucket_name": "cf-d1-moments-media" }
  ]
}
```

⚠️ 不要往这个文件里加机密变量：本项目所有配置都存 D1，加了反而容易在重新部署时互相覆盖。

### 5. 部署 Worker

**方式 A：命令行（推荐）**

```bash
npx wrangler login   # 浏览器里授权一次
npx wrangler deploy
```

部署成功后得到地址：`https://cf-d1-moments.<你的子域>.workers.dev`。

**方式 B：网页后台导入仓库**

控制台 → **Workers 和 Pages → 创建 → 导入存储库**，选中这个仓库，构建命令**留空**，部署命令填 `npx wrangler deploy`，保存并部署。

### 6.（可选）绑定自定义域名

控制台 → 进入这个 Worker → **设置 → 域和路由 → 添加 → 自定义域**，填你的域名（需已托管在同一个 Cloudflare 账号下），保存后等证书签发即可。不绑也能用 workers.dev 地址。

### 7. 初始化管理员密码（只需一次）

管理员密码通过「一次性令牌」设置：令牌只存哈希，用完作废。

**(1) 想一个令牌**，比如 `my-secret-token-123`，算出它的 SHA-256（小写十六进制）：

```bash
# Linux / macOS
printf 'my-secret-token-123' | sha256sum

# Windows PowerShell（把输出的 Hash 转成小写）
(Get-FileHash -InputStream ([IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes('my-secret-token-123'))) -Algorithm SHA256).Hash.ToLower()
```

也可以用任意在线 SHA-256 工具。

**(2) 把令牌哈希和过期时间写进 D1**。先打开一次你的站点首页（触发自动建表），然后到控制台 → D1 → 进入你的库 → **控制台（Console）** 标签执行（`setup_expires` 为 unix 秒时间戳，下例需换成「部署当时的当前时间 + 172800」，即 48 小时后）：

```sql
INSERT INTO settings (key, value) VALUES ('setup_token_hash', '<上一步算出的 SHA-256>');
INSERT INTO settings (key, value) VALUES ('setup_expires', '<当前 unix 时间 + 172800>');
```

**(3) 打开初始化页设置密码**：

```
https://<你的域名>/admin/setup?token=my-secret-token-123
```

设置密码（至少 6 位）后自动登录后台，令牌随即作废，初始化入口关闭。

### 8. 在后台完善站点

登录后台（首页页脚点站名，或直接访问 `/admin`）→ **站点设置**：

- 站名、昵称、个性签名
- 头像、封面：在站点设置里点对应字段旁的「上传替换」选图即可，上传后自动保存生效（也可以直接填图片地址）
- 页脚的 GitHub 图标：页脚模板里引用的是 R2 中 `site/gh.png` 这个路径。把你的图标图片以这个路径传进 R2 桶即可显示（控制台 R2 页面上传时把对象名填 `site/gh.png`，或 `npx wrangler r2 object put cf-d1-moments-media/site/gh.png --file=图标.png`）；不需要这个图标的话，删掉 `src/render.js` 页脚中 `gh-ico` 那个 `<img>` 即可

到这里部署完成，可以开始发动态了。

---

## 日常使用速览

| 想做的事 | 去哪里 |
| --- | --- |
| 发动态 | 后台 → 发布（或首页工具栏「发布」） |
| 改/删动态 | 后台 → 动态列表；管理员登录时首页每条动态也有编辑入口 |
| 审核评论 / 看垃圾箱 | 后台 → 评论管理 |
| 评论先审后显还是直发 | 后台 → 站点设置 →「评论是否审核」 |
| 改防垃圾关键词 | 后台 → 站点设置 → 垃圾关键词（逗号分隔） |
| 关掉评论功能 | 后台 → 站点设置 → 评论开关 |
| 导出全部数据 | 后台 → 导出（`/admin/export`，JSON） |
| 改管理员密码 | 后台 → 修改密码 |
| RSS 订阅地址 | `https://<你的域名>/feed.xml` |

访客侧：点赞按 IP 去重（再点一次取消）；评论需填 4 位图形验证码；评论支持回复（统一挂在顶层，显示「回复 @昵称」）和表情插入。

### 忘记管理员密码怎么办

密码以 SHA-256 哈希存于 D1 的 `settings` 表（键 `admin_password_hash`），无法找回原文，只能重置：

1. 在 D1 控制台执行，把现有密码哈希清空：

```sql
UPDATE settings SET value = '' WHERE key = 'admin_password_hash';
```

2. 重新走一遍部署步骤 7 的 (2)(3)：写入新的 `setup_token_hash` / `setup_expires`，打开 `/admin/setup?token=<新令牌>` 重设密码。

---

## 用量监控（页脚两行，可选）

页脚最后两行：

- `存储已用 x% · 距重置 N 天`：**开箱即有，无需配置**。Worker 通过 R2 绑定实测桶内全部对象的总字节数，对 R2 免费额度 10 GB 换算百分比，结果缓存 10 分钟（存在 D1 设置表里）。「重置」指免费额度按月重置（每月 1 日 UTC）。
- `今日请求已用 x% · 距重置 N 小时`：**需要一个外部小脚本配合**。Workers 免费版的 100,000 次/天是**整个账号所有 Worker 共享**的额度，本站自己数不到全账号总数；官方数据在 Cloudflare 的 GraphQL 统计接口里（数据集 `workersInvocationsAdaptive`，把当天各脚本的 `sum.requests` 相加即为全账号总数）。做法：
  1. 定时（例如每 15 分钟）查一次 GraphQL，得到全账号今日总请求数；
  2. 把结果写进本站 D1 的 `settings` 表：键 `acct_usage`，值是 JSON 字符串，格式 `{"n": 1261, "t": 1761456000}`（`n` = 请求数，`t` = 写入时的 unix 秒）；
  3. 页脚读到「今天」的数据就显示这一行；数据不是今天的则自动隐藏。
  
  仓库里的 `tools_acct_usage.py` 是作者自用的实现（依赖作者本机的令牌工具链，无法直接照搬），照上面三步用任意语言 + 任意定时器实现一份即可。

顺带说明：**下载不费流量**。Cloudflare 不按流量计费、R2 出口流量免费；别人下载你上传的文件，只消耗一点计数：每次下载算 1 次 Worker 请求（计入上面那 10 万/天），外加 1 次 R2 读取操作（免费额度 1000 万次/月）。个人站点量级完全不用担心。

---

## 免费额度参考（Cloudflare 免费版）

| 项目 | 免费额度 | 重置 |
| --- | --- | --- |
| Workers 请求 | 100,000 次/天（**全账号共享**） | 每日 UTC 00:00 |
| Workers CPU | 10 ms/次 | — |
| D1 读 | 500 万行/天 | 每日 UTC 00:00 |
| D1 写 | 10 万行/天 | 每日 UTC 00:00 |
| D1 存储 | 5 GB（全账号） | — |
| R2 存储 | 10 GB | 按月 |
| R2 写类操作（Class A） | 100 万次/月 | 按月 |
| R2 读类操作（Class B） | 1000 万次/月 | 按月 |
| R2 出口流量 | 免费不限量 | — |

个人朋友圈的日常访问量离这些上限都很远。

---

## 本地开发

```bash
npx wrangler dev   # 默认 http://localhost:8787，D1/R2 均为本地模拟
```

本地初始化管理员的方法同部署步骤 7，只是 SQL 要对本地库执行（先访问一次本地首页触发建表）：

```bash
npx wrangler d1 execute cf-d1-moments-db --local --command "INSERT INTO settings (key, value) VALUES ('setup_token_hash', '<sha256>')"
npx wrangler d1 execute cf-d1-moments-db --local --command "INSERT INTO settings (key, value) VALUES ('setup_expires', '9999999999')"
```

然后打开 `http://localhost:8787/admin/setup?token=<你的令牌原文>` 设置本地密码。

---

## 常见问题

**打开 workers.dev 地址显示 Error 1101？**
先确认这个 Worker 的 workers.dev 子域已启用（控制台 → 该 Worker → 设置 → 域和路由）。偶尔 Cloudflare 平台侧故障也会报 1101，等平台恢复即可；绑了自定义域名的站点通常不受子域故障影响。

**重新部署后要重设密码吗？**
不用。密码哈希只存 D1，部署只换代码不动数据——这正是本项目刻意的设计。

**图片/文件打不开？**
检查 R2 桶的绑定名是不是 `MEDIA`、桶名与 `wrangler.jsonc` 是否一致。桶不要开公开访问，文件统一经 `/media/<路径>` 由 Worker 代理。

**评论提交了却不显示？**
多半是开了「先审后显」：去后台评论管理里通过即可；也可能被防垃圾判进了垃圾箱（同页可查），关键词太宽时在站点设置里调整。

**初始化链接提示令牌不对或已过期？**
三个常见原因：SHA-256 算的不是打开链接时用的那个令牌原文；`setup_expires` 写的不是 unix 秒、或已经过期；执行 SQL 之前没先打开过首页（表还没建，插入其实没成功）。

**定时发布的动态自己也看不到？**
管理员登录状态下可见全部（包括定时与隐藏动态），游客要到发布时间之后才看得到。用游客视角验证时请先退出登录或开无痕窗口。

---

## 致谢与说明

版面与功能灵感来自 [kingwrcy/moments](https://github.com/kingwrcy/moments)（GPL-3.0）；本项目是照其形态在 Cloudflare 平台上的独立重写，代码与样式均为自研，未使用其代码。
