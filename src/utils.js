// 通用工具：时间、slug、Cookie、随机令牌等
import { escapeHtml } from './markdown.js';

export { escapeHtml };

export function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const nowSec = () => Math.floor(Date.now() / 1000);

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

// 按北京时间（UTC+8）格式化，避免运行环境时区差异
function beijingParts(tsSec) {
  const d = new Date((Number(tsSec) + 8 * 3600) * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: WEEKDAYS[d.getUTCDay()],
    hour: String(d.getUTCHours()).padStart(2, '0'),
    minute: String(d.getUTCMinutes()).padStart(2, '0'),
  };
}

// 中文星期日期格式，例如：星期日，2026年10月25日
export function formatDateCN(tsSec) {
  if (!tsSec) return '';
  const p = beijingParts(tsSec);
  return `${p.weekday}，${p.year}年${p.month}月${p.day}日`;
}

export function formatDateTimeCN(tsSec) {
  if (!tsSec) return '';
  const p = beijingParts(tsSec);
  return `${p.year}年${p.month}月${p.day}日 ${p.hour}:${p.minute}`;
}

export function yearMonthOf(tsSec) {
  const p = beijingParts(tsSec);
  return { year: p.year, month: p.month };
}

// slug 生成：英文/数字转连字符；纯中文标题回退为 前缀+时间戳，避免空 slug
export function slugify(input, fallbackPrefix = 'post') {
  const slug = String(input ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || `${fallbackPrefix}-${Date.now().toString(36)}`;
}

export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return cookies;
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function redirect(location, extraHeaders = {}) {
  return new Response(null, { status: 302, headers: { Location: location, ...extraHeaders } });
}

export function htmlResponse(html, status = 200, extraHeaders = {}) {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...extraHeaders },
  });
}

// 解析 User-Agent → 操作系统 + 浏览器（名称与版本号），识别不了给「未知」
export function parseUserAgent(ua) {
  const s = String(ua || '');
  const ver = (re) => {
    const m = s.match(re);
    return m ? m[1].split('.').slice(0, 2).join('.') : '';
  };
  let os = '未知系统';
  let m;
  if (/Windows NT 10/.test(s)) os = 'Windows 10/11';
  else if (/Windows NT 6\.3/.test(s)) os = 'Windows 8.1';
  else if (/Windows NT 6\.2/.test(s)) os = 'Windows 8';
  else if (/Windows NT 6\.1/.test(s)) os = 'Windows 7';
  else if (/Windows/.test(s)) os = 'Windows';
  else if ((m = s.match(/(?:iPhone|iPad|iPod).*?OS ([\d_]+)/))) os = 'iOS ' + m[1].replace(/_/g, '.');
  else if ((m = s.match(/Android ([\d.]+)/))) os = 'Android ' + m[1];
  else if ((m = s.match(/Mac OS X ([\d_]+)/))) os = 'macOS ' + m[1].replace(/_/g, '.');
  else if (/CrOS/.test(s)) os = 'Chrome OS';
  else if (/Linux/.test(s)) os = 'Linux';

  let browser = '未知浏览器';
  let v = '';
  if ((v = ver(/Edg\/([\d.]+)/))) browser = 'Edge ' + v;
  else if ((v = ver(/OPR\/([\d.]+)/))) browser = 'Opera ' + v;
  else if ((v = ver(/MicroMessenger\/([\d.]+)/))) browser = '微信浏览器 ' + v;
  else if ((v = ver(/QQBrowser\/([\d.]+)/))) browser = 'QQ 浏览器 ' + v;
  else if ((v = ver(/Firefox\/([\d.]+)/))) browser = 'Firefox ' + v;
  else if ((v = ver(/Chrome\/([\d.]+)/))) browser = 'Chrome ' + v;
  else if ((v = ver(/Version\/([\d.]+)/)) && /Safari/.test(s)) browser = 'Safari ' + v;
  else if (/Safari/.test(s)) browser = 'Safari';
  return { os, browser };
}

