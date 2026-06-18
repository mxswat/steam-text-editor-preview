/**
 * Steam BBCode -> HTML parser.
 *
 * Design notes (why this differs from a naive regex pipeline):
 *  - Block-level elements (code, quote, table, lists) are parsed FIRST and replaced
 *    with opaque placeholder tokens. This means later steps (inline formatting,
 *    paragraph/newline handling) never see their raw contents and can't corrupt them.
 *  - Content that must not be HTML-escaped twice (code, noparse) is escaped exactly once,
 *    at extraction time, then protected behind a placeholder.
 *  - List/table parsing handles one level of nesting correctly by repeatedly resolving
 *    the innermost (non-nested) tag first, so inner [list]/[quote]/[table] are fully
 *    resolved into placeholders before the outer one tries to match its closing tag.
 *  - Paragraph wrapping operates on a token stream where every placeholder is already
 *    a "block", so a blank line inside a code block can never split a <pre> in half.
 */

type Protected = { token: string; html: string };

let protectedCounter = 0;
function nextToken(): string {
  protectedCounter += 1;
  return `\u0000BBP${protectedCounter}\u0000`; // unlikely to collide with user content
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Repeatedly replaces the innermost match of `regex` (one with no nested opening
 * tag of the same kind inside it) until no more matches remain. This gives correct
 * handling of nested [list]/[quote]/[table] without a full recursive-descent parser.
 */
function resolveInnermostFirst(
  text: string,
  openTagRegex: RegExp,
  buildRegexForInnermost: () => RegExp,
  replacer: (match: string, ...groups: string[]) => string,
): string {
  let result = text;
  let safety = 0;
  while (openTagRegex.test(result) && safety < 50) {
    safety += 1;
    const innermost = buildRegexForInnermost();
    const next = result.replace(innermost, replacer as any);
    if (next === result) break; // no progress, avoid infinite loop
    result = next;
    openTagRegex.lastIndex = 0;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Step 1: protect [code] and [noparse] — escape once, lock contents from
// any further processing.
// ---------------------------------------------------------------------------
function protectCodeAndNoparse(text: string, store: Protected[]): string {
  let result = text;

  // NOTE: `text` here has already been through escapeHtml() once (see parseBBCode),
  // so content captured below is already HTML-safe — do NOT escape it again.
  result = result.replace(/\[noparse\]([\s\S]*?)\[\/noparse\]/gi, (_m, content) => {
    const token = nextToken();
    store.push({ token, html: content });
    return token;
  });

  result = result.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_m, content) => {
    const token = nextToken();
    const html = `<pre><code>${content.replace(/^\n/, '').replace(/\n$/, '')}</code></pre>`;
    store.push({ token, html });
    return token;
  });

  return result;
}

// ---------------------------------------------------------------------------
// Step 2: lists (handles [*] items, one or more levels of nesting)
// ---------------------------------------------------------------------------
function buildListItems(content: string): string {
  // Split on [*] markers; first chunk before the first [*] is discarded if empty/whitespace.
  const parts = content.split(/\[\*\]/g);
  const items = parts.slice(1).length > 0 ? parts.slice(1) : parts;
  return items
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => `<li>${item}</li>`)
    .join('');
}

function protectLists(text: string, store: Protected[]): string {
  let result = text;

  // [list]...[/list] -> <ul>
  result = resolveInnermostFirst(
    result,
    /\[list\]/i,
    () => /\[list\]((?:(?!\[list\]|\[\/list\])[\s\S])*?)\[\/list\]/i,
    (_m: string, content: string) => {
      const token = nextToken();
      store.push({ token, html: `<ul>${buildListItems(content)}</ul>` });
      return token;
    },
  );

  // [olist]...[/olist] -> <ol>
  result = resolveInnermostFirst(
    result,
    /\[olist\]/i,
    () => /\[olist\]((?:(?!\[olist\]|\[\/olist\])[\s\S])*?)\[\/olist\]/i,
    (_m: string, content: string) => {
      const token = nextToken();
      store.push({ token, html: `<ol>${buildListItems(content)}</ol>` });
      return token;
    },
  );

  return result;
}

// ---------------------------------------------------------------------------
// Step 3: quotes (support nesting, e.g. a quote inside a quote)
// ---------------------------------------------------------------------------
function protectQuotes(text: string, store: Protected[]): string {
  let result = text;

  result = resolveInnermostFirst(
    result,
    /\[quote(=[^\]]*)?\]/i,
    () => /\[quote(?:=([^\]]*))?\]((?:(?!\[quote(?:=[^\]]*)?\]|\[\/quote\])[\s\S])*?)\[\/quote\]/i,
    (_m: string, author: string | undefined, content: string) => {
      const token = nextToken();
      const header = author
        ? `<cite>Originally posted by <strong>${author.trim()}</strong>:</cite>`
        : '';
      store.push({ token, html: `<blockquote>${header}${content}</blockquote>` });
      return token;
    },
  );

  return result;
}

// ---------------------------------------------------------------------------
// Step 4: tables (no nesting support needed — Steam tables aren't nestable)
// ---------------------------------------------------------------------------
function protectTablesV2(text: string, store: Protected[]): string {
  const tableRegex = /\[table(?:\s+noborder=(\d))?(?:\s+equalcells=(\d))?\]([\s\S]*?)\[\/table\]/gi;

  return text.replace(tableRegex, (_m, noborder, equalcells, content) => {
    const attrs: string[] = [];
    if (noborder === '1') attrs.push('data-noborder="1"');
    if (equalcells === '1') attrs.push('data-equalcells="1"');

    const rows = content.replace(
      /\[tr\]([\s\S]*?)\[\/tr\]/gi,
      (_rm: string, cells: string) => {
        const rowHtml = cells
          .replace(/\[th\]([\s\S]*?)\[\/th\]/gi, '<th>$1</th>')
          .replace(/\[td\]([\s\S]*?)\[\/td\]/gi, '<td>$1</td>');
        return `<tr>${rowHtml}</tr>`;
      },
    );

    const attrStr = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
    const token = nextToken();
    store.push({ token, html: `<table${attrStr}>${rows}</table>` });
    return token;
  });
}

