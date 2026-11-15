/**
 * FIGURE write rule (phase C3, A8, A9).
 *
 * `<!-- ::FIGURE src="…" caption="…" … -->`, one line. Parameters whose value
 * did not change keep the author's text and order; changed ones are rewritten
 * in place; new ones follow the canonical order below. Crop values (crop-x,
 * crop-y, pos-x, pos-y, crop-fit) are written as given: turning a crop
 * rectangle in pixels into these values needs the image's size and belongs to
 * the image editor (P15).
 *
 * The legacy form (no `src`, the image on the next line) is kept as written:
 * `data.image` is that line.
 *
 * A new figure in the legacy style: `form: 'legacy'`, `attrs.src` set, no `image` (see writeNewLegacyFigure).
 *
 * The readable form (R-253, `data.form` 'after' when read, 'readable' when the editor makes a new one): the picture is
 * plain markdown, `![alt](src "caption")`, and a comment under it carries only what plain markdown cannot hold
 * (id, width, crop, rotate, flip, …): no such setting and no caption, no comment line. A caption in the comment
 * (`caption="…"`) wins over the title; if the author wrote it there, it stays there. `src` and `alt` are the
 * picture's own unless the author wrote them in the comment. A captioned picture keeps at least the bare
 * `<!-- ::FIGURE -->` marker, because without a FIGURE pagemd draws a plain picture (no "Figure N").
 *
 * Canonical example:
 *   writeFigure({ attrs: { src: 'shots/login.png', caption: 'The login page', width: 'half' } })
 *   → '<!-- ::FIGURE src="shots/login.png" caption="The login page" width="half" -->'
 */

import { writeParams, figureValue, markdownDestination, markdownTitle } from '../shared/write.js';

/** Canonical order for new parameters */
export const FIGURE_PARAM_ORDER = Object.freeze([
  'src', 'caption', 'id', 'alt', 'width', 'height',
  'crop-fit', 'crop-x', 'crop-y', 'pos-x', 'pos-y', 'rotate', 'flip', 'loading', 'link'
]);

/** One written FIGURE parameter (the reader's own pattern) */
const SEGMENT = /([\w-]+)=(?:"[^"]+"|'[^']+'|\S+)/;

/**
 * The FIGURE reader's attribute parser (same pattern as figure.js)
 * @param {string} raw - Parameters as written
 * @returns {Object<string, string>}
 */
function parseFigureParams(raw) {
  const attrs = {};
  const re = /([\w-]+)=(?:"([^"]+)"|'([^']+)'|(\S+))/g;
  let m;
  while ((m = re.exec(raw)) !== null) attrs[m[1]] = m[2] || m[3] || m[4];
  return attrs;
}

/**
 * Write a FIGURE back to markdown
 * @param {object} data - What the figure_open token carries in `meta`
 * @param {Object<string, *>} data.attrs - The parameters to write
 * @param {string} [data.raw] - The parameters as written
 * @param {boolean} [data.legacy] - Image on the next line
 * @param {string} [data.image] - That image line (legacy form)
 * @returns {string}
 */
export function writeFigure(data) {
  if (data.form === 'after' || data.form === 'readable') return writeReadableFigure(data);
  if (data.form === 'legacy' && data.attrs && data.attrs.src && !data.image) return writeNewLegacyFigure(data);
  const attrs = { ...(data.attrs || {}) };
  const legacy = !!data.legacy && !attrs.src && !!data.image;
  const params = writeParams({
    attrs,
    raw: data.raw || '',
    parse: parseFigureParams,
    segment: SEGMENT,
    quote: figureValue,
    order: FIGURE_PARAM_ORDER
  });
  const line = `<!-- ::FIGURE ${params} -->`;
  return legacy ? `${line}\n${data.image}` : line;
}

/** Alt text of a markdown image: `]` and `\` escaped, one line */
function markdownAlt(s) {
  return String(s ?? '').replace(/\s*[\r\n]+\s*/g, ' ').replace(/\\/g, '\\\\').replace(/([[\]])/g, '\\$1').trim();
}

/**
 * The readable form: the picture line, then the comment line only when it has something to say.
 * @param {object} data - As writeFigure's, plus `form` and `imageRead` ({ alt, src, title } as read)
 * @returns {string}
 */
function writeReadableFigure(data) {
  const attrs = { ...(data.attrs || {}) };
  const raw = data.raw || '';
  const written = raw ? parseFigureParams(raw) : {};
  const read = data.imageRead || null;
  // Keys the author wrote in the comment stay there; the rest of src, alt and caption belong to the picture line.
  const extras = {};
  for (const key of Object.keys(attrs)) {
    if ((key === 'src' || key === 'alt' || key === 'caption') && !(key in written)) continue;
    extras[key] = attrs[key];
  }
  const src = 'src' in written ? read?.src ?? '' : String(attrs.src ?? '');
  const alt = 'alt' in written ? read?.alt ?? '' : String(attrs.alt ?? '');
  const title = 'caption' in written ? read?.title ?? '' : String(attrs.caption ?? '');
  const caption = String(attrs.caption ?? '');
  const same = !!read && !!data.image && read.src === src && read.alt === alt && read.title === title;
  const image = same ? data.image : `![${markdownAlt(alt)}](${markdownDestination(src)}${title ? ` ${markdownTitle(title)}` : ''})`;
  const params = writeParams({
    attrs: extras,
    raw,
    parse: parseFigureParams,
    segment: SEGMENT,
    quote: figureValue,
    order: FIGURE_PARAM_ORDER
  });
  if (!params && !caption) return image;
  return `${image}\n<!-- ::FIGURE${params ? ` ${params}` : ''} -->`;
}

/**
 * A new figure in the older two-line style (the editor's `figureStyle` "legacy"): the comment, then the picture line.
 * With no setting to put in the comment, the comment could not be read back as a figure, so only the picture line is written.
 * @param {object} data - `attrs` holds the picture's `src` (and `alt`)
 * @returns {string}
 */
function writeNewLegacyFigure(data) {
  const { src, alt, ...rest } = data.attrs;
  const image = `![${markdownAlt(alt)}](${markdownDestination(src)})`;
  const params = writeParams({ attrs: rest, raw: '', parse: parseFigureParams, segment: SEGMENT, quote: figureValue, order: FIGURE_PARAM_ORDER });
  return params ? `<!-- ::FIGURE ${params} -->\n${image}` : image;
}
