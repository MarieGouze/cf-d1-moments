// 富文本（HTML）内容处理：后台所见即所得编辑器存 HTML，渲染前必须过白名单过滤。
// 旧文章是 Markdown，用 isHtmlContent 区分，两条渲染路径并存。
import { renderMarkdown, plainTextExcerpt } from './markdown.js';

// 内容以标签开头的视为 HTML（编辑器产物恒以 <p>/<h*>/<div> 等开头）
export function isHtmlContent(content) {
  const s = String(content || '').trimStart();
  return /^<[a-zA-Z/!]/.test(s);
}

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'div', 'span', 'blockquote', 'pre', 'code',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup', 'font',
  'ul', 'ol', 'li', 'a', 'img', 'iframe',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'figure', 'figcaption', 'video', 'source',
]);
// 这些标签连同内容整体丢弃
const DROP_WITH_CONTENT = new Set(['script', 'style', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'link', 'meta', 'title', 'noscript', 'template', 'svg', 'math']);
const VOID_TAGS = new Set(['br', 'hr', 'img', 'source']);
const IFRAME_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com', 'player.bilibili.com', 'player.vimeo.com', 'open.douyin.com']);

function isSafeHref(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  if (u.startsWith('#') || u.startsWith('/') || u.startsWith('./') || u.startsWith('../')) return true;
  const lower = u.toLowerCase();
  return lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:');
}
function isSafeSrc(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  if (u.startsWith('/')) return true;
  const lower = u.toLowerCase();
  return lower.startsWith('http://') || lower.startsWith('https://');
}
function isSafeIframe(url) {
  try {
    const u = new URL(String(url || '').trim());
    return u.protocol === 'https:' && IFRAME_HOSTS.has(u.hostname);
  } catch { return false; }
}

// 判断颜色是否为近纯黑/近纯白（多为从外部网页粘贴时带进来的默认色）：
// 这类颜色写死后在相反主题下看不见，过滤掉让文字回落到主题自适应色。半透明的不动。
function colorExtremeness(val) {
  const v = String(val || '').trim().toLowerCase();
  let r, g, b, a = 1;
  const m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(',').map((s) => parseFloat(s));
    [r, g, b] = p;
    if (p.length > 3) a = p[3];
  } else if (/^#[0-9a-f]{3}$/.test(v)) {
    r = parseInt(v[1] + v[1], 16); g = parseInt(v[2] + v[2], 16); b = parseInt(v[3] + v[3], 16);
  } else if (/^#[0-9a-f]{6}$/.test(v)) {
    r = parseInt(v.slice(1, 3), 16); g = parseInt(v.slice(3, 5), 16); b = parseInt(v.slice(5, 7), 16);
  } else if (v === 'black') { r = g = b = 0; } else if (v === 'white') { r = g = b = 255; } else return null;
  if ([r, g, b].some((n) => Number.isNaN(n)) || a < 0.5) return null;
  if (Math.max(r, g, b) <= 110) return 'dark';
  if (Math.min(r, g, b) >= 235) return 'light';
  return null;
}

