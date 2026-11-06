// 电报通知：用户私信管理员 / 回复管理员留言时推送到管理员的 Telegram；
// 管理员在 Telegram 里「引用」那条通知回复，Webhook 把内容转回站内（私信或留言）。
// 配置在后台「站点设置 → 电报通知」：tg_enabled / tg_bot_token / tg_chat_id / tg_webhook_secret（均存 settings 表）。
import { getSettings, setSetting, notifyForComment } from './db.js';
import { randomToken, nowSec } from './utils.js';

export function tgReady(s) {
  return s && s.tg_enabled === '1' && !!String(s.tg_bot_token || '').trim() && !!String(s.tg_chat_id || '').trim();
}

export async function tgApi(token, method, payload) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      signal: AbortSignal.timeout(6000),
    });
    return await r.json().catch(() => null);
  } catch {
    return null;
  }
}

// 发送一条通知并登记对照关系（tg_msg_id → 该转给谁），管理员引用回复时靠它定位
async function tgNotify(env, s, text, map) {
  const res = await tgApi(s.tg_bot_token, 'sendMessage', { chat_id: s.tg_chat_id, text });
  if (!res || !res.ok || !res.result || !res.result.message_id) return false;
  const now = nowSec();
  try {
    await env.DB.prepare(
      'INSERT OR REPLACE INTO tg_map (tg_msg_id, kind, user_id, user_name, memo_id, root_id, target_name, created_at) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(res.result.message_id, map.kind || '', map.user_id || 0, map.user_name || '', map.memo_id || 0, map.root_id || 0, map.target_name || '', now).run();
    // 对照表只留近 30 天，避免无限增长
    await env.DB.prepare('DELETE FROM tg_map WHERE created_at < ?').bind(now - 30 * 24 * 3600).run();
  } catch { /* 登记失败只是不能引用回复，通知本身已发出 */ }
  return true;
}

export async function tgNotifyDm(env, origin, { fromId, fromName, content }) {
  try {
    const s = await getSettings(env);
    if (!tgReady(s)) return;
    const text = `💬 私信 · ${fromName}\n${content}\n—— 站内：${origin}/messages/${fromId}\n（引用本条消息即可回复）`;
    await tgNotify(env, s, text, { kind: 'dm', user_id: fromId, user_name: fromName });
  } catch { /* 通知失败不影响私信本身 */ }
}

export async function tgNotifyCommentReply(env, origin, { memoId, rootId, fromName, content, scene }) {
  try {
    const s = await getSettings(env);
    if (!tgReady(s)) return;
    const head = scene === 'comment' ? `💬 ${fromName} 评论了你的动态` : `💬 ${fromName} 回复了你的留言`;
    const text = `${head}\n${content}\n—— 动态：${origin}/memo/${memoId}\n（引用本条消息即可回复）`;
    await tgNotify(env, s, text, { kind: 'cmt', memo_id: memoId, root_id: rootId, target_name: fromName });
  } catch { /* 通知失败不影响留言本身 */ }
}

// 在 Telegram 侧绑定/刷新 Webhook（保存设置时与「重新绑定」按钮调用）；secret 缺失时生成
export async function tgBindWebhook(env, origin, { regen = false } = {}) {
  const s = await getSettings(env);
  const token = String(s.tg_bot_token || '').trim();
  if (!token) return { ok: false, error: '未填机器人令牌' };
  let secret = String(s.tg_webhook_secret || '');
  if (!secret || regen) {
    secret = randomToken();
    await setSetting(env, 'tg_webhook_secret', secret);
  }
  const res = await tgApi(token, 'setWebhook', {
    url: `${origin}/tg/webhook`,
    secret_token: secret,
    allowed_updates: ['message'],
  });
  if (res && res.ok) return { ok: true };
  return { ok: false, error: (res && res.description) || '电报接口无响应' };
}

// Telegram 推送入口：只认 secret 请求头 + 管理员本人的 chat，其余一律忽略
export async function tgWebhook(env, request) {
  const s = await getSettings(env);
  const secret = String(s.tg_webhook_secret || '');
  if (!secret || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) {
    return new Response('not found', { status: 404 });
  }
  const done = () => Response.json({ ok: true });
  let upd = null;
  try { upd = await request.json(); } catch { return done(); }
  const msg = upd && upd.message;
  if (!msg || !msg.chat || String(msg.chat.id) !== String(s.tg_chat_id || '')) return done();
  const token = String(s.tg_bot_token || '');
  const text = String(msg.text || '').trim();
  const say = (t) => tgApi(token, 'sendMessage', { chat_id: s.tg_chat_id, text: t });
  if (!text) return done();
  const replyToId = msg.reply_to_message && msg.reply_to_message.message_id;
  if (!replyToId) {
    await say('要回复哪位用户，请长按/右键引用一条我发给你的通知消息，再写回复。');
    return done();
  }
  const map = await env.DB.prepare('SELECT * FROM tg_map WHERE tg_msg_id = ?').bind(replyToId).first().catch(() => null);
  if (!map) {
    await say('这条通知太旧或对应关系已过期（只保留 30 天），请到网站后台回复。');
    return done();
  }
  const now = nowSec();
  const nick = String(s.nickname || '主人');
  if (map.kind === 'dm') {
    const u = await env.DB.prepare('SELECT id, username, status FROM users WHERE id = ?').bind(map.user_id).first().catch(() => null);
    if (!u || u.status) {
      await say('对方账号已不存在或已被停用，这条回复没有发出。');
      return done();
    }
    await env.DB.prepare('INSERT INTO messages (from_id, from_name, to_id, to_name, content, created_at) VALUES (0,?,?,?,?,?)')
      .bind(nick, u.id, u.username, text.slice(0, 200), now).run();
    await say(`✓ 已转给 ${u.username}`);
    return done();
  }
  if (map.kind === 'cmt') {
    const ins = await env.DB.prepare(
      'INSERT INTO comments (memo_id, parent_id, reply_to, name, content, status, flag, ip, user_agent, geo, admin_only, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(map.memo_id, map.root_id, map.target_name, nick, text.slice(0, 80), 'approved', '', 'telegram', 'Telegram', '{}', 0, now).run();
    if (ins && ins.meta && ins.meta.last_row_id) {
      await notifyForComment(env, { id: ins.meta.last_row_id, memo_id: map.memo_id, parent_id: map.root_id, reply_to: map.target_name, name: nick, content: text.slice(0, 80) });
    }
    await say(`✓ 已回复到动态 #${map.memo_id} 下`);
    return done();
  }
  return done();
}
