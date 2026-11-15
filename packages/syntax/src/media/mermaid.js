/**
 * ```mermaid fences: finding them in a document and the attributes of their <figure>.
 *
 * Pure helpers (no Node, no browser): pagemd's renderer uses them to draw every diagram of a document, and the
 * editor uses the same version and settings, so the canvas, the Print Preview and the CLI draw identical diagrams
 * (phase C6, R-81, R-108). Moved from pagemd `packages/parser/src/mermaid.js`.
 */

/**
 * The one `mermaid` library version pagemd and the editor both pin (exactly). A test in each repo checks that the
 * installed library is this version.
 */
export const MERMAID_VERSION = '12.1.0';

/** The settings both draw diagrams with (`mermaid.initialize`). */
export const MERMAID_CONFIG = Object.freeze({ startOnLoad: false, theme: 'default', securityLevel: 'strict' });

/**
 * Parse fence attributes from a `{...}` string into an HTML attribute string.
 * Supports `.class-name`, `#id-name`, and `key="value"` / `key='value'` syntax.
 * Always includes `mermaid-diagram` as a base class.
 *
 * @param {string|null} attrsRaw - Merged attribute content (inner text from `{...}` braces, without braces)
 * @returns {string} HTML attribute string with leading space, e.g. ` class="mermaid-diagram custom" id="fig-1"`
 */
export function parseFenceAttributes(attrsRaw) {
  const classes = ['mermaid-diagram'];
  if (!attrsRaw) return ` class="${classes.join(' ')}"`;

  const inner = attrsRaw.trim();
  if (!inner) return ` class="${classes.join(' ')}"`;

  let id = null;
  const attrs = {};

  // Match .class, #id, key="value", key='value'
  const tokenRegex = /\.([a-zA-Z0-9_-]+)|#([a-zA-Z0-9_-]+)|([a-zA-Z][a-zA-Z0-9_-]*)=(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = tokenRegex.exec(inner)) !== null) {
    if (m[1]) {
      classes.push(m[1]);
    } else if (m[2]) {
      // First id wins (opening fence takes precedence)
      if (!id) id = m[2];
    } else if (m[3]) {
      // First value wins for duplicate keys (opening fence takes precedence)
      if (!(m[3] in attrs)) attrs[m[3]] = m[4] ?? m[5];
    }
  }

  let result = ` class="${classes.join(' ')}"`;
  if (id) result += ` id="${id}"`;
  for (const [key, value] of Object.entries(attrs)) {
    result += ` ${key}="${value}"`;
  }
  return result;
}

// An opening fence: up to any indentation (a fence inside a list item is indented), three or more backticks or
// tildes, then the info text.
const OPEN = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
// A mermaid fence's info: `mermaid`, optional spaces, an optional `{…}`, optional spaces.
const MERMAID_INFO = /^mermaid[^\S\n]*(?:\{([^}]*)\})?[^\S\n]*$/;
// A closing fence for a mermaid block may carry `{…}` attributes (pagemd's own form).
const CLOSE_ATTRS = /^[^\S\n]*(?:\{([^}]*)\})?[^\S\n]*$/;

/**
 * Extract mermaid code blocks from markdown, including optional fence attributes.
 *
 * Supports:
 * - Standard:           ```mermaid\n...\n```
 * - Trailing whitespace: ```mermaid  \n...\n```
 * - Opening attrs:      ```mermaid {.class style="..."}\n...\n```
 * - Closing attrs:      ```\n...\n``` {style="..."}
 * - Both:               Opening attrs take precedence for conflicts
 *
 * Fences are followed line by line, so a ```mermaid example shown *inside* another fence (for example a
 * ````markdown block documenting the syntax) is part of that fence and is not a diagram (phase C6; the old
 * pattern matched it anywhere in the text).
 *
 * @param {string} markdown - Markdown content
 * @returns {Array<{code: string, attrs: string|null, fullMatch: string, start: number, end: number}>} Mermaid blocks;
 *   `start`/`end` are character offsets of the fence (from its first backtick to the end of the closing fence)
 */
export function extractMermaidBlocks(markdown) {
  const blocks = [];
  const lines = splitLines(markdown);
  let open = null; // { char, length, mermaid, attrs, start, codeStart }

  for (const line of lines) {
    const text = line.text;
    if (!open) {
      const m = OPEN.exec(text);
      if (!m) continue;
      const marker = m[2];
      const info = m[3];
      // CommonMark: a backtick fence's info may not contain a backtick (then it is inline code, not a fence)
      if (marker[0] === '`' && info.includes('`')) continue;
      const mermaid = marker[0] === '`' && MERMAID_INFO.exec(info);
      open = {
        char: marker[0],
        length: marker.length,
        mermaid: Boolean(mermaid),
        attrs: mermaid ? (mermaid[1] ?? null) : null,
        start: line.start + m[1].length,
        codeStart: line.next
      };
      continue;
    }

    const trimmed = text.replace(/^[ \t]*/, '');
    const indent = text.length - trimmed.length;
    const run = /^(`+|~+)/.exec(trimmed);
    if (!run || run[1][0] !== open.char || run[1].length < open.length) continue;
    const rest = trimmed.slice(run[1].length);
    if (open.mermaid) {
      const close = CLOSE_ATTRS.exec(rest);
      if (!close) continue;
      const code = markdown.slice(open.codeStart, line.start).trim();
      const closeAttrs = close[1] ?? null;
      const openAttrs = open.attrs;
      const end = line.start + indent + run[1].length + rest.replace(/\s+$/, '').length;
      blocks.push({
        code,
        attrs: openAttrs && closeAttrs ? `${openAttrs} ${closeAttrs}` : (openAttrs || closeAttrs),
        fullMatch: markdown.slice(open.start, end),
        start: open.start,
        end
      });
      open = null;
    } else if (/^[^\S\n]*$/.test(rest)) {
      open = null;
    }
  }

  return blocks;
}

/** Lines with their offsets: `start` of the text, `next` = the start of the following line. */
function splitLines(text) {
  const lines = [];
  let pos = 0;
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos);
    const endOfText = nl === -1 ? text.length : nl;
    const lineText = text.slice(pos, endOfText).replace(/\r$/, '');
    lines.push({ text: lineText, start: pos, next: nl === -1 ? text.length : nl + 1 });
    if (nl === -1) break;
    pos = nl + 1;
  }
  return lines;
}
