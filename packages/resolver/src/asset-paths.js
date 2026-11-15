/**
 * Pictures and other files named inside a profile's template, layout or stylesheet (pagemd-editor FIX-template-asset-paths,
 * R-259, OQ-80).
 *
 * A browser reads a relative path in a web page from the page's folder, and a `url()` in a stylesheet from the stylesheet's
 * folder. pagemd puts the template and the profile's CSS into the document's page, so before this every relative path in them
 * was read from the **document's** folder: a logo next to a shared profile was never found. The rule now:
 *
 *   a relative path inside a template, layout or stylesheet starts from the folder of that file;
 *   1. the file is there → the path is rewritten, relative to the document's folder (portable HTML, like C12's includes);
 *   2. else → the path is left as written (read from the document's folder, as before: `.pagemd/assets/…` templates keep working);
 *   neither place has it → the path is left as written and reported `missing` (@pagemd/validate warns: template-asset-missing).
 *
 * Never changed: a leading `/` (the project root, PD16), anything with a scheme (`http:`, `https:`, `data:`, `file:`, `C:`),
 * `//…`, `#…`, and paths with a `{{token}}` or `${token}`. The page is read with a small HTML reader (tags, attributes,
 * comments, raw-text elements), not one pattern over the whole text: only `src`, `srcset`, `poster`, `<link href>` (and
 * SVG `<image>`/`<use>` `href`), `style="…url()…"` and `<style>` `url()` are touched; comments, `<script>`, `<textarea>` and
 * everything inside `<pre>` or `<code>` are left alone. In CSS, comments and strings outside `url()` are left alone.
 *
 * Runs anywhere: the file checks go through the ports (`yield fsOp.stat(path)`), like every lookup here.
 */

import { fsOp } from './ports.js';
import { pathOf } from './path.js';

