/**
 * Level `syntax`: the document's pagemd items (ADR-0017; image-editor inventory B3, B4, PD7, PD11).
 * - a directive pagemd doesn't know (`<!-- ::BREAK -->`) → warning (pagemd leaves it as a hidden comment)
 * - `!!!include(path)!!!` naming a file that isn't there (from the document's folder, R-52) → error; since C12 the
 *   included files are read too (each once): a missing nested include → error, an include that comes back to a file
 *   that is already being included (`include-circular`) → error, an included file's frontmatter (ignored) → info, an
 *   included text that ends on another page type than the one before it (pagemd brings that one back) → warning,
 *   and text that looks like an include but is not on a line of its own or is inside code (not expanded) → info.
 *   Nested problems are reported on the main file's line of the include they come through.
 * - FIGURE: a setting it doesn't have, a `height` that isn't a CSS length, a `width` that is neither a name
 *   (full, half, third, quarter) nor a length, `crop-x`/`crop-y` outside 0–100, a `crop-fit` it doesn't know → warning
 *   (pagemd ignores the value); a FIGURE comment over several lines → warning (it is only read on one line)
 * - an annotated image whose YAML can't be read → warning (the figure comes out empty)
 * - picture keys (pagemd-editor C13, R-249 to R-251), on a FIGURE and an annotated image: `crop-x`/`crop-y` that are neither a
 *   % of 0–100 nor a CSS length, `pos-x`/`pos-y` that are not a CSS length (`picture-crop`), `rotate` not 0/90/180/270
 *   (`picture-rotate`), `flip` not h/v/hv (`picture-flip`) → warning (pagemd ignores the value); a marker `size` that is not a
 *   number or is outside 0.5–4 (`marker-size`) → warning (1 is used, or the nearest limit); shapes wholly in the part a % crop
 *   cuts away (`annotation-hidden-by-crop`) → info (they stay in the YAML, hidden); redaction (provisional, OQ-61): `redact`
 *   that is not a list of rectangles (`redact-rect`) → error, a rectangle reaching past the picture's edge → warning (cut at
 *   the edge), a redacted picture from a web address (`redact-url`) or one pagemd can't read or bake (`redact-unreadable`) →
 *   error (the build stops rather than show it)
 * - a table's `data-col-widths` (or its `<!-- ::TABLE widths="…" -->` comment) with a value pagemd doesn't accept, or
 *   widths adding up to more than 100 % → warning (pagemd-editor P19: such a value counts as "not set"); a TABLE comment
 *   that is not right under a table → warning (it does nothing)
 * - footnotes (pagemd-editor P26): a reference `[^x]` with no note → info (pagemd prints it as text); a note nothing refers
 *   to → info (pagemd leaves it out); two notes with one label → warning (pagemd prints the last one)
 */

import {
  COLUMN_WIDTHS_ATTR, FLIPS, MARKER_SIZE, ROTATIONS, analyzeIncludes, columnWidthProblems, itemOccurrences, items, layoutRestore,
  loadAnnotationYaml, pageTypeAt, pageTypeAtEnd, parseCropValue, parsePosValue, readRedactions, shapesHiddenByCrop, splitFrontmatter
} from '@pagemd/syntax';
import { diagnostic } from '../diagnostic.js';
import { bodyText } from '../document.js';

/** How deep included files are followed (a circle is caught before; this only bounds a very long chain) */
const MAX_INCLUDE_DEPTH = 32;

const FIGURE = items.find((i) => i.id === 'figure');
const FIGURE_KEYS = new Set(FIGURE.params.map((p) => p.key));
const CROP_FITS = FIGURE.params.find((p) => p.key === 'crop-fit').values;
const CSS_LENGTH = /^-?0(\.0*)?$|^(-?\d+\.?\d*)(px|em|rem|vh|vw|%)$|^auto$/i; // figure.js validateCSSLength
const WIDTH = /^(full|half|third|quarter|auto)$|^-?\d*\.?\d+(px|em|rem|vh|vw|%|mm|cm|in|pt|pc|ch|ex)$/i;

