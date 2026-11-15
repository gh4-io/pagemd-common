/**
 * Picture keys shared by FIGURE and the annotated image (pagemd-editor phase C13; decisions R-248 to R-251, ADR-0019).
 *
 * Crop, rotate and flip are keys in the markdown, drawn at render time; the picture file is never changed.
 *
 * - **Crop** (`crop-x`, `crop-y`: how much of the picture is shown; `pos-x`, `pos-y`: how far the picture is moved under it)
 *   accepts a percentage of the picture (a bare number or `N%`) or any CSS length (`px`, `em`, `rem`, `cm` …, or a `calc()`,
 *   which is escaped and left for the browser). It is drawn with a **window**: `.image-wrapper` / `.image-window` clips
 *   (`overflow: hidden`) a **frame** the size of the whole picture, shifted by `pos-*`. The shapes of an annotated image live in
 *   the frame, so they stay on the same picture points whatever the unit; the browser resolves every unit (`calc-size()` sizes
 *   the window from the picture, `cqw` caps the frame at the column). A FIGURE whose crop is in % only (and that is not turned
 *   or flipped) keeps its old `object-view-box` drawing, byte for byte.
 * - **Rotate** `0 | 90 | 180 | 270` (clockwise) and **flip** `h | v | hv` turn the picture as displayed; a flip is applied after
 *   the turn. 180° and flips are a CSS transform on the `<img>`. 90° and 270° need the picture's size to give the box its turned
 *   shape: the caller supplies it as `env.pictureSize(src)` (pagemd reads it with `readPictureSize`, below); without it the
 *   picture is turned in its unturned box.
 * - Shapes and redactions are % of the **displayed** (turned, flipped) picture. `displayedRectToNatural` maps a rectangle back
 *   to the picture file's own orientation (as a browser shows the file: after its EXIF turn).
 * - **Redaction** (provisional, OQ-61): see annotated-image.js and `listPictureEdits`.
 *
 * Browser-safe: no Node built-ins.
 */

/** The turns rotate accepts, clockwise */
export const ROTATIONS = Object.freeze([0, 90, 180, 270]);
/** The flips flip accepts */
export const FLIPS = Object.freeze(['h', 'v', 'hv']);
/** Marker size: a multiplier of the theme's badge size (R-250) */
export const MARKER_SIZE = Object.freeze({ default: 1, min: 0.5, max: 4 });

const NUMBER = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const UNITS = 'px|em|rem|vh|vw|vmin|vmax|cm|mm|in|pt|pc|ch|ex|q';
const PERCENT_RE = new RegExp(`^\\+?${NUMBER}%?$`);
const LENGTH_RE = new RegExp(`^\\+?${NUMBER}(?:${UNITS})$`, 'i');
const SIGNED_RE = new RegExp(`^[-+]?${NUMBER}(%|${UNITS})?$`, 'i');
// calc() with numbers, units, operators and brackets only: nothing that can end the declaration or the attribute
const CALC_RE = /^calc\([0-9a-z%.+\-*/ ()]+\)$/i;

/** Round to 6 decimals without float noise */
function round(n) {
  return Number(n.toFixed(6));
}

/**
 * A crop value (`crop-x`, `crop-y`): how much of the picture is shown.
 * @param {*} value - As written (a YAML number, or text)
 * @returns {{percent: number}|{length: string}|null} null: not a crop (ignored)
 */
export function parseCropValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 100 ? { percent: value } : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (PERCENT_RE.test(text)) {
    const n = parseFloat(text);
    return n >= 0 && n <= 100 ? { percent: n } : null;
  }
  if (LENGTH_RE.test(text) || CALC_RE.test(text)) return { length: text };
  return null;
}

/**
 * A shift value (`pos-x`, `pos-y`): how far the picture moves under the crop (negative: left / up).
 * A bare number is a percentage of the picture, as for the crop.
 * @param {*} value
 * @returns {string|null} The CSS length, or null (ignored)
 */
