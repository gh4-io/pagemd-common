/**
 * The text rules of `!!!include(path)!!!` (phase C12, pagemd-editor plan C12): what happens to an included
 * file's text before it is spliced into the including document, so that it behaves like part of that document.
 *
 * Pure and browser-safe (no file access, no Node built-ins): pagemd's parser reads the files and does the
 * recursion (`packages/parser/src/include.js`); pagemd-editor's canvas (P22) can reuse the same rules.
 *
 *   rule                      what it does
 *   which lines count         only a line that is just the include, outside code: the same rule as editor mode
 *                             (`include.js`), found with the dialect's own reader. Elsewhere (mid-line, in a code
 *                             block or inline code) the text stays as written; `analyzeIncludes` lists it as `notAlone`.
 *   frontmatter               an included file's leading `---` block is removed and never read (`splitFrontmatter`):
 *                             only the main file's settings count.
 *   image paths               every image reference of an included file is rewritten so it is found from the main
 *                             file's folder (`rebaseImageRefs`): the five forms of `listImageRefs`, never inside code.
 *                             URLs, `//…`, `data:`, absolute and root-relative paths and empty values are left alone.
 *   page type                 `pageTypeAt` / `pageTypeAtEnd` read the active `<!-- ::LAYOUT(name) -->` (fenced code
 *                             ignored), so the expander can restore the page type after an include (`layoutRestore`).
 *   missing / circular        `includeErrorBlock` is the visible block written in place of the include.
 */

import { createDialect } from '../index.js';
import { listImageRefs } from '../media/image-refs.js';
import { itemOccurrences } from '../shared/occurrences.js';

/** markdown-it-include's own pattern (braces required): an include anywhere in a line */
export const INCLUDE_ANYWHERE = /!{3}\s*include(.+?)!{3}/i;
const INCLUDE_ANYWHERE_G = /!{3}\s*include(.+?)!{3}/gi;
const BRACES = /\((.+?)\)/;

/** One editor-mode dialect for reading (created on first use; the dialect has no per-document state between parses) */
let reader = null;
const parse = (text) => {
  if (!reader) reader = createDialect({ mode: 'editor' });
  return reader.parse(text, {});
};

/**
 * The text split into lines, each with its own line ending (\r\n, \r or \n, as markdown-it counts lines)
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
  const out = text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g);
  return out || [];
}

/**
 * Remove an included file's frontmatter. The delimiters are gray-matter's, as pagemd's own `extractFrontmatter`
 * reads the main file: the text starts with `---` (not `----`) and ends at the next line starting with `---`;
 * without one, the whole rest is frontmatter. A leading byte order mark is removed too. The YAML is never read,
 * so broken YAML in an included file does not stop a build.
 * @param {string} text - The included file's text
 * @returns {{ body: string, frontmatter: boolean }}
 */
export function splitFrontmatter(text) {
  const str = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!str.startsWith('---') || str[3] === '-') return { body: str, frontmatter: false };
  const close = str.indexOf('\n---', 3);
  if (close === -1) return { body: '', frontmatter: true };
  let body = str.slice(close + 4);
  // gray-matter: the rest of the closing line is dropped up to its line ending
  const eol = body.search(/\r?\n|$/);
  body = body.slice(eol);
  if (body[0] === '\r') body = body.slice(1);
  if (body[0] === '\n') body = body.slice(1);
  return { body, frontmatter: true };
}

/**
 * A path the rebase leaves alone: a URL or any scheme (`https:`, `data:`, `C:` …), `//host`, an absolute or
 * root-relative path, an anchor, or nothing.
 * @param {string} src
 * @returns {boolean}
 */
export function isFixedRef(src) {
  const s = String(src ?? '').trim();
  return !s || /^[a-z][a-z0-9+.-]*:/i.test(s) || /^[\\/]/.test(s) || s.startsWith('#');
}

/**
 * `fromDir/src`, with `.` and `..` resolved, '/'-separated; a fixed reference (see isFixedRef) is returned unchanged
 * @param {string} src - The path as written
 * @param {string} fromDir - The included file's folder, relative to the main file's folder ('' = the same folder)
 * @returns {string}
 */
export function rebasePath(src, fromDir) {
  if (!fromDir || isFixedRef(src)) return src;
  const out = [];
  for (const part of `${fromDir}/${src}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && out.length && out[out.length - 1] !== '..') out.pop();
    else out.push(part);
  }
  const joined = out.join('/');
  return src.endsWith('/') ? `${joined}/` : joined;
}

/**
 * What the reader makes of a written path, to match a place in the text with a reference it listed
 * (backslash escapes removed, percent-encoding decoded)
 * @param {string} s
 * @returns {string}
 */
function readAs(s) {
  const unescaped = s.trim().replace(/\\([!-/:-@[-`{-~])/g, '$1');
  try {
    return decodeURI(unescaped);
  } catch {
    return unescaped;
  }
}