function figureProblems(attrs) {
  const problems = [];
  for (const key of Object.keys(attrs)) if (!FIGURE_KEYS.has(key)) problems.push(`it has no setting "${key}"`);
  if (attrs.height && !CSS_LENGTH.test(attrs.height.trim())) problems.push(`height="${attrs.height}" is not a CSS length (e.g. 300px, 50%, auto), so it is ignored`);
  if (attrs.width && !WIDTH.test(attrs.width.trim())) problems.push(`width="${attrs.width}" is neither full, half, third, quarter nor a CSS length`);
  if (attrs['crop-fit'] && !CROP_FITS.includes(attrs['crop-fit'])) problems.push(`crop-fit="${attrs['crop-fit']}" must be one of ${CROP_FITS.join(', ')}`);
  return problems;
}

/** The picture formats pagemd can redact (it bakes them in a browser) */
const REDACTABLE = /\.(png|jpe?g|webp|gif|svg)$/i;
const WEB_PICTURE = /^(https?:|\/\/|data:|blob:)/i;

/**
 * Problems with the picture keys a FIGURE (its parameters) or an annotated image (its options) carries (C13)
 * @param {string} what - "FIGURE" or "Annotated image <path>"
 * @param {object} keys - The parameters / options as written
 * @param {number} line
 * @returns {import('../diagnostic.js').Diagnostic[]}
 */
function pictureKeyProblems(what, keys, line) {
  const out = [];
  for (const key of ['crop-x', 'crop-y']) {
    if (keys[key] === undefined || keys[key] === null) continue;
    if (!parseCropValue(keys[key])) {
      out.push(diagnostic('warning', 'syntax', 'picture-crop', `${what}: ${key}="${keys[key]}" must be a % of the picture from 0 to 100 or a CSS length (e.g. 300px, 12em), so it is ignored`, { line }));
    }
  }
  for (const key of ['pos-x', 'pos-y']) {
    if (keys[key] === undefined || keys[key] === null) continue;
    if (!parsePosValue(keys[key])) {
      out.push(diagnostic('warning', 'syntax', 'picture-crop', `${what}: ${key}="${keys[key]}" must be a CSS length or a % of the picture (e.g. -20%, 40px), so it is ignored`, { line }));
    }
  }
  if (keys.rotate !== undefined && keys.rotate !== null) {
    const n = typeof keys.rotate === 'number' ? keys.rotate : /^\s*\d+\s*$/.test(String(keys.rotate)) ? Number(keys.rotate) : NaN;
    if (!ROTATIONS.includes(n)) out.push(diagnostic('warning', 'syntax', 'picture-rotate', `${what}: rotate="${keys.rotate}" must be 0, 90, 180 or 270, so it is ignored`, { line }));
  }
  if (keys.flip !== undefined && keys.flip !== null && !FLIPS.includes(String(keys.flip).trim())) {
    out.push(diagnostic('warning', 'syntax', 'picture-flip', `${what}: flip="${keys.flip}" must be h, v or hv, so it is ignored`, { line }));
  }
  return out;
}

/**
 * Problems of an annotated image's markers, crop and redactions (C13)
 * @param {object} ctx - The check context
 * @param {{imagePath: string, data: object}} item
 * @param {number} line
 * @param {string|null} docDir
 * @param {object[]} out
 */