export function parsePosValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? `${value}%` : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const m = text.match(SIGNED_RE);
  if (m) return m[1] ? text : `${text}%`;
  return CALC_RE.test(text) ? text : null;
}

/**
 * @param {*} value - `rotate` as written
 * @returns {number} 0, 90, 180 or 270 (anything else: 0)
 */
export function normalizeRotate(value) {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : NaN;
  return ROTATIONS.includes(n) ? n : 0;
}

/**
 * @param {*} value - `flip` as written
 * @returns {''|'h'|'v'|'hv'}
 */
export function normalizeFlip(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return FLIPS.includes(text) ? text : '';
}

/**
 * A marker's size multiplier: 1 unless a number is given; clamped to 0.5–4
 * @param {*} value
 * @returns {number}
 */
export function markerScale(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return MARKER_SIZE.default;
  return Math.min(Math.max(value, MARKER_SIZE.min), MARKER_SIZE.max);
}

/**
 * The picture keys of a FIGURE (its parameters) or an annotated image (its `options`), read once.
 * @param {object} keys - { 'crop-x', 'crop-y', 'pos-x', 'pos-y', 'crop-fit', rotate, flip }
 * @returns {{cropX: object|null, cropY: object|null, posX: string|null, posY: string|null, rotate: number, flip: string,
 *   crop: boolean, percentOnly: boolean}}
 */
export function readPictureKeys(keys = {}) {
  const cropX = parseCropValue(keys['crop-x']);
  const cropY = parseCropValue(keys['crop-y']);
  const crop = !!(cropX || cropY);
  const posX = crop ? parsePosValue(keys['pos-x']) : null;
  const posY = crop ? parsePosValue(keys['pos-y']) : null;
  const percentOnly = (!cropX || 'percent' in cropX) && (!cropY || 'percent' in cropY);
  return { cropX, cropY, posX, posY, rotate: normalizeRotate(keys.rotate), flip: normalizeFlip(keys.flip), crop, percentOnly };
}