/** Elements whose content is text, never markup (the HTML standard's raw-text and escapable raw-text elements). */
const RAW_TEXT = new Set(['script', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
/** Elements whose content is shown as code: nothing inside them is rewritten. */
const CODE = new Set(['pre', 'code']);
/** Elements whose `href` names a file the page loads (not a link the reader follows). */
const HREF_LOADS = new Set(['link', 'image', 'use']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/**
 * @typedef {object} AssetRef
 * @property {number} start - offset of the path in the text
 * @property {number} end
 * @property {string} value - the path as written (HTML character references not yet decoded)
 * @property {'src'|'srcset'|'poster'|'href'|'style'|'css'} where
 */

/** The `url(…)` paths in CSS text, skipping comments and strings outside `url()`. `offset` is added to every position. */
export function scanCss(text, offset = 0, where = 'css') {
  const refs = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? n : close + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = endOfString(text, i);
      continue;
    }
    if ((c === 'u' || c === 'U') && /^url\(/i.test(text.slice(i, i + 4)) && !/[\w-]/.test(text[i - 1] ?? '')) {
      let j = i + 4;
      while (j < n && /\s/.test(text[j])) j++;
      let start;
      let end;
      if (text[j] === '"' || text[j] === "'") {
        start = j + 1;
        end = endOfString(text, j) - 1;
      } else if (text.startsWith('&quot;', j)) {
        start = j + 6;
        const close = text.indexOf('&quot;', start);
        end = close === -1 ? n : close;
      } else {
        start = j;
        end = j;
        while (end < n && text[end] !== ')' && !/\s/.test(text[end])) end++;
      }
      if (end > start) refs.push({ start: start + offset, end: end + offset, value: text.slice(start, end), where });
      const close = text.indexOf(')', Math.max(end, j));
      i = close === -1 ? n : close + 1;
      continue;
    }
    i++;
  }
  return refs;
}

/** The index just after the string that starts at `i` (a quote), backslash escapes allowed. */
function endOfString(text, i) {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length && text[j] !== quote && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
  return Math.min(j + 1, text.length);
}

/** The paths a template names (see the file header), in text order. */
export function scanHtml(text) {
  const refs = [];
  const n = text.length;
  let code = 0;
  let i = 0;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;
    i = lt;
    if (text.startsWith('<!--', i)) {
      const close = text.indexOf('-->', i + 4);
      i = close === -1 ? n : close + 3;
      continue;
    }
    if (text[i + 1] === '!' || text[i + 1] === '?') {
      const close = text.indexOf('>', i + 2);
      i = close === -1 ? n : close + 1;
      continue;
    }
    const closing = text[i + 1] === '/';
    const nameStart = i + (closing ? 2 : 1);
    if (!/[A-Za-z]/.test(text[nameStart] ?? '')) {
      i++;
      continue;
    }
    let j = nameStart;
    while (j < n && !/[\s/>]/.test(text[j])) j++;
    const name = text.slice(nameStart, j).toLowerCase();
    const tag = readAttributes(text, j);
    i = tag.end;
    if (closing) {
      if (CODE.has(name) && code > 0) code--;
      continue;
    }
    if (code === 0) {
      for (const attr of tag.attributes) {
        if (attr.valueStart === null) continue;
        const value = text.slice(attr.valueStart, attr.valueEnd);
        if (attr.name === 'src' || attr.name === 'poster') refs.push({ start: attr.valueStart, end: attr.valueEnd, value, where: attr.name });
        else if (attr.name === 'srcset') refs.push(...srcsetRefs(value, attr.valueStart));
        else if ((attr.name === 'href' || attr.name === 'xlink:href') && HREF_LOADS.has(name)) refs.push({ start: attr.valueStart, end: attr.valueEnd, value, where: 'href' });
        else if (attr.name === 'style') refs.push(...scanCss(value, attr.valueStart, 'style'));
      }
    }
    if (tag.selfClosing || VOID.has(name)) continue;
    if (CODE.has(name)) {
      code++;
      continue;
    }
    if (name === 'style' || RAW_TEXT.has(name)) {
      const close = indexOfCloseTag(text, name, i);
      if (name === 'style' && code === 0) refs.push(...scanCss(text.slice(i, close), i, 'css'));
      i = close;
    }
  }
  return refs;
}

/** Where `</name` starts at or after `from` (any case); the end of the text when there is none. */
function indexOfCloseTag(text, name, from) {
  const re = new RegExp(`</${name}[\\s/>]`, 'ig');
  re.lastIndex = from;
  const m = re.exec(text);
  return m ? m.index : text.length;
}

/** A start tag's attributes from `i` (just after its name) to its `>`. */
function readAttributes(text, i) {
  const n = text.length;
  const attributes = [];
  let selfClosing = false;
  while (i < n) {
    while (i < n && /\s/.test(text[i])) i++;
    if (i >= n) break;
    if (text[i] === '>') {
      i++;
      break;
    }
    if (text[i] === '/') {
      selfClosing = text[i + 1] === '>';
      i++;
      continue;
    }
    const nameStart = i;
    while (i < n && !/[\s=>]/.test(text[i]) && !(text[i] === '/' && text[i + 1] === '>')) i++;
    const name = text.slice(nameStart, i).toLowerCase();
    while (i < n && /\s/.test(text[i])) i++;
    if (text[i] !== '=') {
      attributes.push({ name, valueStart: null, valueEnd: null });
      continue;
    }
    i++;
    while (i < n && /\s/.test(text[i])) i++;
    if (text[i] === '"' || text[i] === "'") {
      const quote = text[i];
      const close = text.indexOf(quote, i + 1);
      const end = close === -1 ? n : close;
      attributes.push({ name, valueStart: i + 1, valueEnd: end });
      i = end + 1;
    } else {
      const start = i;
      while (i < n && !/[\s>]/.test(text[i])) i++;
      attributes.push({ name, valueStart: start, valueEnd: i });
    }
  }
  return { attributes, selfClosing, end: Math.min(i, n) };
}

/** The URLs of a `srcset` (each candidate: a URL, then optional descriptors, comma separated). */
function srcsetRefs(value, offset) {
  const refs = [];
  let i = 0;
  while (i < value.length) {
    while (i < value.length && /[\s,]/.test(value[i])) i++;
    const start = i;
    while (i < value.length && !/\s/.test(value[i])) i++;
    let end = i;
    // A URL may end in commas that separate it from the next candidate (no descriptor)
    while (end > start && value[end - 1] === ',') end--;
    if (end > start) refs.push({ start: start + offset, end: end + offset, value: value.slice(start, end), where: 'srcset' });
    while (i < value.length && value[i] !== ',') i++;
  }
  return refs;
}

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };

/** HTML character references in an attribute value, decoded (the common named ones and every numeric one). */
function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[ref.toLowerCase()] ?? match;
  });
}

/**
 * The file part of a path as written, or null when it is never rebased (see the file header).
 * @returns {{ file: string, suffix: string } | null} `file` decoded (`%20` → space), `suffix` the `?query` / `#fragment` as written
 */