// ---------------------------------------------------------------------------
// Step 5: inline formatting (headers, bold, italics, links, images, etc.)
// Safe to run now — code/noparse/lists/quotes/tables are all opaque tokens.
// ---------------------------------------------------------------------------
function applyInlineFormatting(text: string): string {
  let result = text;

  result = result
    .replace(/\[h1\]([\s\S]*?)\[\/h1\]/gi, '<h1>$1</h1>')
    .replace(/\[h2\]([\s\S]*?)\[\/h2\]/gi, '<h2>$1</h2>')
    .replace(/\[h3\]([\s\S]*?)\[\/h3\]/gi, '<h3>$1</h3>')
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>')
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>')
    .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>')
    .replace(/\[strike\]([\s\S]*?)\[\/strike\]/gi, '<s>$1</s>')
    .replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<s>$1</s>')
    .replace(/\[center\]([\s\S]*?)\[\/center\]/gi, '<div style="text-align:center;">$1</div>')
    .replace(/\[hr\]\s*\[\/hr\]/gi, '<hr>')
    .replace(
      /\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi,
      '<a href="$1" target="_blank" rel="noopener">$2</a>',
    )
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(
      /\[img\]([\s\S]*?)\[\/img\]/gi,
      (_m, src) => `<img src="${src.trim()}" alt="Image" loading="lazy" />`,
    )
    .replace(/\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi, '<span class="steam-spoiler"><span>$1</span></span>')
    .replace(
      /\[size=(\d+)\]([\s\S]*?)\[\/size\]/gi,
      (_m, size, content) =>
        `<span style="font-size:${Math.min(7, Math.max(1, parseInt(size, 10) / 12))}em;">${content}</span>`,
    )
    .replace(/\[color=([^\]]+)\]([\s\S]*?)\[\/color\]/gi, '<span style="color:$1;">$2</span>');

  return result;
}

// ---------------------------------------------------------------------------
// Step 6: paragraphs. By this point every block-level construct (code, quote,
// table, list) is a single-line opaque token, so splitting on blank lines is
// safe — there's nothing block-shaped left in the text to accidentally slice.
// ---------------------------------------------------------------------------
const BLOCK_TOKEN_LINE = /^\u0000BBP\d+\u0000$/;
const HEADER_OR_HR_LINE = /^<(h[1-3]|hr)\b/i;

function wrapParagraphs(text: string): string {
  const blocks = text.split(/\n{2,}/);

  return blocks
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return '';

      // A block that consists of nothing but a single placeholder token is
      // already a full block element (ul/ol/blockquote/table/pre) — never
      // wrap it in <p>.
      if (BLOCK_TOKEN_LINE.test(trimmed)) {
        return trimmed;
      }

      // Multi-line block: render each line, only wrapping lines that are
      // plain inline content; pass block tokens / headers / <hr> through as-is.
      const lines = trimmed.split('\n');
      const rendered: string[] = [];
      let inlineBuffer: string[] = [];

      const flushInline = () => {
        if (inlineBuffer.length > 0) {
          rendered.push(`<p>${inlineBuffer.join('<br>')}</p>`);
          inlineBuffer = [];
        }
      };

      for (const line of lines) {
        const lineTrimmed = line.trim();
        if (BLOCK_TOKEN_LINE.test(lineTrimmed) || HEADER_OR_HR_LINE.test(lineTrimmed)) {
          flushInline();
          rendered.push(lineTrimmed);
        } else {
          inlineBuffer.push(line);
        }
      }
      flushInline();

      return rendered.join('\n');
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Step 7: substitute placeholder tokens back with their real HTML.
// ---------------------------------------------------------------------------
function restoreProtected(text: string, store: Protected[]): string {
  let result = text;
  // Restore in reverse so nested placeholders (created later, i.e. inner content
  // resolved first) are substituted before any outer ones that might reference them.
  for (let i = store.length - 1; i >= 0; i -= 1) {
    const { token, html } = store[i];
    result = result.split(token).join(html);
  }
  return result;
}

export function parseBBCode(text: string): string {
  const store: Protected[] = [];
  protectedCounter = 0;

  let html = escapeHtml(text);

  // Order matters:
  //  1. Protect [code]/[noparse] first — their content must never be touched again.
  //  2. Apply inline formatting ([b], [i], [url], [img], etc.) to everything else,
  //     INCLUDING the not-yet-protected insides of [list]/[quote]/[table] — this is
  //     why inline formatting runs before block protection, not after.
  //  3. Protect lists/quotes/tables — by now their inner content is already
  //     fully-formatted HTML, so turning them into opaque tokens is safe.
  //  4. Wrap remaining loose text into paragraphs.
  //  5. Restore every placeholder token back to real HTML.
  html = protectCodeAndNoparse(html, store);
  html = applyInlineFormatting(html);
  html = protectLists(html, store);
  html = protectQuotes(html, store);
  html = protectTablesV2(html, store);

  html = wrapParagraphs(html);
  html = restoreProtected(html, store);

  return html;
}