/** Escape a value for a double-quoted HTML attribute */
function attr(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The CSS transform that turns and flips the `<img>` in place (no 90°/270° box): '' when nothing to do.
 * A transform list applies right to left, so `scaleX(-1) rotate(180deg)` turns first, then flips the turned picture.
 * @param {number} rotate
 * @param {string} flip
 * @returns {string}
 */
export function pictureTransform(rotate, flip) {
  const parts = [];
  if (flip === 'h') parts.push('scaleX(-1)');
  else if (flip === 'v') parts.push('scaleY(-1)');
  else if (flip === 'hv') parts.push('scale(-1, -1)');
  if (rotate) parts.push(`rotate(${rotate}deg)`);
  return parts.join(' ');
}

/**
 * A picture size the caller supplied, if usable
 * @param {*} size
 * @returns {{width: number, height: number}|null}
 */
function usableSize(size) {
  return size && Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
    ? { width: size.width, height: size.height }
    : null;
}

/** The crop-fit values: how the cropped part fills a box that has a `height` (Word's crop-to-shape fill and fit) */
export const CROP_FITS = Object.freeze(['cover', 'contain', 'fill', 'scale-down']);

/**
 * The `height` of a picture that has a crop: a CSS length with a unit (not %, not `auto`: the figure has no height to take a
 * percentage of). With a crop it gives the picture's box a shape of its own; `crop-fit` then decides how the cropped part
 * fills it (FIX-CF, R-258).
 * @param {*} value - `height` as written
 * @returns {string} The length, or '' (ignored)
 */
export function parseBoxHeight(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return LENGTH_RE.test(text) ? text : '';
}

/**
 * The part of the displayed picture the box shows, in % of it: like `visibleArea`, but a picture with no crop shows all of it.
 * Null when the crop or shift is not in % (the browser alone knows those sizes).
 * @param {ReturnType<typeof readPictureKeys>} keys
 * @returns {{x0: number, y0: number, x1: number, y1: number}|null}
 */
function boxArea(keys) {
  if (!keys.percentOnly) return null;
  return keys.crop ? visibleArea(keys) : { x0: 0, y0: 0, x1: 100, y1: 100 };
}

/**
 * The fit box (FIX-CF, R-258): the crop window with a shape of its own (`height`, and the figure's width), in which `crop-fit`
 * decides how the cropped part fills it. Needs the picture's size (a ratio the markup can compute with) and a crop in % only.
 * The frame holds the whole picture (and the shapes of an annotated image, so they stay on the picture's points); its size
 * and place are computed here in the box's own units (`cqw`, `cqh`, with `min()` and `max()`). `object-view-box` is not
 * used: Chromium ignores it under `contain` and `scale-down`. `contain` and `scale-down` clip the frame to the cropped
 * part, so the rest of the picture does not show in the empty space.
 * @returns {{html: string, windowed: boolean, boxed: boolean}|null} null: not possible (the caller draws the old way)
 */
function fitBoxMarkup({ imgWith, keys, size, inner, indent, windowClass, box }) {
  const natural = usableSize(size);
  const area = boxArea(keys);
  if (!natural || !area || !CROP_FITS.includes(box.fit)) return null;
  const turned = keys.rotate === 90 || keys.rotate === 270;
  const dw = turned ? natural.height : natural.width; // the displayed picture, in its own pixels
  const dh = turned ? natural.width : natural.height;
  const rw = ((area.x1 - area.x0) / 100) * dw; // the part the box shows
  const rh = ((area.y1 - area.y0) / 100) * dh;
  if (!(rw > 0) || !(rh > 0)) return null;

  // The frame's size: n picture pixels when the shown part's width fills the box's width (byW) or its height the box's (byH).
  // cover: the larger of the two, contain: the smaller, fill: each side on its own, scale-down: contain but never larger than 1:1.
  const byW = (n) => `${round((100 * n) / rw)}cqw`;
  const byH = (n) => `${round((100 * n) / rh)}cqh`;
  let fw;
  let fh;
  if (box.fit === 'fill') {
    fw = byW(dw);
    fh = byH(dh);
  } else {
    const pick = box.fit === 'cover' ? 'max' : 'min';
    fw = `${pick}(${byW(dw)}, ${byH(dw)})`;
    fh = `${pick}(${byW(dh)}, ${byH(dh)})`;
    if (box.fit === 'scale-down') {
      fw = `min(${dw}px, ${fw})`;
      fh = `min(${dh}px, ${fh})`;
    }
  }
  // The shown part's middle goes to the box's middle
  const cx = round((area.x0 + area.x1) / 200);
  const cy = round((area.y0 + area.y1) / 200);
  const frameStyle = [
    `--fw: ${fw}; --fh: ${fh}; position: absolute; width: var(--fw); height: var(--fh);`,
    `left: calc(50cqw - ${cx} * var(--fw)); top: calc(50cqh - ${cy} * var(--fh));`
  ];
  if (box.fit === 'contain' || box.fit === 'scale-down') {
    const inset = (n) => `${round(Math.min(100, Math.max(0, n)))}%`;
    frameStyle.push(`clip-path: inset(${inset(area.y0)} ${inset(100 - area.x1)} ${inset(100 - area.y1)} ${inset(area.x0)});`);
  }
  const transform = pictureTransform(keys.rotate, keys.flip);
  const reset = 'max-width: none; max-height: none; margin: 0;';
  const picture = turned
    ? `<div class="image-turn" style="position: relative; width: 100%; height: 100%;">` +
      imgWith(`position: absolute; left: 50%; top: 50%; width: var(--fh); height: var(--fw); ${reset} transform: translate(-50%, -50%) ${transform};`) +
      `</div>`
    : imgWith(`display: block; width: 100%; height: 100%; ${reset}${transform ? ` transform: ${transform};` : ''}`);
  const windowStyle = `display: block; position: relative; overflow: hidden; container-type: size; width: 100%; max-width: 100%; height: ${box.height}; vertical-align: top; white-space: normal;`;
  const html =
    `${indent}<div class="image-crop" style="container-type: inline-size;">\n` +
    `${indent}<div class="${windowClass} image-box" style="${attr(windowStyle)}">\n` +
    `${indent}<div class="image-frame" style="${attr(frameStyle.join(' '))}">\n` +
    `${indent}${picture}\n${inner}` +
    `${indent}</div>\n${indent}</div>\n${indent}</div>\n`;
  return { html, windowed: true, boxed: true };
}

/**
 * The picture's markup (the `<img>`, possibly in a turn box and a crop window), the shapes put in its frame.
 *
 * @param {object} opts
 * @param {string} opts.img - The `<img …>` markup (with its link, if any), WITHOUT a style attribute of its own
 * @param {(style: string) => string} opts.imgWith - Gives the same markup with a style attribute added to the `<img>`
 * @param {ReturnType<typeof readPictureKeys>} opts.keys
 * @param {{width: number, height: number}|null} [opts.size] - The picture's own size (after its EXIF turn), for 90°/270°
 * @param {string} [opts.inner] - Markup drawn over the picture, in the frame (shapes, badges, notes)
 * @param {string} [opts.indent] - Indent of each line this adds
 * @param {string} [opts.windowClass] - The window's class (an annotated image: `image-wrapper image-window`)
 * @param {{height: string, fit: string}} [opts.box] - A shape of its own for the picture (`height`, `crop-fit`): drawn when the
 *   picture's size is known and the crop is in % only (FIX-CF); otherwise ignored
 * @returns {{html: string, windowed: boolean}} Not windowed: the picture line followed by `inner` (the caller puts its
 *   own frame around it); windowed: the crop area, window and frame with the picture and `inner` in it
 */
export function pictureMarkup({ img, imgWith, keys, size, inner = '', indent = '', windowClass = 'image-window', box }) {
  if (box && box.height) {
    const boxed = fitBoxMarkup({ imgWith, keys, size, inner, indent, windowClass, box });
    if (boxed) return boxed;
  }
  const turned = keys.rotate === 90 || keys.rotate === 270;
  const known = turned ? usableSize(size) : null;
  let picture;
  if (known) {
    // The turned picture's box: width and height swapped. The <img> keeps its own shape, centred, and turns.
    const w = known.height;
    const h = known.width;
    const imgStyle = `position: absolute; left: 50%; top: 50%; width: ${round((100 * h) / w)}%; max-width: none; height: auto; max-height: none; margin: 0; ` +
      `transform: translate(-50%, -50%) ${pictureTransform(keys.rotate, keys.flip)};`;
    picture = `<div class="image-turn" style="position: relative; width: ${w}px; max-width: 100%; aspect-ratio: ${w} / ${h}; margin: 0 auto;">` +
      `${imgWith(imgStyle)}</div>`;
  } else {
    const transform = pictureTransform(keys.rotate, keys.flip);
    picture = transform ? imgWith(`transform: ${transform};`) : img;
  }
  if (!keys.crop) return { html: `${indent}${picture}\n${inner}`, windowed: false };

  // The window: sized from the picture by the browser (calc-size), clipping the frame (the whole picture, shifted by pos-*)
  const sizeOf = (basis, crop) => (!crop ? '' : 'percent' in crop
    ? `calc-size(${basis}, size * ${round(crop.percent / 100)})`
    : `calc-size(${basis}, min(size, ${crop.length}))`);
  const windowStyle = ['display: inline-block; position: relative; overflow: hidden; max-width: 100%; vertical-align: top;'];
  if (keys.cropX) windowStyle.push(`width: ${sizeOf('fit-content', keys.cropX)};`);
  if (keys.cropY) windowStyle.push(`height: ${sizeOf('auto', keys.cropY)};`);
  const frameStyle = ['position: relative; width: max-content; max-width: 100cqw;'];
  if (keys.posX || keys.posY) frameStyle.push(`transform: translate(${keys.posX || '0px'}, ${keys.posY || '0px'});`);
  const html =
    `${indent}<div class="image-crop" style="container-type: inline-size;">\n` +
    `${indent}<div class="${windowClass}" style="${attr(windowStyle.join(' '))}">\n` +
    `${indent}<div class="image-frame" style="${attr(frameStyle.join(' '))}">\n` +
    `${indent}${picture}\n${inner}` +
    `${indent}</div>\n${indent}</div>\n${indent}</div>\n`;
  return { html, windowed: true };
}

/**
 * Map a rectangle in % of the displayed picture (turned by `rotate`, then flipped by `flip`) back to % of the picture as
 * its file is shown upright (after its EXIF turn). Used to paint a redaction into the picture file's own pixels.
 * @param {{x: number, y: number, width: number, height: number}} rect - % of the displayed picture
 * @param {number} rotate - 0, 90, 180, 270 (clockwise)
 * @param {string} flip - '', 'h', 'v', 'hv'
 * @returns {{x: number, y: number, width: number, height: number}} % of the upright picture
 */
export function displayedRectToNatural(rect, rotate, flip) {
  // Two corners, as fractions; undo the flip, then the turn
  const corners = [[rect.x / 100, rect.y / 100], [(rect.x + rect.width) / 100, (rect.y + rect.height) / 100]].map(([u, v]) => {
    let a = flip === 'h' || flip === 'hv' ? 1 - u : u;
    let b = flip === 'v' || flip === 'hv' ? 1 - v : v;
    if (rotate === 90) [a, b] = [b, 1 - a];
    else if (rotate === 180) [a, b] = [1 - a, 1 - b];
    else if (rotate === 270) [a, b] = [1 - b, a];
    return [a, b];
  });
  const [[u1, v1], [u2, v2]] = corners;
  return {
    x: round(Math.min(u1, u2) * 100),
    y: round(Math.min(v1, v2) * 100),
    width: round(Math.abs(u2 - u1) * 100),
    height: round(Math.abs(v2 - v1) * 100)
  };
}

/**
 * The part of the picture a % crop shows, in % of the displayed picture; null when a crop or shift is not in % (the
 * browser alone knows the sizes then) or there is no crop.
 * @param {ReturnType<typeof readPictureKeys>} keys
 * @returns {{x0: number, y0: number, x1: number, y1: number}|null}
 */
export function visibleArea(keys) {
  if (!keys.crop || !keys.percentOnly) return null;
  const pct = (pos) => {
    if (!pos) return 0;
    const m = pos.match(/^([-+]?[\d.]+)%$/);
    return m ? parseFloat(m[1]) : NaN;
  };
  const px = pct(keys.posX);
  const py = pct(keys.posY);
  if (Number.isNaN(px) || Number.isNaN(py)) return null;
  const w = keys.cropX ? keys.cropX.percent : 100;
  const h = keys.cropY ? keys.cropY.percent : 100;
  return { x0: -px || 0, y0: -py || 0, x1: w - px, y1: h - py };
}

/**
 * Redaction rectangles (`redact:`), checked. Fail closed: anything that is not a list of rectangles is an error, and a caller
 * must then not show the picture.
 * @param {*} value - The YAML's `redact` value
 * @returns {{rects: Array<{x: number, y: number, width: number, height: number}>, error: string|null}}
 */
export function readRedactions(value) {
  if (value === undefined || value === null) return { rects: [], error: null };
  if (!Array.isArray(value)) return { rects: [], error: 'redact must be a list of rectangles ({ x, y, width, height })' };
  const rects = [];
  for (let i = 0; i < value.length; i++) {
    const r = value[i];
    const ok = r && typeof r === 'object' && ['x', 'y', 'width', 'height'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k]));
    if (!ok || r.width < 0 || r.height < 0) {
      return { rects: [], error: `redact entry ${i + 1} is not a rectangle ({ x, y, width, height }, numbers, % of the picture)` };
    }
    const x = Math.min(Math.max(r.x, 0), 100);
    const y = Math.min(Math.max(r.y, 0), 100);
    // A rectangle reaching past an edge is cut at that edge: it still covers everything inside the picture it was over
    const x2 = Math.min(Math.max(r.x + r.width, 0), 100);
    const y2 = Math.min(Math.max(r.y + r.height, 0), 100);
    rects.push({ x: round(x), y: round(y), width: round(Math.max(x2 - x, 0)), height: round(Math.max(y2 - y, 0)) });
  }
  return { rects, error: null };
}