// IP 打码展示（前台用）：IPv4 末段、IPv6 后半截换成 *
export function maskIp(ip) {
  const s = String(ip || '').trim();
  if (!s) return '';
  if (s.includes('.')) {
    const parts = s.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
  }
  if (s.includes(':')) {
    const parts = s.split(':').filter(Boolean);
    return parts.slice(0, 3).join(':') + ':*';
  }
  return s;
}

// 访客 IP：优先 CF 专用头，其次 X-Forwarded-For 第一段
export function clientIp(request) {
  const cf = request.headers.get('CF-Connecting-IP');
  if (cf) return cf.trim();
  const xff = request.headers.get('X-Forwarded-For');
  if (xff) return xff.split(',')[0].trim();
  return '';
}

// ===== 评论四位数验证码 =====
// 数字用 3x5 点阵方块画出来（不是文字节点，机器人读不出），答案不明文存：
// cookie 里只放 过期时间 + HMAC 签名，校验时重算比对，无状态、不占库。
const DIGIT_FONT = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};
export const CAPTCHA_TTL = 600; // 10 分钟

function captchaSvg(code) {
  const W = 132, H = 46, cell = 5.4;
  const rnd = (a, b) => a + Math.random() * (b - a);
  let shapes = '';
  // 干扰线与噪点
  for (let i = 0; i < 4; i++) {
    shapes += `<line x1="${rnd(0, W).toFixed(1)}" y1="${rnd(0, H).toFixed(1)}" x2="${rnd(0, W).toFixed(1)}" y2="${rnd(0, H).toFixed(1)}" stroke="rgba(0,0,0,${rnd(0.08, 0.2).toFixed(2)})" stroke-width="1"/>`;
  }
  for (let i = 0; i < 26; i++) {
    shapes += `<circle cx="${rnd(2, W - 2).toFixed(1)}" cy="${rnd(2, H - 2).toFixed(1)}" r="${rnd(0.6, 1.5).toFixed(1)}" fill="rgba(0,0,0,${rnd(0.1, 0.28).toFixed(2)})"/>`;
  }
  code.split('').forEach((d, idx) => {
    const rows = DIGIT_FONT[d];
    const ox = 14 + idx * 29 + rnd(-2, 2);
    const oy = 8 + rnd(-2.5, 2.5);
    const rot = rnd(-11, 11).toFixed(1);
    let rects = '';
    rows.forEach((row, y) => row.split('').forEach((bit, x) => {
      if (bit === '1') {
        rects += `<rect x="${(x * cell + rnd(-0.7, 0.7)).toFixed(1)}" y="${(y * cell + rnd(-0.7, 0.7)).toFixed(1)}" width="${(cell - 0.8).toFixed(1)}" height="${(cell - 0.8).toFixed(1)}" rx="1.2" fill="#18181b"/>`;
      }
    }));
    shapes += `<g transform="translate(${ox.toFixed(1)},${oy.toFixed(1)}) rotate(${rot})">${rects}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#f4f4f5"/>${shapes}</svg>`;
}

export async function createCaptcha(secret) {
  const code = String(Math.floor(1000 + Math.random() * 9000));
  const exp = Math.floor(Date.now() / 1000) + CAPTCHA_TTL;
  const sig = await sha256Hex(`${code}|${exp}|${secret}`);
  return { code, svg: captchaSvg(code), cookieValue: `${exp}.${sig}` };
}

export async function verifyCaptcha(secret, cookieValue, input) {
  const m = String(cookieValue || '').match(/^(\d+)\.([0-9a-f]{64})$/);
  const code = String(input || '').trim();
  if (!m || !/^\d{4}$/.test(code)) return false;
  const exp = parseInt(m[1], 10);
  if (Math.floor(Date.now() / 1000) > exp) return false;
  const expect = await sha256Hex(`${code}|${exp}|${secret}`);
  return expect === m[2];
}