// style 只保留安全属性，值里禁 url( / expression / 引号与尖括号；
// color/background-color 为近纯黑/近纯白时丢弃（粘贴带入的默认色，防暗黑下黑字看不见）
const SAFE_STYLE_PROPS = new Set(['color', 'background-color', 'text-align', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line']);
function filterStyle(style) {
  const out = [];
  for (const part of String(style || '').split(';')) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    const prop = part.slice(0, idx).trim().toLowerCase();
    const val = part.slice(idx + 1).trim();
    if (!SAFE_STYLE_PROPS.has(prop)) continue;
    if (!val || /url\s*\(|expression|[<>"'`\\]/.test(val)) continue;
    if ((prop === 'color' || prop === 'background-color') && colorExtremeness(val)) continue;
    out.push(`${prop}: ${val}`);
  }
  return out.join('; ');
}

function parseAttrs(raw) {
  const attrs = {};
  const re = /([a-zA-Z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`>]+)))?/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}
function escAttr(v) {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildAttrs(tag, attrs) {
  const keep = [];
  const style = attrs.style ? filterStyle(attrs.style) : '';
  if (style) keep.push(`style="${escAttr(style)}"`);
  if (tag === 'a') {
    if (attrs.href && isSafeHref(attrs.href)) keep.push(`href="${escAttr(attrs.href)}"`);
    if (attrs.title) keep.push(`title="${escAttr(attrs.title)}"`);
    if (attrs.target === '_blank') keep.push('target="_blank"', 'rel="noopener"');
  } else if (tag === 'img') {
    if (attrs.src && isSafeSrc(attrs.src)) keep.push(`src="${escAttr(attrs.src)}"`);
    if (attrs.alt) keep.push(`alt="${escAttr(attrs.alt)}"`);
    if (/^\d{1,4}$/.test(attrs.width || '')) keep.push(`width="${attrs.width}"`);
    if (/^\d{1,4}$/.test(attrs.height || '')) keep.push(`height="${attrs.height}"`);
    keep.push('loading="lazy"');
  } else if (tag === 'iframe') {
    if (attrs.src && isSafeIframe(attrs.src)) keep.push(`src="${escAttr(attrs.src)}"`);
    if (/^\d{1,4}$/.test(attrs.width || '')) keep.push(`width="${attrs.width}"`);
    if (/^\d{1,4}$/.test(attrs.height || '')) keep.push(`height="${attrs.height}"`);
    keep.push('allowfullscreen', 'frameborder="0"', 'loading="lazy"');
  } else if (tag === 'font') {
    if (attrs.color && /^[#a-zA-Z0-9(),.\s%]+$/.test(attrs.color) && !colorExtremeness(attrs.color)) keep.push(`color="${escAttr(attrs.color)}"`);
    if (/^[1-7]$/.test(attrs.size || '')) keep.push(`size="${attrs.size}"`);
  } else if (tag === 'td' || tag === 'th') {
    if (/^\d{1,2}$/.test(attrs.colspan || '')) keep.push(`colspan="${attrs.colspan}"`);
    if (/^\d{1,2}$/.test(attrs.rowspan || '')) keep.push(`rowspan="${attrs.rowspan}"`);
  } else if (tag === 'video') {
    if (attrs.src && isSafeSrc(attrs.src)) keep.push(`src="${escAttr(attrs.src)}"`);
    keep.push('controls');
  } else if (tag === 'source') {
    if (attrs.src && isSafeSrc(attrs.src)) keep.push(`src="${escAttr(attrs.src)}"`);
  }
  return keep.length ? ' ' + keep.join(' ') : '';
}

export function sanitizeHtml(html) {
  const input = String(html || '');
  const tokens = input.split(/(<!--[\s\S]*?-->|<[^>]+>)/g).filter((t) => t !== '');
  let out = '';
  let dropDepth = 0; // 在被整体丢弃的标签内时 >0
  for (const tok of tokens) {
    if (tok.startsWith('<!--')) continue;
    if (!tok.startsWith('<')) {
      if (!dropDepth) out += tok;
      continue;
    }
    const m = tok.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)\/?>$/);
    if (!m) continue; // 形如 <!doctype> 等直接丢弃
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const selfClose = /\/>$/.test(tok) || VOID_TAGS.has(tag);
    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing && !selfClose) dropDepth++;
      else if (closing && dropDepth) dropDepth--;
      continue;
    }
    if (dropDepth) continue;
    if (!ALLOWED_TAGS.has(tag)) continue; // 未知标签丢标签留内容
    if (closing) {
      if (!VOID_TAGS.has(tag)) out += `</${tag}>`;
      continue;
    }
    if (tag === 'iframe') {
      const attrs = parseAttrs(m[3] || '');
      if (!isSafeIframe(attrs.src || '')) { dropDepth++; continue; } // 非白名单视频整段丢弃（含兜底内容）
    }
    out += `<${tag}${buildAttrs(tag, parseAttrs(m[3] || ''))}>`;
    if (selfClose && !VOID_TAGS.has(tag)) out += `</${tag}>`;
  }
  return out;
}

// 取正文里的第一张图（列表缩略图用）：HTML 找 <img src>，Markdown 找 ![..](..)
export function firstImageOf(content) {
  const s = String(content || '');
  const ok = (u) => u && (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('/')) ? u : '';
  if (isHtmlContent(s)) {
    const m = s.match(/<img[^>]*\ssrc\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    return m ? ok(m[1] || m[2] || '') : '';
  }
  const m = s.match(/!\[[^\]]*\]\(\s*([^\s)]+)[^)]*\)/);
  return m ? ok(m[1]) : '';
}

// 统一渲染：HTML 过过滤器，Markdown 走原渲染器
export function renderContent(content) {
  return isHtmlContent(content) ? sanitizeHtml(content) : renderMarkdown(content);
}

// 统一摘要：HTML 先去标签再截取
export function excerptOf(content, len = 160) {
  if (isHtmlContent(content)) {
    const text = String(content)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ').trim();
    return text.length > len ? text.slice(0, len) + '…' : text;
  }
  return plainTextExcerpt(content, len);
}
