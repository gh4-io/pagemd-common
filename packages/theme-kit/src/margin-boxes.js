/**
 * Running headers and footers written directly in a layout's CSS (phase P6 of pagemd-editor, R-141, its OQ-35),
 * e.g. book-wiki's `book.css`:
 *
 *   .book-content h1 { string-set: chapter-title content(text); }
 *   @page { @top-right { content: string(chapter-title, first); } @bottom-center { content: counter(page); } }
 *   @page :first { @top-right { content: none; } }
 *
 * pagemd's PDF gets these from Paged.js; an editor that draws its own pages reads them here. A small reader, no CSS
 * library (like geometry.js). What it understands, per margin box of the unnamed `@page` and `@page :first`:
 * - `content:` made of quoted strings, `counter(page)`, `counter(pages)` and `string(name[, keyword])`, written as
 *   pagemd's running-content text: `:::PAGE`, `:::PAGES` and `:::STRING(name)` (the keyword is dropped: the editor
 *   shows the page's first value, or the one carried over from earlier pages);
 * - `content: none` / `normal`: the box is empty (null);
 * - anything else (`var()`, which is how pagemd's own `letter.css` takes running content from the document's
 *   properties; `attr()`, other counters, `element()`): not readable, the box is left out.
 * Only the six top/bottom boxes count. Later rules win. And `string-set: name content(text)` (or `content()`) rules,
 * as `{ name: selector }`.
 *
 * Named pages (pagemd-editor P21): the boxes of `@page name { … }` and `@page name:first { … }` (the first page of each
 * run of that page type, as Paged.js does) are read too, under `named[name]` (the name in lower case), in the same
 * value form. There, a box written with a value that can't be read (`var()` …) is not left out but recorded as
 * FROM_PROPERTIES: it shows the document's own property for that box (pagemd's `letter.css` writes its `landscape` and
 * `default` pages that way), not the unnamed page's text. A box a named page doesn't write is absent: it is inherited.
 * `named` is only there when a named page writes a box; `all` and `first` are read exactly as before.
 * Still ignored: `@page :left` / `:right` / `:blank`, their combinations with a name, lists of selectors, and every
 * declaration of a box but `content` (font size, color, alignment).
 */

/** A named page's box written with a value the reader can't read (`var()` …): the document's own property for it. */
export const FROM_PROPERTIES = Object.freeze({ fromProperties: true });

/** true for the FROM_PROPERTIES marker (also a copy of it, e.g. after JSON) */
export const isFromProperties = (value) => Boolean(value && typeof value === 'object' && value.fromProperties === true);

const BOXES = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The text between the `{` at `open` and its matching `}` (quotes respected), and the index after it. */
function block(text, open) {
  let depth = 0;
  let quote = '';
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return { body: text.slice(open + 1, i), end: i + 1 };
  }
  return { body: text.slice(open + 1), end: text.length };
}

/** Splits at `;` outside quotes and parentheses. */
function declarations(body) {
  const out = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i <= body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if ((ch === ';' && depth === 0) || i === body.length) {
      const part = body.slice(start, i);
      const colon = part.indexOf(':');
      if (colon !== -1) out.push([part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).replace(/!important\s*$/i, '').trim()]);
      start = i + 1;
    }
  }
  return out;
}

const unescape = (s) => s.replace(/\\A\s?/gi, '\n').replace(/\\(.)/g, '$1');

/**
 * A margin box's `content` value as running-content text: a string, null for `none`/`normal`, undefined when it
 * can't be read.
 * @param {string} value
 * @returns {string|null|undefined}
 */
export function contentToTokens(value) {
  const text = value.trim();
  if (/^(none|normal)$/i.test(text)) return null;
  const re = /\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|counter\(\s*(page|pages)\s*\)|string\(\s*([\w-]+)\s*(?:,\s*[\w-]+\s*)?\))\s*/giy;
  let out = '';
  let index = 0;
  let match;
  while (index < text.length && (match = re.exec(text))) {
    index = re.lastIndex;
    if (match[1] !== undefined) out += unescape(match[1]);
    else if (match[2] !== undefined) out += unescape(match[2]);
    else if (match[3]) out += match[3].toLowerCase() === 'pages' ? ':::PAGES' : ':::PAGE';
    else out += `:::STRING(${match[4]})`;
  }
  return index === text.length && text.length > 0 ? out : undefined;
}

/**
 * The six top/bottom margin boxes of the unnamed `@page` (`all`) and `@page :first` (`first`), as running-content
 * text, and those of named pages (`named`, only when there are any; see the file header).
 * @param {string} css - the stylesheets, in cascade order
 * @returns {{ all: Record<string, string|null>, first: Record<string, string|null>,
 *   named?: Record<string, { all: Record<string, string|null|typeof FROM_PROPERTIES>, first: Record<string, string|null|typeof FROM_PROPERTIES> }> }}
 */