export function relativeAssetPath(written) {
  const value = String(written ?? '').trim();
  if (value === '' || value.startsWith('#') || value.startsWith('/') || value.startsWith('\\')) return null;
  if (value.includes('{{') || value.includes('${')) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return null; // a scheme (http:, data:, file:, mailto:) or a drive letter (C:)
  const cut = value.search(/[?#]/);
  const raw = cut === -1 ? value : value.slice(0, cut);
  const suffix = cut === -1 ? '' : value.slice(cut);
  if (raw === '' || raw === '.' || raw === './') return null;
  let file = raw.replace(/\\/g, '/');
  try {
    file = decodeURIComponent(file);
  } catch {
    // a lone % stays as written
  }
  return { file, suffix };
}

/** A path segment as a URL segment: spaces and the characters a URL or a CSS `url()` would misread are percent-encoded. */
const encodeSegment = (segment) => (segment === '..' || segment === '.' ? segment : encodeURIComponent(segment).replace(/[()'*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`));

/**
 * The path a document in `documentDir` writes to reach `target`: relative, `/`-separated and URL-encoded; a `file:///` URL when
 * there is no relative path (another Windows drive).
 */
export function documentRelativeUrl(documentDir, target, P) {
  const rel = P.relative(documentDir, target);
  if (P.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) {
    const slashed = target.replace(/\\/g, '/');
    const drive = /^[A-Za-z]:/.exec(slashed)?.[0] ?? '';
    const rest = slashed.slice(drive.length).split('/').map((s) => (s === '' ? s : encodeSegment(s))).join('/');
    return `file://${drive ? '/' : ''}${drive}${rest}`;
  }
  return rel.replace(/\\/g, '/').split('/').map(encodeSegment).join('/');
}

/**
 * @typedef {object} TemplateAsset
 * @property {string} written - the path as written in the file
 * @property {'file'|'document'|'missing'} outcome - found next to the file, found from the document's folder (left as written), or not found
 * @property {string|null} path - the file found (absolute), null when missing
 * @property {string[]} tried - the places looked in, in order (absolute)
 * @property {string|null} rewritten - the new text written in place of `written`, null when it was left as written
 * @property {AssetRef['where']} where
 */

/**
 * Rebase the relative paths in a template's or stylesheet's text (see the file header).
 * @param {string} text - the file's text as read (a template: before its `{{tokens}}` are filled, so the document's own HTML is never touched)
 * @param {object} options
 * @param {'html'|'css'} [options.kind] - 'html' for a template, 'css' for a stylesheet
 * @param {string} options.fileDir - the folder of the template or stylesheet
 * @param {string|null} options.documentDir - the document's folder (null: nothing is rebased or reported)
 * @param {boolean} [options.rewrite] - false: only report, change nothing (the reversal switch of R-259)
 * @param {import('./ports.js').Ports} [ports]
 * @returns {Generator<object, { text: string, assets: TemplateAsset[] }>}
 */
export function* rebaseAssetPathsGen(text, options = {}, ports = {}) {
  const source = String(text ?? '');
  const { kind = 'html', fileDir, documentDir, rewrite = true } = options;
  if (!fileDir || !documentDir) return { text: source, assets: [] };
  const P = pathOf(ports.env);
  const refs = kind === 'css' ? scanCss(source) : scanHtml(source);
  const known = new Map();
  const isFile = function* (path) {
    if (known.has(path)) return known.get(path);
    let found = false;
    try {
      const stat = yield fsOp.stat(path);
      found = Boolean(stat && stat.isFile);
    } catch {
      try {
        found = Boolean(yield fsOp.exists(path));
      } catch {
        found = false;
      }
    }
    known.set(path, found);
    return found;
  };

  const assets = [];
  let out = '';
  let last = 0;
  for (const ref of refs) {
    const parsed = relativeAssetPath(ref.where === 'css' ? ref.value : decodeEntities(ref.value));
    if (!parsed) continue;
    const fromFile = P.resolve(fileDir, parsed.file);
    const fromDocument = P.resolve(documentDir, parsed.file);
    const tried = fromFile === fromDocument ? [fromFile] : [fromFile, fromDocument];
    let asset;
    if (yield* isFile(fromFile)) {
      const url = fromFile === fromDocument ? null : `${documentRelativeUrl(documentDir, fromFile, P)}${parsed.suffix}`;
      asset = { written: ref.value, outcome: 'file', path: fromFile, tried, rewritten: rewrite ? url : null, where: ref.where };
    } else if (fromFile !== fromDocument && (yield* isFile(fromDocument))) {
      asset = { written: ref.value, outcome: 'document', path: fromDocument, tried, rewritten: null, where: ref.where };
    } else {
      asset = { written: ref.value, outcome: 'missing', path: null, tried, rewritten: null, where: ref.where };
    }
    assets.push(asset);
    if (asset.rewritten !== null) {
      out += source.slice(last, ref.start) + asset.rewritten;
      last = ref.end;
    }
  }
  return { text: last === 0 ? source : out + source.slice(last), assets };
}