function* annotatedPictureProblems(ctx, item, line, docDir, out) {
  const { P } = ctx;
  const data = item.data || {};
  const what = `Annotated image ${item.imagePath ?? ''}`;
  out.push(...pictureKeyProblems(what, data.options || {}, line));
  (Array.isArray(data.markers) ? data.markers : []).forEach((m, i) => {
    if (!m || typeof m !== 'object' || m.size === undefined || m.size === null) return;
    if (typeof m.size !== 'number' || !Number.isFinite(m.size)) {
      out.push(diagnostic('warning', 'syntax', 'marker-size', `${what}: marker ${m.id ?? i + 1} has size "${m.size}", not a number, so 1 is used`, { line }));
    } else if (m.size < MARKER_SIZE.min || m.size > MARKER_SIZE.max) {
      out.push(diagnostic('warning', 'syntax', 'marker-size', `${what}: marker ${m.id ?? i + 1} has size ${m.size}, outside ${MARKER_SIZE.min}–${MARKER_SIZE.max}, so ${Math.min(Math.max(m.size, MARKER_SIZE.min), MARKER_SIZE.max)} is used`, { line }));
    }
  });
  const hidden = shapesHiddenByCrop(data);
  if (hidden && hidden.length) {
    out.push(diagnostic('info', 'syntax', 'annotation-hidden-by-crop', `${what}: ${hidden.length} shape(s) lie wholly in the part the crop cuts away, so they are hidden (they stay in the YAML): ${hidden.map((h) => `${h.list} ${h.index + 1}`).join(', ')}`, { line }));
  }

  // Redaction (provisional, OQ-61): pagemd bakes it or stops the build
  const { rects, error } = readRedactions(data.redact);
  if (error) {
    out.push(diagnostic('error', 'syntax', 'redact-rect', `${what}: ${error}; pagemd stops the build rather than show the picture`, { line }));
    return;
  }
  if (rects.length === 0) return;
  data.redact.forEach((r, i) => {
    if (r.x < 0 || r.y < 0 || r.x + r.width > 100 || r.y + r.height > 100) {
      out.push(diagnostic('warning', 'syntax', 'redact-rect', `${what}: redact entry ${i + 1} reaches past the picture's edge (x, y, width, height are % of the picture, 0–100); it is cut at the edge`, { line }));
    }
  });
  const src = String(item.imagePath ?? '');
  if (WEB_PICTURE.test(src)) {
    out.push(diagnostic('error', 'syntax', 'redact-url', `${what}: a picture from a web address can't be redacted (pagemd can only black out a file next to the document), so the build stops; save the picture locally`, { line }));
    return;
  }
  if (!REDACTABLE.test(src.split(/[?#]/)[0])) {
    out.push(diagnostic('error', 'syntax', 'redact-unreadable', `${what}: pagemd can only redact PNG, JPEG, WebP, GIF and SVG pictures, so the build stops`, { line }));
    return;
  }
  if (docDir) {
    let clean = src.split(/[?#]/)[0];
    try { clean = decodeURIComponent(clean); } catch { /* as written */ }
    // (a path starting with "/" starts at the project root for the build: left to the assets check)
    const target = P.resolve(docDir, clean);
    if (!clean.startsWith('/') && !(yield* ctx.exists(target))) {
      out.push(diagnostic('error', 'syntax', 'redact-unreadable', `${what}: the redacted picture isn't there (${target}), so the build stops`, { line }));
    }
  }
}

/**
 * The included files of one include (C12), read the way pagemd's expander reads them
 * @param {object} ctx - The check context
 * @param {object} at - { file (absolute), chain (paths as written, for messages), stack (absolute files being included),
 *   entering (page type before the include), line (main file's line) }
 * @param {object[]} out - Diagnostics are added here
 */
function* includedFile(ctx, at, out) {
  const { P } = ctx;
  const text = yield* ctx.read(at.file);
  if (text === null) return;
  const via = at.chain.join(' → ');
  const { body, frontmatter } = splitFrontmatter(text);
  if (frontmatter) {
    out.push(diagnostic('info', 'syntax', 'include-frontmatter', `Included file ${via}: its frontmatter is ignored (only the main file's settings count)`, { line: at.line }));
  }
  const analysis = analyzeIncludes(body);
  for (const n of analysis.notAlone) {
    out.push(diagnostic('info', 'syntax', 'include-not-alone', `In ${via}: ${n.text} is not on a line of its own (or is inside code), so it is not expanded: put it on its own line`, { line: at.line }));
  }
  const dir = P.dirname(at.file);
  for (const inc of analysis.includes) {
    const target = P.isAbsolute(inc.path) ? inc.path : P.resolve(dir, inc.path);
    const chain = [...at.chain, inc.path];
    if (!(yield* ctx.exists(target))) {
      out.push(diagnostic('error', 'syntax', 'include-not-found', `Included file not found: ${inc.path} (included by ${via}, resolved to ${target})`, { line: at.line }));
    } else if (at.stack.includes(target)) {
      out.push(diagnostic('error', 'syntax', 'include-circular', `Included file ${chain.join(' → ')} comes back to a file that is already being included, so pagemd prints a note instead`, { line: at.line }));
    } else if (at.stack.length < MAX_INCLUDE_DEPTH) {
      yield* includedFile(ctx, { file: target, chain, stack: [...at.stack, target], entering: pageTypeAt(analysis, inc.line, at.entering), line: at.line }, out);
    }
  }
  const restore = layoutRestore(at.entering, pageTypeAtEnd(analysis, at.entering));
  if (restore) {
    out.push(diagnostic('warning', 'syntax', 'include-layout-open', `Included file ${via} ends on another page type than the one before it: pagemd adds ${restore} after it, so the text after the include stays on its page type`, { line: at.line }));
  }
}

/** A `[^label]` written in text (markdown-it-footnote's label: no spaces) */
const FOOTNOTE_TEXT = /\[\^([^\]\s]+)\](?!:)/g;

/**
 * Footnote problems (P26), from the editor-mode tokens: notes stay where they are written, references carry their label
 * @param {object[]} tokens
 * @returns {import('../diagnostic.js').Diagnostic[]}
 */
function footnoteProblems(tokens) {
  const out = [];
  const notes = new Map();
  const referred = new Set();
  const unmatched = [];
  for (const t of tokens) {
    if (t.type === 'footnote_reference_open') {
      const label = t.meta?.label;
      const line = t.map?.[0];
      if (notes.has(label)) out.push(diagnostic('warning', 'syntax', 'footnote-duplicate', `Footnote [^${label}] is written twice: pagemd prints only the last one`, { line }));
      notes.set(label, line);
    }
    if (t.type !== 'inline' || !t.children) continue;
    for (const c of t.children) {
      if (c.type === 'footnote_ref' && c.meta?.label !== undefined) referred.add(c.meta.label);
      if (c.type !== 'text') continue;
      for (const m of c.content.matchAll(FOOTNOTE_TEXT)) unmatched.push({ label: m[1], line: t.map?.[0] });
    }
  }
  for (const u of unmatched) {
    if (!notes.has(u.label)) out.push(diagnostic('info', 'syntax', 'footnote-no-note', `Footnote [^${u.label}] has no note ([^${u.label}]: …), so pagemd prints it as text`, { line: u.line }));
  }
  for (const [label, line] of notes) {
    if (!referred.has(label)) out.push(diagnostic('info', 'syntax', 'footnote-unused', `Footnote note [^${label}] is not referred to anywhere, so pagemd leaves it out`, { line }));
  }
  return out;
}

/** @returns {Generator<object, import('../diagnostic.js').Diagnostic[]>} */
export default function* syntax(ctx) {
  const out = [];
  const { P } = ctx;
  const docDir = ctx.input.path ? P.dirname(ctx.input.path) : null;
  // The main file read by the include rules (lines counted in the whole file, as the tokens)
  const main = analyzeIncludes(bodyText(ctx.input.text));
  for (const n of main.notAlone) {
    out.push(diagnostic('info', 'syntax', 'include-not-alone', `${n.text} is not on a line of its own (or is inside code), so it is not expanded: put it on its own line`, { line: n.line }));
  }

  for (const o of itemOccurrences(ctx.tokens())) {
    const line = o.token.map?.[0];
    if (o.item === 'unknown-directive') {
      out.push(diagnostic('warning', 'syntax', 'unknown-directive', `Unknown directive ::${o.data.name}: pagemd doesn't know it and leaves it as a hidden comment`, { line }));
    } else if (o.item === 'include' && docDir && o.data.path) {
      const target = P.isAbsolute(o.data.path) ? o.data.path : P.resolve(docDir, o.data.path);
      if (!(yield* ctx.exists(target))) {
        out.push(diagnostic('error', 'syntax', 'include-not-found', `Included file not found: ${o.data.path} (resolved to ${target})`, { line }));
      } else {
        const self = ctx.input.path ? [P.resolve(ctx.input.path)] : [];
        yield* includedFile(ctx, { file: target, chain: [o.data.path], stack: [...self, target], entering: pageTypeAt(main, line ?? 0, null), line }, out);
      }
    } else if (o.item === 'figure' && !o.data.legacy) {
      for (const problem of figureProblems(o.data.attrs || {})) {
        out.push(diagnostic('warning', 'syntax', 'figure-setting', `FIGURE: ${problem}`, { line }));
      }
      out.push(...pictureKeyProblems('FIGURE', o.data.attrs || {}, line));
      // R-253: a comment with no src belongs to the picture line right above it (the readable style); with none there, it is an empty figure
      if (!(o.data.attrs || {}).src) out.push(diagnostic('warning', 'syntax', 'figure-orphan', 'FIGURE: no picture. Put it right under a picture line (no blank line between), or give it a src', { line }));
    } else if (o.item === 'annotated-image') {
      try {
        loadAnnotationYaml(o.data.content ?? '');
      } catch (error) {
        out.push(diagnostic('warning', 'syntax', 'annotation-yaml', `Annotated image ${o.data.imagePath ?? ''}: its YAML can't be read, so the figure comes out empty (${String(error?.message ?? error).split('\n')[0]})`, { line }));
        continue;
      }
      yield* annotatedPictureProblems(ctx, o.data, line, docDir, out);
    }
  }

  // A table's column widths (P19): values that count as "not set", in the {…} line or the <!-- ::TABLE --> comment
  for (const token of ctx.tokens()) {
    if (token.type === 'pagemd_directive' && token.meta?.name === 'TABLE') {
      // Not folded into a table (editor mode folds the one right under a table): it belongs to nothing.
      out.push(diagnostic('warning', 'syntax', 'table-directive-alone', 'TABLE comment: it is not right under a table, so it does nothing', { line: token.map?.[0] }));
      continue;
    }
    if (token.type !== 'table_open') continue;
    const values = [token.attrGet?.(COLUMN_WIDTHS_ATTR), token.meta?.tableDirective?.attrs?.widths].filter((v) => typeof v === 'string' && v.trim() !== 'equal');
    for (const value of values) {
      for (const problem of columnWidthProblems(value)) {
        out.push(diagnostic('warning', 'syntax', 'table-widths', `Table column widths: ${problem}`, { line: token.map?.[0] }));
      }
    }
  }

  out.push(...footnoteProblems(ctx.tokens()));

  // A FIGURE comment over several lines is not read (figure.js matches one line, PD11)
  const lines = ctx.input.text.split('\n');
  let inFence = false;
  lines.forEach((text, i) => {
    if (/^\s*(```|~~~)/.test(text)) inFence = !inFence;
    if (!inFence && /^\s*<!--\s*::FIGURE\b/.test(text) && !text.includes('-->')) {
      out.push(diagnostic('warning', 'syntax', 'figure-multiline', 'FIGURE must be written on one line: this one is not read as a figure', { line: i }));
    }
  });
  return out;
}
