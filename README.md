# cf-d1-moments · A Minimal "Moments" Timeline on Cloudflare

A from-scratch re-creation of the layout and feature set of [kingwrcy/moments](https://github.com/kingwrcy/moments) on Cloudflare: a minimal, WeChat-Moments-style microblog with a cover + avatar timeline, posts, image/video grids, likes and comments — everything running inside Cloudflare's free tiers, with zero servers and zero dependencies.

- **Front end + back end**: a single Cloudflare Worker (vanilla JavaScript, no framework, no build step)
- **Data**: Cloudflare D1 (SQLite) stores posts, comments, settings and the admin password
- **Files**: Cloudflare R2 stores images/videos/attachments, served through the Worker's `/media/*` proxy; the bucket itself is never public
- **Single-admin model**: the owner posts; visitors like and comment

The footer shows live Cloudflare usage (storage + account-wide requests). Deployment instructions are below.

> 中文说明：[README.zh-CN.md](README.zh-CN.md)

**Version 2.11.1** — numbering: feature releases bump the middle number and reset the last to 0 (2.6.x → 2.7.0); bug fixes bump the last number (2.6.0 → 2.6.1). The running version is shown in the site footer.

---

## Features

- Timeline: cover image + avatar + nickname/signature header, single-column feed, relative timestamps ("x hours ago" within 24 hours, absolute date/time after that)
- Optional post titles, shown above the body and used for the detail page title and RSS
- Posting: rich-text editor (default) / Markdown source mode, switchable; image & video grids; arbitrary file uploads (archives, documents, installers) and external file cards; Bilibili / YouTube / NetEase Music / Douban / plain link cards; Douyin embeds via the official player (paste a long link, a `v.douyin.com` short link, or the whole share text)
- Video frames: direct/Bilibili/YouTube videos use one frame spec (full column width up to 460px, uncropped, no scrollbars); Douyin uses a compact left-aligned frame (about 380px tall) with the player stretched to fill it
- Uploads are compressed in the browser before sending: JPEG/PNG/WebP images over 300KB are resized to a 1920px long edge and re-encoded as WebP (GIFs, videos and other files are untouched)
- Reply-gated content: a post's body and/or its file attachments can be hidden until a visitor comments on that post (same-IP unlock; RSS output is redacted too)
- Site-wide access password (optional): when enabled in Site settings, visitors must enter the password once (30-day cookie) before browsing anything — pages, media files and RSS included; the admin area stays separate, the gate has its own brute-force lockout, and changing the password re-locks every visitor
- Per-post viewing password (optional): a post can carry its own password — visitors see only its title plus a lock notice until they unlock it on the detail page (30-day per-post cookie; body, media, comments, likes and RSS are all withheld), with the same brute-force lockout; changing or clearing the password in the editor takes effect immediately
- Marquee announcement: a one-line notice set in Site settings scrolls across the top of the timeline (pauses on hover, scroll speed scales with text length); leave it empty to hide it
- Post management: tags, star-rated pinning (1–3 stars; three stars pins highest, then two, then one, ahead of unpinned posts), scheduled publishing (future-dated posts are invisible to visitors), hidden posts (admin-only), edit/delete; deletions go to a trash bin and can be restored — permanently purging a post also deletes its orphaned uploaded files
- Interactions: likes (IP-deduped, toggleable); comments (image captcha, replies, emoji); the home feed shows the first 2 comments per post and expands the rest in place; clicking a post's 💬 icon on the home feed opens its comment box in place (the captcha image loads lazily on first open) — only the Detail link navigates to the detail page
- Visitor accounts: optional self-registration with an image captcha (each account is randomly bound one of the built-in avatars at registration, shown next to its posts and comments, and cannot be changed; the admin can close registration in settings); the admin panel's user list shows each account's last-login device, OS, IP and approximate location, and can disable an account (instantly signs it out and blocks login) or delete it; signed-in visitors comment under their username and skip the captcha; guests no longer type a nickname — they only solve the captcha and appear under a random guest name (Guest + 3 digits); any post can individually be set to registered-users-only commenting, or to registered-users-only visibility (guests then see neither its content nor its comments, only a sign-in prompt); a separate admin switch lets registered users publish their own posts from a simplified form (title, body, tags, image/archive uploads up to 500 KB — none of the admin-only options like pinning, hiding, gating or view passwords), shown under their own byline and editable/deletable only by themselves
- Comment governance: pre-moderation / publish-immediately switch; six anti-spam layers (honeypot field, too-fast submission, keyword list editable in admin, links in nickname, link count in body, duplicates & rate limiting) with offenders routed to a spam bin; comments are capped at 50 characters; when posting, a visitor can tick "admin only" — other visitors then see an amber "🔒 hidden comment" placeholder instead of the content (the name and the count stay), and only the admin reads the actual text
- Admin: post management, comment moderation, site settings, password change, data export (JSON), full backup (ZIP including media files) and backup restore; login brute-force protection (5 failures from one IP within 15 minutes locks it for 10 minutes)
- Misc: dark mode via a moon/sun icon button at the header's top-right corner, icon toolbar (home / publish / logout), friend links (merged into the bottom of the feed frame), RSS (`/feed.xml`), tag pages, pagination (10 posts per page by default), a faint diagonal watermark across page whitespace, a footer line with site age (days since launch) and cumulative unique visitors
- Performance: homepage database queries run in parallel, settings are cached in-isolate for 15s, and media responses are served through the edge cache (immutable in browsers; site assets long-lived at the edge, uploads one day, videos excluded)
- Footer usage: R2 storage used % + days to the monthly reset; account-wide requests today % + hours to the daily reset (see "Usage monitoring" below)

---

## Architecture & layout

| Component | Purpose | Name on Cloudflare (renameable) |
| --- | --- | --- |
| Worker | All pages, APIs, auth, media proxy | `cf-d1-moments` |
| D1 database | Posts, comments, settings, sessions | `cf-d1-moments-db` (binding `DB`) |
| R2 bucket | Uploaded images/videos/files, site assets | `cf-d1-moments-media` (binding `MEDIA`) |

```
src/
  index.js    Routing entry, page assembly, usage stats
  render.js   Front end (timeline, detail page, footer)
  admin.js    Admin (login, posting, comment management, settings, backup/restore)
  db.js       Schema creation (automatic on first visit), settings, sessions
  markdown.js Markdown rendering
  richtext.js Rich-text HTML allowlist sanitizer
  utils.js    Shared helpers
schema.sql    Table schema (reference only; tables are created automatically at runtime)
wrangler.jsonc Deployment config (bindings live here)
tools_acct_usage.py Optional: account-wide request-usage sync script (see "Usage monitoring")
```

**Key design decision**: the admin password, site settings and every other piece of configuration live only in D1. `wrangler.jsonc` contains no secrets, so redeploying can never wipe your password.

---

## Deployment

### 0. Prerequisites

- A Cloudflare account (the free plan is enough)
- Node.js 18+ locally if you deploy with wrangler; or you can do everything from the Cloudflare dashboard + GitHub (see step 5, option B)

### 1. Get the code

```bash
git clone https://github.com/sandeli/cf-d1-moments.git
cd cf-d1-moments
```

(Or fork it to your own account first, then clone.)

### 2. Create the D1 database

Dashboard: Cloudflare console → **Storage & databases → D1 SQL database → Create database**, name it `cf-d1-moments-db`, and note its **database ID** (a UUID).

Or from the CLI:

```bash
npx wrangler d1 create cf-d1-moments-db
```

The command output includes the `database_id`.

> You never create tables by hand: the Worker creates the full schema automatically on its first visit.

### 3. Create the R2 bucket

Dashboard: console → **R2 object storage** (enable it first if needed) → **Create bucket**, name it `cf-d1-moments-media`.

Do **not** enable public access on the bucket (no r2.dev public domain): every file is read through the Worker proxy, which applies access control (for example, attachments of hidden posts can't be guessed by direct link).

### 4. Edit wrangler.jsonc

Replace the D1 `database_id` with the ID from step 2. Names can be changed too, as long as all three match what you actually created:

```jsonc
{
  "name": "cf-d1-moments",
  "main": "src/index.js",
  "compatibility_date": "2025-01-01",
  "d1_databases": [
    { "binding": "DB", "database_name": "cf-d1-moments-db", "database_id": "<your database ID>" }
  ],
  "r2_buckets": [
    { "binding": "MEDIA", "bucket_name": "cf-d1-moments-media" }
  ]
}
```

⚠️ Do not add secret variables to this file: all configuration lives in D1 by design, and file-based values only risk fighting with it on redeploys.

### 5. Deploy the Worker

**Option A: CLI (recommended)**

```bash
npx wrangler login   # authorize once in the browser
npx wrangler deploy
```

You get an address like `https://cf-d1-moments.<your-subdomain>.workers.dev`.

**Option B: import the repository in the dashboard**

Console → **Workers & Pages → Create → Import a repository**, pick this repo, leave the build command **empty**, set the deploy command to `npx wrangler deploy`, then save and deploy.

### 6. (Optional) Bind a custom domain

Console → open this Worker → **Settings → Domains & Routes → Add → Custom domain**, enter your domain (it must be hosted on the same Cloudflare account), save, and wait for the certificate. The workers.dev address keeps working either way.

### 7. Initialize the admin password (one time only)

The admin password is set through a one-time token: only the token's hash is stored, and the token is invalidated after use.

**(1) Pick a token**, e.g. `my-secret-token-123`, and compute its SHA-256 (lowercase hex):

```bash
# Linux / macOS
printf 'my-secret-token-123' | sha256sum

# Windows PowerShell (lowercase the Hash in the output)
(Get-FileHash -InputStream ([IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes('my-secret-token-123'))) -Algorithm SHA256).Hash.ToLower()
```

Any online SHA-256 tool works too.

**(2) Write the token hash and its expiry into D1.** First open your site's home page once (this triggers schema creation), then in the console → D1 → your database → **Console** tab, run (set `setup_expires` to a unix timestamp in seconds: "now + 172800", i.e. 48 hours ahead):

```sql
INSERT INTO settings (key, value) VALUES ('setup_token_hash', '<SHA-256 from step 1>');
INSERT INTO settings (key, value) VALUES ('setup_expires', '<current unix time + 172800>');
```

**(3) Open the setup page and set the password:**

```
https://<your-domain>/admin/setup?token=my-secret-token-123
```

After setting a password (6+ characters) you are logged into the admin automatically, the token is invalidated, and the setup entry closes.

### 8. Finish the site setup in admin

Log into admin (click the site name in the home footer, or visit `/admin`) → **Site settings**:

- Site name, nickname, signature
- Avatar and cover: use the **Upload & replace** button next to each field in Site settings — pick an image and it is saved and applied immediately (pasting an image URL still works too)
- The GitHub icon in the footer: the footer template references the R2 object `site/gh.png`. Upload your icon under that exact object name (in the R2 console, or with `npx wrangler r2 object put cf-d1-moments-media/site/gh.png --file=icon.png`) and it will show up; if you don't want it, remove the `gh-ico` `<img>` from the footer in `src/render.js`

Deployment is complete — you can start posting.

---

## Daily use cheat sheet

| Task | Where |
| --- | --- |
| New post | Admin → New post (or the "Post" button in the home toolbar) |
| Edit / delete a post | Admin → Post list; on the home feed, each post also shows edit/delete while you are logged in |
| Moderate comments / check the spam bin | Admin → Comment moderation |
| Pre-moderation vs. publish immediately | Admin → Site settings → "Comment moderation" |
| Edit anti-spam keywords | Admin → Site settings → spam keywords (comma-separated) |
| Turn comments off | Admin → Site settings → comments toggle |
| Export all data | Admin → Export (`/admin/export`, JSON) |
| Full backup incl. files / restore a backup | Admin → Full backup (ZIP) / Restore backup |
| Change the admin password | Admin → Change password |
| RSS feed URL | `https://<your-domain>/feed.xml` |

For visitors: likes are deduplicated by IP (click again to unlike); commenting requires a 4-character image captcha; replies are threaded under the top-level comment and shown as "Reply @nickname"; an emoji picker is built in.

### Forgot the admin password?

The password is stored as a SHA-256 hash in the D1 `settings` table (key `admin_password_hash`). The original cannot be recovered, only reset:

1. In the D1 console, clear the existing hash:

```sql
UPDATE settings SET value = '' WHERE key = 'admin_password_hash';
```

2. Repeat steps (2) and (3) of deployment step 7: write a fresh `setup_token_hash` / `setup_expires`, then open `/admin/setup?token=<new token>` and set a new password.

---

## Usage monitoring (the two footer lines, optional)

The last two footer lines:

- `Storage used x% · N days to reset`: **works out of the box, no configuration.** The Worker measures the total bytes of all objects in the bucket through the R2 binding, converts it against the 10 GB free allowance, and caches the result for 10 minutes (in the D1 settings table). "Reset" refers to the monthly free-tier reset (the 1st of each month, UTC).
- `Requests today used x% · N hours to reset`: **needs a small external script.** The Workers free plan's 100,000 requests/day quota is **shared by every Worker in the account**, so this site cannot count the account total by itself; the official numbers live in Cloudflare's GraphQL analytics API (dataset `workersInvocationsAdaptive`; sum `sum.requests` across today's scripts for the account total). The recipe:
  1. On a schedule (e.g. every 15 minutes), query the GraphQL API for the account-wide request count for today;
  2. Write the result into this site's D1 `settings` table: key `acct_usage`, value a JSON string like `{"n": 1261, "t": 1761456000}` (`n` = requests, `t` = unix seconds when written);
  3. The footer shows the line only when the data is from today (UTC); stale data hides the line automatically.

  The `tools_acct_usage.py` in this repo is the author's own implementation (it depends on the author's local token tooling and cannot be copied verbatim) — reimplementing the three steps above in any language with any scheduler is enough.

One more note: **downloads cost no bandwidth.** Cloudflare does not charge for traffic and R2 egress is free; someone downloading your files only consumes counters: 1 Worker request per download (counted in the 100k/day above) plus 1 R2 read operation (free tier: 10 million/month). At personal-site scale this is a non-issue.

---

## Free-tier reference (Cloudflare free plan)

| Item | Free allowance | Reset |
| --- | --- | --- |
| Workers requests | 100,000 / day (**shared account-wide**) | Daily 00:00 UTC |
| Workers CPU | 10 ms / request | — |
| D1 reads | 5 million rows / day | Daily 00:00 UTC |
| D1 writes | 100,000 rows / day | Daily 00:00 UTC |
| D1 storage | 5 GB (account-wide) | — |
| R2 storage | 10 GB | Monthly |
| R2 writes (Class A) | 1 million / month | Monthly |
| R2 reads (Class B) | 10 million / month | Monthly |
| R2 egress | Free, unlimited | — |

A personal moments site sits far below all of these.

---

## Local development

```bash
npx wrangler dev   # http://localhost:8787 by default; D1/R2 are simulated locally
```

Initializing the local admin works exactly like deployment step 7, except the SQL runs against the local database (visit the local home page once first to create the tables):

```bash
npx wrangler d1 execute cf-d1-moments-db --local --command "INSERT INTO settings (key, value) VALUES ('setup_token_hash', '<sha256>')"
npx wrangler d1 execute cf-d1-moments-db --local --command "INSERT INTO settings (key, value) VALUES ('setup_expires', '9999999999')"
```

Then open `http://localhost:8787/admin/setup?token=<your token>` and set a local password.

---

## FAQ

**The workers.dev address shows Error 1101?**
First make sure the Worker's workers.dev subdomain is enabled (console → this Worker → Settings → Domains & Routes). Occasionally a Cloudflare platform incident also produces 1101s and clears on its own; sites with a custom domain bound are usually unaffected by subdomain incidents.

**Do I need to reset the password after redeploying?**
No. The password hash lives only in D1; a deployment swaps code, never data — that is deliberate.

**Images/files won't open?**
Check that the R2 binding is named `MEDIA` and the bucket name matches `wrangler.jsonc`. Keep the bucket non-public; files are always served via `/media/<path>` by the Worker.

**A comment was submitted but doesn't show?**
Probably pre-moderation is on: approve it in Admin → Comment moderation. It may also have landed in the spam bin (same page); if the keyword list is too aggressive, adjust it in Site settings.

**The setup link says the token is wrong or expired?**
Three common causes: the SHA-256 wasn't computed over the exact token you put in the link; `setup_expires` isn't a unix timestamp in seconds (or has already passed); or you ran the SQL before ever opening the home page (the table didn't exist yet, so the insert silently failed).

**I can't see my own scheduled post?**
While logged in as admin you see everything (including scheduled and hidden posts); visitors only see a scheduled post after its publish time. To check the visitor view, log out or use a private window.

---

## Credits & notes

Layout and features are inspired by [kingwrcy/moments](https://github.com/kingwrcy/moments) (GPL-3.0); this project is an independent re-implementation of that form factor for the Cloudflare platform — all code and styles are original and none of its code is used.
