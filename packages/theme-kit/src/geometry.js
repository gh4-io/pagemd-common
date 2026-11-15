/**
 * Page geometry from CSS (phase C5): the `@page` rules' size and margins as numbers, in millimetres,
 * for the editor's pages and ruler. No CSS library: a small reader for what page rules hold.
 *
 * - Only `@page` rules count. The unnamed rule without a pseudo-class (`@page { … }`) gives the page;
 *   `@page :first`/`:left`/`:right`/`:blank` are ignored; a named rule (`@page landscape { … }`,
 *   used by LAYOUT(name)) is returned under `namedPages`, on top of the unnamed rule (as CSS does).
 * - Later declarations win (the text is read in cascade order: pass the layers in pagemd's order).
 * - `size`: page-size keywords (A5, A4, A3, B5, B4, JIS-B5, JIS-B4, letter, legal, ledger; any case),
 *   `landscape`/`portrait`, one length (a square) or two (width height). `auto` keeps the default.
 * - margins: `margin` with 1–4 values and `margin-top|right|bottom|left`.
 * - lengths: mm, cm, Q, in, pt, pc, px (1px = 1/96 in), and 0. Anything else (%, em, var(), calc())
 *   can't be read: the value keeps what it was, and the property is listed in `unreadable`.
 */

const MM = { mm: 1, cm: 10, q: 0.25, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96 };

/** Page sizes in mm, portrait (CSS Paged Media) */
export const PAGE_SIZES = {
  a5: [148, 210],
  a4: [210, 297],
  a3: [297, 420],
  b5: [176, 250],
  b4: [250, 353],
  'jis-b5': [182, 257],
  'jis-b4': [257, 364],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
  ledger: [279.4, 431.8]
};

/**
 * The page when no @page rule sets one: Paged.js's own (Letter, 1in margins), which is what pagemd's
 * PDF uses then, and also what the default layout (letter.css) sets.
 */
export const FALLBACK_PAGE = Object.freeze({
  width: 215.9,
  height: 279.4,
  margins: Object.freeze({ top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 })
});

const round = (n) => Math.round(n * 1e6) / 1e6;

/** A CSS length in mm, or null when it can't be read. */
export function lengthToMm(value) {
  const text = String(value).trim().toLowerCase();
  if (text === '0') return 0;
  const match = /^(-?\d*\.?\d+)(mm|cm|q|in|pt|pc|px)$/.exec(text);
  return match ? round(parseFloat(match[1]) * MM[match[2]]) : null;
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every `@page <prelude> { … }` with its top-level declarations (nested margin boxes skipped). */
function pageRules(css) {
  const text = stripComments(css);
  const rules = [];
  const re = /@page\b([^{]*)\{/gi;
  let match;
  while ((match = re.exec(text))) {
    let depth = 1;
    let i = re.lastIndex;
    let body = '';
    for (; i < text.length && depth > 0; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth === 1 && ch !== '}') body += ch;
      else if (depth === 0) break;
    }
    re.lastIndex = i + 1;
    // body holds the top-level text plus the names of nested blocks (e.g. "@top-left"); keep
    // only declarations
    const declarations = [];
    for (const part of body.split(';')) {
      const colon = part.indexOf(':');
      if (colon === -1) continue;
      const prop = part.slice(0, colon).trim().toLowerCase().split(/\s+/).pop();
      const value = part.slice(colon + 1).replace(/!important/i, '').trim();
      if (/^(size|margin|margin-(top|right|bottom|left))$/.test(prop)) {
        declarations.push([prop, value]);
      }
    }
    rules.push({ prelude: match[1].trim(), declarations });
  }
  return rules;
}

function applyDeclarations(page, declarations, unreadable) {
  for (const [prop, value] of declarations) {
    const words = value.split(/\s+/).filter(Boolean);
    if (prop === 'size') {
      let size = null;
      let orientation = null;
      const lengths = [];
      let ok = true;
      for (const word of words) {
        const w = word.toLowerCase();
        if (PAGE_SIZES[w]) size = PAGE_SIZES[w];
        else if (w === 'landscape' || w === 'portrait') orientation = w;
        else if (w === 'auto') continue;
        else {
          const mm = lengthToMm(w);
          if (mm === null) ok = false;
          else lengths.push(mm);
        }
      }
      if (!ok || lengths.length > 2 || (lengths.length && size)) {
        unreadable.push(`size: ${value}`);
        continue;
      }
      let [width, height] = size || (lengths.length === 2 ? lengths : lengths.length === 1 ? [lengths[0], lengths[0]] : [page.width, page.height]);
      if (orientation === 'landscape' && width < height) [width, height] = [height, width];
      if (orientation === 'portrait' && width > height) [width, height] = [height, width];
      page.width = width;
      page.height = height;
      continue;
    }
    if (prop === 'margin') {
      const mm = words.map(lengthToMm);
      if (!words.length || words.length > 4 || mm.some((v) => v === null)) {
        unreadable.push(`margin: ${value}`);
        continue;
      }
      const [top, right = top, bottom = top, left = right] = mm;
      page.margins = { top, right, bottom, left };
      continue;
    }
    const side = prop.slice('margin-'.length);
    const mm = words.length === 1 ? lengthToMm(words[0]) : null;
    if (mm === null) {
      unreadable.push(`${prop}: ${value}`);
      continue;
    }
    page.margins = { ...page.margins, [side]: mm };
  }
}

const clone = (page) => ({ width: page.width, height: page.height, margins: { ...page.margins } });

/**
 * Read the page size and margins from CSS.
 * @param {string} css - the stylesheets, in cascade order
 * @param {{ name?: string, fallback?: {width:number,height:number,margins:object} }} [options]
 *   `name`: a named page (LAYOUT) instead of the default page; `fallback`: the starting page
 * @returns {{ width: number, height: number, margins: { top: number, right: number, bottom: number, left: number },
 *   found: boolean, unreadable: string[] }} `found`: an applicable @page rule set size or a margin
 */
export function pageGeometry(css, options = {}) {
  const page = clone(options.fallback || FALLBACK_PAGE);
  const unreadable = [];
  let found = false;
  const rules = pageRules(css || '');
  const name = options.name ? options.name.toLowerCase() : null;

  // The unnamed page first, then the named one on top of it
  for (const pass of name ? [null, name] : [null]) {
    for (const rule of rules) {
      const prelude = rule.prelude.toLowerCase();
      const ruleName = prelude.split(':')[0].trim() || null;
      const pseudo = prelude.includes(':');
      if (pseudo || ruleName !== pass) continue;
      if (rule.declarations.length) found = true;
      applyDeclarations(page, rule.declarations, unreadable);
    }
  }
  return { ...page, found, unreadable };
}

/**
 * The names of the named pages in the CSS (`@page landscape { … }` → 'landscape').
 * @returns {string[]}
 */
export function namedPages(css) {
  const names = new Set();
  for (const rule of pageRules(css || '')) {
    const name = rule.prelude.split(':')[0].trim();
    if (name && !rule.prelude.includes(':')) names.add(name);
  }
  return [...names];
}

/** true when the CSS has an unnamed, pseudo-less `@page` rule (one that sets the default page). */
export function hasPageRule(css) {
  return pageRules(css || '').some((rule) => rule.prelude === '');
}
