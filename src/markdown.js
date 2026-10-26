// 安全的 Markdown 渲染器（零依赖）
// 原则：先转义原文中的全部 HTML，再做 Markdown 转换；
// 链接 / 图片地址只允许 http、https、mailto 与站内相对地址，
// javascript:、data:、vbscript: 等危险协议一律拦成 #。

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return false;
  if (url.startsWith('#') || url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return true;
  const lower = url.toLowerCase();
  return lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('mailto:');
}

// 行内渲染：入参必须是已经 escapeHtml 过的文本
function renderInline(escaped) {
  const stash = [];
  const keep = (html) => {
    stash.push(html);
    return `\u0000${stash.length - 1}\u0000`;
  };

  let text = escaped;

  // 行内代码先摘走，避免里面的 *、[ 等被误处理
  text = text.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${code}</code>`));

  // 图片 ![alt](url)
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, alt, url) => {
    if (!isSafeUrl(url)) return keep(`<span>${alt}</span>`);
    return keep(`<img src="${url}" alt="${alt}" loading="lazy">`);
  });

  // 链接 [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, label, url) => {
    if (!isSafeUrl(url)) return keep(`<a href="#">${label}</a>`);
    const external = /^https?:\/\//i.test(url) ? ' target="_blank" rel="noopener noreferrer"' : '';
    return keep(`<a href="${url}"${external}>${label}</a>`);
  });

  // 粗体、斜体、删除线
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // 还原被摘走的代码 / 链接 / 图片
  text = text.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)] ?? '');
  return text;
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

export function renderMarkdown(source) {
  const escaped = escapeHtml(String(source ?? '').replace(/\r\n?/g, '\n'));
  const lines = escaped.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块 ```lang
    const fence = line.match(/^```([a-zA-Z0-9_-]*)\s*$/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // 跳过结束围栏
      const cls = fence[1] ? ` class="language-${fence[1]}"` : '';
      out.push(`<pre><code${cls}>${buf.join('\n')}</code></pre>`);
      continue;
    }

    // 空行
    if (!line.trim()) { i++; continue; }

    // 标题
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // 分割线
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    // 表格：当前行含 |，下一行是 |---| 分隔行
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const headers = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const thead = headers.map((h) => `<th>${renderInline(h)}</th>`).join('');
      const tbody = rows.map((r) => `<tr>${headers.map((_, idx) => `<td>${renderInline(r[idx] ?? '')}</td>`).join('')}</tr>`).join('');
      out.push(`<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`);
      continue;
    }

    // 引用块
    if (/^&gt;\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^&gt;\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${buf.map((l) => `<p>${renderInline(l)}</p>`).join('')}</blockquote>`);
      continue;
    }

    // 列表（无序 / 有序，支持一层缩进，统一拍平渲染）
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length && (/^\s*[-*+]\s+/.test(lines[i]) || /^\s*\d+[.)]\s+/.test(lines[i]))) {
        items.push(lines[i].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''));
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => `<li>${renderInline(it)}</li>`).join('')}</${tag}>`);
      continue;
    }

    // 普通段落：合并到空行或块级元素为止
    const buf = [line];
    i++;
    while (
      i < lines.length && lines[i].trim() &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^&gt;\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) { buf.push(lines[i]); i++; }
    out.push(`<p>${renderInline(buf.join(' '))}</p>`);
  }

  return out.join('\n');
}

// 从 Markdown 原文生成纯文本摘要
export function plainTextExcerpt(source, length = 160) {
  const text = String(source ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*`_~\-|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > length ? text.slice(0, length) + '…' : text;
}