export function marginBoxes(css) {
  const text = stripComments(css || '');
  const result = { all: {}, first: {} };
  const named = {};
  const re = /@page\b([^{]*)\{/gi;
  let match;
  while ((match = re.exec(text))) {
    const { body, end } = block(text, re.lastIndex - 1);
    re.lastIndex = end;
    const prelude = match[1].trim().toLowerCase();
    let target = prelude === '' ? result.all : prelude === ':first' ? result.first : null;
    const page = target ? null : /^(-?[a-z_][\w-]*)\s*(:first)?$/.exec(prelude);
    if (page) {
      named[page[1]] ??= { all: {}, first: {} };
      target = page[2] ? named[page[1]].first : named[page[1]].all;
    }
    if (!target) continue;
    const boxRe = /@([a-z-]+)\s*\{/gi;
    let box;
    while ((box = boxRe.exec(body))) {
      const inner = block(body, boxRe.lastIndex - 1);
      boxRe.lastIndex = inner.end;
      const name = box[1].toLowerCase();
      if (!BOXES.includes(name)) continue;
      for (const [prop, value] of declarations(inner.body)) {
        if (prop !== 'content') continue;
        const tokens = contentToTokens(value);
        if (tokens !== undefined) target[name] = tokens;
        else if (page) target[name] = FROM_PROPERTIES;
        else delete target[name];
      }
    }
  }
  const written = Object.entries(named).filter(([, n]) => Object.keys(n.all).length || Object.keys(n.first).length);
  if (written.length) result.named = Object.fromEntries(written);
  return result;
}

/**
 * `string-set` rules: which elements set each named string (`{ 'chapter-title': '.book-content h1' }`). Only
 * `content(text)` / `content()` values; several selectors keep their comma-separated list; later rules win.
 * @param {string} css
 * @returns {Record<string, string>}
 */
export function stringSets(css) {
  const text = stripComments(css || '');
  const out = {};
  const re = /([^{}@;]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(text))) {
    for (const [prop, value] of declarations(match[2])) {
      if (prop !== 'string-set') continue;
      const m = /^([\w-]+)\s+content\(\s*(?:text)?\s*\)$/i.exec(value);
      if (m) out[m[1]] = match[1].trim().replace(/\s+/g, ' ');
    }
  }
  return out;
}

/**
 * Running header/footer from a layout's own margin boxes, in runningContent()'s shape (left/center/right), plus
 * the named strings they use. `firstPage` follows runningContent()'s meaning: an object replaces the header or
 * footer on the first page, `false` hides it.
 * `named` (only when a named page writes a box; pagemd-editor P21): per page type, what its `@page name` (`header`,
 * `footer`) and `@page name:first` (`first.header`, `first.footer`) write, as per-box overrides: `left`, `center`,
 * `right` hold the text, null (cleared) or FROM_PROPERTIES; a position left out is inherited from the page below.
 * @param {string} css
 * @returns {{ header: Record<string,string>|null, footer: Record<string,string>|null,
 *   firstPage: { header?: false|Record<string,string>, footer?: false|Record<string,string> } | null,
 *   strings: Record<string, string>,
 *   named?: Record<string, { header?: object, footer?: object, first?: { header?: object, footer?: object } }> }}
 */
export function layoutRunningContent(css) {
  const boxes = marginBoxes(css);
  const side = (set, prefix) => {
    const out = {};
    for (const pos of ['left', 'center', 'right']) {
      const value = set[`${prefix}-${pos}`];
      if (typeof value === 'string' && value !== '') out[pos] = value;
    }
    return Object.keys(out).length ? out : null;
  };
  const header = side(boxes.all, 'top');
  const footer = side(boxes.all, 'bottom');
  let firstPage = null;
  for (const [key, prefix] of [['header', 'top'], ['footer', 'bottom']]) {
    const touched = ['left', 'center', 'right'].some((pos) => `${prefix}-${pos}` in boxes.first);
    if (!touched) continue;
    const merged = side({ ...boxes.all, ...boxes.first }, prefix);
    firstPage = { ...firstPage, [key]: merged ?? false };
  }
  const strings = stringSets(css);
  const result = { header, footer, firstPage, strings };
  if (boxes.named) {
    const overrides = (set, prefix) => {
      const out = {};
      for (const pos of ['left', 'center', 'right']) if (`${prefix}-${pos}` in set) out[pos] = set[`${prefix}-${pos}`];
      return Object.keys(out).length ? out : undefined;
    };
    result.named = {};
    for (const [name, page] of Object.entries(boxes.named)) {
      const entry = {};
      const h = overrides(page.all, 'top');
      const f = overrides(page.all, 'bottom');
      if (h) entry.header = h;
      if (f) entry.footer = f;
      const fh = overrides(page.first, 'top');
      const ff = overrides(page.first, 'bottom');
      if (fh || ff) entry.first = { ...(fh ? { header: fh } : {}), ...(ff ? { footer: ff } : {}) };
      result.named[name] = entry;
    }
  }
  return result;
}