/**
 * The text of the given lines with inline code spans blanked (same length), so a path shown in `code` is never
 * taken for an image
 * @param {string} s
 * @returns {string}
 */
function maskCode(s) {
  return s.replace(/(`+)[\s\S]*?\1/g, (m) => ' '.repeat(m.length));
}

/** Where each form writes its path: the group `p` is the path as written */
const FORM_PATTERNS = {
  image: /!\[(?:\\.|[^\]\\])*\]\(\s*(?:<(?<a>[^>\r\n]*)>|(?<p>[^\s)<>]+))/dg,
  figure: /<!--\s*::FIGURE\b[^\r\n]*?(?<![\w-])src=(?:"(?<p>[^"]+)"|'(?<q>[^']+)'|(?<r>[^\s"'>]+))/dg,
  html: /<img\b[^>]*?\ssrc\s*=\s*(?:"(?<p>[^"]*)"|'(?<q>[^']*)'|(?<r>[^\s>]+))/dgi,
  annotated: /^[ \t]*:{3}[ ]*annotated-image[ ]+(?<p>.+?)[ \t]*$/dgm,
  embed: /!\[\[(?<p>[^\]|]+?)\s*(?:\|[^\]]*)?\]\]/dg
};

/** Which pattern finds each form (the legacy FIGURE form is an image on the line after the comment: `image`) */
const PATTERN_FOR = { image: 'image', figure: 'figure', html: 'html', annotated: 'annotated', embed: 'embed' };

/**
 * Characters a path cannot hold unescaped in a markdown link destination
 * @param {string} prefix
 * @returns {string}
 */
function encodeForLink(prefix) {
  return prefix.replace(/[ ()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The line range of every token: its own map, or that of the nearest enclosing block that has one
 * @param {object[]} tokens
 * @returns {([number, number]|null)[]}
 */
function tokenRanges(tokens) {
  const stack = [];
  return tokens.map((t) => {
    const range = t.map || stack[stack.length - 1] || null;
    if (t.nesting === 1) stack.push(range);
    else if (t.nesting === -1) stack.pop();
    return range;
  });
}

/**
 * Read an (included) file's text once for the include rules
 * @param {string} text - Markdown (no frontmatter)
 * @returns {{
 *   includes: { line: number, path: string, start: number, end: number }[],
 *   layouts: { line: number, name: string }[],
 *   images: { form: string, src: string, line: number, endLine: number }[],
 *   notAlone: { line: number, text: string }[]
 * }} `includes`: the includes that count (start/end = the statement's place in its line); `layouts`: every
 *   LAYOUT outside code, in order; `images`: every image reference with the lines of its block; `notAlone`: text
 *   that looks like an include but is not one (mid-line, or in code)
 */
export function analyzeIncludes(text) {
  const tokens = parse(text);
  const ranges = tokenRanges(tokens);
  const lines = splitLines(text);
  const includes = [];
  const layouts = [];
  const images = [];

  tokens.forEach((t, i) => {
    if (t.type === 'pagemd_include' && t.map) {
      const line = t.map[0];
      const m = (lines[line] || '').match(INCLUDE_ANYWHERE);
      if (m) includes.push({ line, path: t.meta.path, start: m.index, end: m.index + m[0].length });
    }
    const range = ranges[i];
    if (range) {
      for (const ref of listImageRefs([t])) images.push({ form: ref.form, src: ref.src, line: range[0], endLine: range[1] });
    }
  });
  for (const o of itemOccurrences(tokens)) {
    if (o.item !== 'layout') continue;
    const range = ranges[o.index];
    const d = o.data;
    layouts.push({ line: range ? range[0] : 0, name: d.parenParams || d.attrs?.name || 'default' });
  }

  const counted = new Set(includes.map((inc) => inc.line));
  const notAlone = [];
  lines.forEach((s, line) => {
    if (counted.has(line)) return;
    for (const m of s.matchAll(INCLUDE_ANYWHERE_G)) {
      if (BRACES.test(m[1])) notAlone.push({ line, text: m[0] });
    }
  });
  return { includes, layouts, images, notAlone };
}

/**
 * Rewrite the image references of an included file so they are found from the main file's folder
 * @param {string} text - The included file's text (no frontmatter)
 * @param {string} fromDir - Its folder relative to the main file's folder, '/'-separated ('..' allowed; '' = same)
 * @param {ReturnType<typeof analyzeIncludes>} [analysis] - analyzeIncludes(text), when already made
 * @returns {string} The text with the paths changed; nothing else changes (not even a line ending)
 */
export function rebaseImageRefs(text, fromDir, analysis = analyzeIncludes(text)) {
  if (!fromDir) return text;
  const lines = splitLines(text);
  // Per block (line range) and form, the paths the reader listed there
  const blocks = new Map();
  for (const ref of analysis.images) {
    if (isFixedRef(ref.src)) continue;
    const key = `${ref.line}:${ref.endLine}:${PATTERN_FOR[ref.form]}`;
    if (!blocks.has(key)) blocks.set(key, { line: ref.line, endLine: ref.endLine, form: PATTERN_FOR[ref.form], srcs: new Set() });
    blocks.get(key).srcs.add(ref.src);
  }
  /** per line: [start, end, replacement] edits */
  const edits = new Map();
  for (const block of blocks.values()) {
    for (let line = block.line; line < block.endLine && line < lines.length; line++) {
      const masked = block.form === 'annotated' || block.form === 'figure' ? lines[line] : maskCode(lines[line]);
      const pattern = FORM_PATTERNS[block.form];
      pattern.lastIndex = 0;
      for (const m of masked.matchAll(pattern)) {
        const group = ['p', 'a', 'q', 'r'].find((g) => m.groups[g] !== undefined);
        if (!group) continue;
        const written = m.groups[group];
        const value = block.form === 'image' ? readAs(written) : written.trim();
        if (!block.srcs.has(value) || isFixedRef(value)) continue;
        const [start, end] = m.indices.groups[group];
        // Keep spaces around the written path; change only the path
        const lead = written.length - written.trimStart().length;
        const core = written.trim();
        const rebased = rebasePath(core, fromDir);
        // A folder name with a space must not break the syntax: encoded in a plain link destination, quoted in
        // an unquoted attribute (the author's own part of the path is kept as written)
        let replacement = rebased;
        if (block.form === 'image' && group === 'p') replacement = encodeForLink(rebased);
        else if (group === 'r' && /\s/.test(rebased)) replacement = `"${rebased}"`;
        if (!edits.has(line)) edits.set(line, []);
        edits.get(line).push([start + lead, start + lead + core.length, replacement]);
      }
    }
  }
  for (const [line, list] of edits) {
    const seen = new Set();
    let s = lines[line];
    for (const [start, end, replacement] of list.sort((a, b) => b[0] - a[0])) {
      if (seen.has(start)) continue;
      seen.add(start);
      s = s.slice(0, start) + replacement + s.slice(end);
    }
    lines[line] = s;
  }
  return lines.join('');
}

/**
 * The page type in force just before a line
 * @param {ReturnType<typeof analyzeIncludes>} analysis
 * @param {number} line - 0-based
 * @param {string|null} entering - The page type in force where the text starts (null = the document's own page)
 * @returns {string|null}
 */
export function pageTypeAt(analysis, line, entering = null) {
  let type = entering;
  for (const l of analysis.layouts) {
    if (l.line >= line) break;
    type = l.name;
  }
  return type;
}

/**
 * The page type in force at the end of a text
 * @param {ReturnType<typeof analyzeIncludes>} analysis
 * @param {string|null} entering
 * @returns {string|null}
 */
export function pageTypeAtEnd(analysis, entering = null) {
  return pageTypeAt(analysis, Infinity, entering);
}

/**
 * The directive that brings back the page type in force before an include, or '' when the include ends on it.
 * The document's own page (null) and `default` count as the same (a `LAYOUT(default)` is how a text returns to it).
 * @param {string|null} before - The page type before the include
 * @param {string|null} after - The page type at the end of the included text
 * @returns {string}
 */
export function layoutRestore(before, after) {
  const same = (before ?? 'default') === (after ?? 'default');
  return same ? '' : `<!-- ::LAYOUT(${before ?? 'default'}) -->`;
}

/**
 * The visible block written in place of an include that cannot be expanded. Inline styles, so no stylesheet
 * changes; the path is the one the author wrote.
 * @param {'not-found'|'circular'} kind
 * @param {string} path - As written
 * @returns {string} One line of HTML
 */
export function includeErrorBlock(kind, path) {
  const esc = String(path).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const what = kind === 'circular' ? 'Include goes round in a circle' : 'Include not found';
  return `<div class="include-error" role="note" style="border:1px dashed #b00;color:#b00;padding:.4em">${what}: ${esc}</div>`;
}