/**
 * The key a baked redaction is looked up by (pagemd's bake and the renderer agree on it)
 * @param {string} src
 * @param {Array<object>} rects - From readRedactions
 * @param {number} rotate
 * @param {string} flip
 * @returns {string}
 */
export function redactionKey(src, rects, rotate, flip) {
  return JSON.stringify([src, rects.map((r) => [r.x, r.y, r.width, r.height]), rotate, flip]);
}

/**
 * @typedef {object} PictureEdit
 * @property {'figure'|'annotated'} form
 * @property {string} src - The path as written
 * @property {number|null} line - 0-based line of the block
 * @property {number} rotate
 * @property {string} flip
 * @property {Array<object>} redact - Rectangles (annotated images only)
 * @property {string|null} redactError - Why `redact:` can't be used (fail closed)
 * @property {boolean} redacted - The picture must not be shown as it is (rectangles or an error)
 */

/**
 * Every picture with a turn, flip or redaction, from parsed tokens (either mode), read exactly as the renderer reads them.
 * pagemd uses it to find the pictures to measure (90°/270°) and to bake (redactions); `pagemd archive` to warn.
 * @param {object[]} tokens
 * @returns {PictureEdit[]}
 */
export function listPictureEdits(tokens) {
  const out = [];
  for (const token of tokens) {
    const line = token.map ? token.map[0] : null;
    if (token.type === 'annotated_image') {
      const data = token.meta && token.meta.data ? token.meta.data : {};
      const keys = readPictureKeys(data.options || {});
      const { rects, error } = readRedactions(data.redact);
      const box = keys.crop && !!parseBoxHeight((data.options || {}).height);
      if (keys.rotate || keys.flip || rects.length || error || box) {
        out.push({ form: 'annotated', src: token.meta.imagePath, line, rotate: keys.rotate, flip: keys.flip, redact: rects, redactError: error, redacted: rects.length > 0 || !!error, ...(box ? { box } : {}) });
      }
    } else if (token.type === 'figure_open' && token.meta && !token.meta.legacy) {
      const attrs = token.meta.attrs || {};
      const keys = readPictureKeys(attrs);
      // `box`: a crop (or a crop-fit) with a height: the build needs the picture's size (FIX-CF)
      const box = !!parseBoxHeight(attrs.height) && (keys.crop || !!attrs['crop-fit']);
      if ((keys.rotate || keys.flip || box) && attrs.src) {
        out.push({ form: 'figure', src: attrs.src, line, rotate: keys.rotate, flip: keys.flip, redact: [], redactError: null, redacted: false, ...(box ? { box } : {}) });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The picture-size reader (PNG, JPEG with its EXIF orientation, WebP, GIF): headers only, no dependency (R-249)
// ---------------------------------------------------------------------------------------------------------------------------

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b, i) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));

/**
 * The EXIF orientation (1–8) in a JPEG APP1 segment's data, or 1
 * @param {Uint8Array} b
 * @param {number} start - First byte after "Exif\0\0" (the TIFF header)
 * @param {number} end
 */
function exifOrientation(b, start, end) {
  if (end - start < 8) return 1;
  const little = b[start] === 0x49 && b[start + 1] === 0x49;
  if (!little && !(b[start] === 0x4d && b[start + 1] === 0x4d)) return 1;
  const r16 = (i) => (little ? u16le(b, i) : u16be(b, i));
  const r32 = (i) => (little ? (u16le(b, i) + u16le(b, i + 2) * 65536) : u32be(b, i));
  const ifd = start + r32(start + 4);
  if (ifd + 2 > end) return 1;
  const count = r16(ifd);
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > end) break;
    if (r16(e) === 0x0112) {
      const value = r16(e + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/**
 * A picture's size from its first bytes, as a browser shows it (a JPEG's EXIF orientation 5–8 swaps width and height).
 * @param {Uint8Array} bytes - The file (or at least its headers)
 * @returns {{type: 'png'|'jpeg'|'webp'|'gif', width: number, height: number, orientation: number}|null} null: not one of
 *   the four formats, or unreadable
 */
export function readPictureSize(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  // PNG: signature, then the IHDR chunk
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && ascii(b, 12, 4) === 'IHDR') {
    return sized('png', u32be(b, 16), u32be(b, 20), 1);
  }
  // GIF: the logical screen descriptor
  if (b.length >= 10 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) {
    return sized('gif', u16le(b, 6), u16le(b, 8), 1);
  }
  // WebP: RIFF …. WEBP, then VP8 (lossy), VP8L (lossless) or VP8X (extended)
  if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const kind = ascii(b, 12, 4);
    if (kind === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return sized('webp', u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff, 1);
    }
    if (kind === 'VP8L' && b[20] === 0x2f) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return sized('webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1, 1);
    }
    if (kind === 'VP8X') return sized('webp', u24le(b, 24) + 1, u24le(b, 27) + 1, 1);
    return null;
  }
  // JPEG: walk the segments to the frame header (SOF), noting the EXIF orientation on the way
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    let orientation = 1;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) return null;
      const len = u16be(b, i + 2);
      if (len < 2) return null;
      const data = i + 4;
      if (marker === 0xe1 && len >= 8 && ascii(b, data, 6) === 'Exif\0\0') {
        orientation = exifOrientation(b, data + 6, Math.min(i + 2 + len, b.length));
      }
      const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (sof && data + 5 <= b.length) {
        const height = u16be(b, data + 1);
        const width = u16be(b, data + 3);
        return orientation >= 5 ? sized('jpeg', height, width, orientation) : sized('jpeg', width, height, orientation);
      }
      i += 2 + len;
    }
  }
  return null;
}

function sized(type, width, height, orientation) {
  return width > 0 && height > 0 ? { type, width, height, orientation } : null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// CSS that pictures need only when a document uses the keys (added by structuralCssFor, so other documents are unchanged)
// ---------------------------------------------------------------------------------------------------------------------------

/** Marker size (R-250): the badge scaled about its centre (the legend keeps its size) */
export const MARKER_SCALE_STRUCTURAL_CSS = `.marker[style*="--marker-scale"] {
  transform: translate(-50%, -50%) scale(var(--marker-scale));
}
`;

/** Marker label on the picture (R-250): right of its badge, in a small box, at a fixed size like the badge */
export const MARKER_LABEL_STRUCTURAL_CSS = `.marker-label {
  position: absolute;
  transform: translate(calc(var(--marker-size, 1.4rem) * var(--marker-scale, 1) / 2 + 0.25rem), -50%);
  white-space: nowrap;
  font-size: 0.75rem;
  line-height: 1.3;
  padding: 0 0.3rem;
  background: #ffffff;
  color: #000000;
  border: 1px solid var(--marker-color, #cc0000);
  border-radius: 0.2rem;
  pointer-events: none;
  z-index: 10;
}
`;
