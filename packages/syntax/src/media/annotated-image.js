/**
 * @file Annotated Image Plugin for markdown-it
 * @description Renders images with numbered overlay markers, SVG shapes
 * (arrows, boxes), text overlays, and a merged legend.
 *
 * Syntax:
 * ```markdown
 * ::: annotated-image ./assets/image.png
 * options:
 *   caption: "Figure Caption"
 *   markerColor: "#cc0000"
 *   legendColumns: 3
 *   id: "optional-id"
 * markers:
 *   - { id: 1, x: 10, y: 20, label: "Button" }
 * arrows:
 *   - { id: 2, x1: 60, y1: 60, x2: 40, y2: 40, label: "Save", color: "#0a7d00", strokeWidth: 2 }
 * boxes:
 *   - { id: 3, x: 5, y: 50, width: 30, height: 20, label: "Task list", color: "#0066cc", fill: "none" }
 * text:
 *   - { x: 55, y: 80, text: "Click here", fontSize: 14, color: "#fff", background: "#333" }
 * lines:
 *   - { id: 4, x1: 10, y1: 90, x2: 40, y2: 90, label: "Divider", color: "#555", dashed: true }
 * ellipses:
 *   - { id: 5, x: 60, y: 5, width: 20, height: 15, label: "Logo", color: "#0066cc" }
 * highlights:
 *   - { x: 5, y: 30, width: 40, height: 6, color: "#ffeb3b", opacity: 0.5 }
 * :::
 * ```
 *
 * Options: caption, id, markerColor, legendColumns, alt (defaults to the
 * caption), width (full | half | third | quarter, or a CSS length), link, class;
 * since pagemd-editor C13 (R-248 to R-251) also FIGURE's crop-x, crop-y, pos-x,
 * pos-y, crop-fit, and rotate (0 | 90 | 180 | 270), flip (h | v | hv), and
 * showLabels (every marker's label on the picture); `showLegend: false` hides the legend. See ./picture.js.
 *
 * Markers may carry `size` (a multiplier of the badge, 0.5-4, default 1) and
 * `showLabel` (their label drawn beside the badge). `redact:` lists rectangles
 * ({ x, y, width, height }, % of the displayed picture) that must not be seen
 * (provisional, OQ-61): in editor mode they are black boxes over the picture;
 * in render mode the picture is drawn only from the blacked-out copy the caller
 * supplies (`env.redacted(src, rects, rotate, flip)`), else a grey "Redacted
 * picture not prepared" box takes its place (fail closed: never the original).
 *
 * Draw order: highlights, then boxes and ellipses, then lines and arrows.
 * Markers, and any arrow, box, line or ellipse with both `id` and `label`,
 * get a numbered badge and a legend entry. A shape's badge takes the shape's
 * color; marker badges take `markerColor`.
 *
 * Numbering: a captioned annotated image shares one document-order figure
 * counter with FIGUREs (./figure-numbers.js). The YAML is parsed once, when
 * the block is read, and kept on the token (`token.meta.data`).
 *
 * Alternative syntax (markers array at root):
 * ```markdown
 * ::: annotated-image ./assets/image.png
 * - { id: 1, x: 10, y: 20, label: "Button" }
 * :::
 * ```
 *
 * Coordinate system: every x/y/width/height is a percentage (0-100) of the
 * rendered image. Arrows and boxes are drawn in an SVG layer with
 * `viewBox="0 0 100 100" preserveAspectRatio="none"` so the percentages map
 * directly onto the image regardless of its aspect ratio; strokes use
 * `vector-effect="non-scaling-stroke"` so lines are not distorted by the
 * non-uniform scaling. Text overlays are HTML elements (like markers), not
 * SVG `<text>`, because glyphs inside a non-uniformly scaled SVG would be
 * stretched.
 */

import * as yaml from 'js-yaml';
import { useFigureNumbering } from './figure-numbers.js';
import { writeAnnotatedImage } from './annotated-image-write.js';
import { isEditor } from '../shared/mode.js';
import { CROP_FITS, markerScale, parseBoxHeight, pictureMarkup, readPictureKeys, readRedactions, visibleArea, MARKER_SIZE } from './picture.js';

// js-yaml 4's rules (dates, << merges) on js-yaml 5, the same as pagemd's loadYaml (phase U1).
const YAML_SCHEMA = yaml.CORE_SCHEMA.withTags(yaml.timestampTag, yaml.mergeTag, yaml.binaryTag, yaml.omapTag, yaml.pairsTag);

// Match opening fence: ::: annotated-image path
const OPEN_REGEX = /^:::[ ]*annotated-image[ ]+(.+)$/;
// Match closing fence: :::
const CLOSE_REGEX = /^:::[ ]*$/;

/** Default visual values for shapes and options */
const DEFAULTS = Object.freeze({
  markerColor: '#cc0000',
  arrowColor: '#cc0000',
  boxColor: '#0066cc',
  boxFill: 'none',
  textColor: '#000000',
  lineColor: '#cc0000',
  ellipseColor: '#0066cc',
  ellipseFill: 'none',
  highlightColor: '#ffeb3b',
  highlightOpacity: 0.5,
  strokeWidth: 2,
  fontSize: 14,
  legendColumns: 3,
  // Offset (in % of image) of a box's legend badge from its top-left corner
  boxBadgeInset: 3
});

/** Upper bounds for numeric inputs (prevents absurd values) */
const LIMITS = Object.freeze({
  strokeWidth: 20,
  fontSize: 96,
  legendColumns: 12
});

/**
 * Clamp a numeric value to a range
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Clamp a percentage coordinate to 0-100
 * @param {number} value - Coordinate
 * @returns {number} Clamped coordinate
 */
function pct(value) {
  return clamp(value, 0, 100);
}

/**
 * Coerce a user-supplied value to a positive finite number.
 * Non-numbers (including strings) fall back to the default, which prevents
 * attribute injection via numeric fields such as `strokeWidth`.
 * @param {*} value - Raw value from YAML
 * @param {number} fallback - Default when value is invalid
 * @param {number} max - Upper bound
 * @returns {number} Safe number
 */
function toPositiveNumber(value, fallback, max) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(value, max)
    : fallback;
}

/**
 * Return value if it is an array, otherwise an empty array
 * (guards against `arrows: "foo"` or `boxes: { ... }` in YAML)
 * @param {*} value - Raw value
 * @returns {Array} Array
 */
function toArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Read the YAML between the ::: markers exactly as the renderer does
 * (js-yaml, pagemd's rules). Used by the write rule too.
 * @param {string} content - YAML content between ::: markers
 * @returns {*} The YAML's value (throws on a YAML error)
 */
export function loadAnnotationYaml(content) {
  return yaml.load(content.trim(), { schema: YAML_SCHEMA });
}

/**
 * Turn the YAML's value into the shape the renderer uses: options plus the 7 shape lists
 * @param {*} data - What loadAnnotationYaml returned
 * @returns {object} Parsed data with options and the shape lists
 */
export function normalizeAnnotationData(data) {
  const empty = { options: {}, markers: [], arrows: [], boxes: [], text: [], lines: [], ellipses: [], highlights: [] };
  if (!data || typeof data !== 'object') {
    return empty;
  }

  // Handle array at root level (legacy format - treated as markers)
  if (Array.isArray(data)) {
    return { ...empty, markers: data };
  }

  // Handle object with options and shape arrays
  const out = {
    options: data.options && typeof data.options === 'object' ? data.options : {},
    markers: toArray(data.markers),
    arrows: toArray(data.arrows),
    boxes: toArray(data.boxes),
    text: toArray(data.text),
    lines: toArray(data.lines),
    ellipses: toArray(data.ellipses),
    highlights: toArray(data.highlights)
  };
  // Redaction rectangles (C13), kept as written (not filtered): anything that is not a list of rectangles must
  // stop the picture from being shown (./picture.js readRedactions); only present when the author wrote it
  // (an empty list or none reads as no redaction, the same as leaving the key out)
  const redact = data.redact;
  if (redact !== undefined && redact !== null && !(Array.isArray(redact) && redact.length === 0)) out.redact = redact;
  return out;
}

/**
 * Parse YAML content from container
 * @param {string} content - YAML content between ::: markers
 * @returns {object} Parsed data with options and the shape lists; `error` holds the
 *   message when the YAML could not be read (the figure then has no shapes)
 */
function parseYamlContent(content) {
  try {
    return normalizeAnnotationData(loadAnnotationYaml(content));
  } catch (err) {
    // Empty structure on parse error; the message is kept for the editor (C2)
    return { ...normalizeAnnotationData(null), error: String(err && err.message ? err.message : err) };
  }
}

/**
 * Check that every listed key on obj is a finite number
 * @param {object} obj - Object to check
 * @param {string[]} keys - Keys that must be numbers
 * @returns {boolean} True if all keys are numbers
 */
function hasNumbers(obj, keys) {
  return !!obj && typeof obj === 'object' &&
    keys.every(k => typeof obj[k] === 'number' && Number.isFinite(obj[k]));
}

/**
 * Validate marker object
 * @param {object} marker - Marker object
 * @returns {boolean} True if valid
 */
function isValidMarker(marker) {
  return hasNumbers(marker, ['x', 'y']) &&
    typeof marker.id !== 'undefined' &&
    typeof marker.label === 'string';
}

/**
 * Validate arrow object
 * @param {object} arrow - Arrow object
 * @returns {boolean} True if valid
 */
function isValidArrow(arrow) {
  return hasNumbers(arrow, ['x1', 'y1', 'x2', 'y2']);
}

/**
 * Validate box object
 * @param {object} box - Box object
 * @returns {boolean} True if valid
 */
function isValidBox(box) {
  return hasNumbers(box, ['x', 'y', 'width', 'height']);
}

/** A line needs the same four numbers as an arrow */
const isValidLine = isValidArrow;

/** An ellipse is given by its bounding box, like a box */
const isValidEllipse = isValidBox;

/** A highlight is a rectangle, like a box */
const isValidHighlight = isValidBox;

/**
 * Validate text object
 * @param {object} text - Text object
 * @returns {boolean} True if valid
 */
function isValidText(text) {
  return hasNumbers(text, ['x', 'y']) && typeof text.text === 'string';
}

/**
 * Escape a value for use in HTML text content or a double-quoted attribute
 * @param {*} str - Value to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (str === null || typeof str === 'undefined') return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Resolve a user-supplied color (or other single CSS value).
 * Empty/non-string values and values that could terminate a CSS declaration
 * (`;`, `{`, `}`) fall back to the default. The result is NOT HTML-escaped -
 * callers must still pass it through escapeHtml() (or use cssValue()).
 * @param {*} value - Raw value
 * @param {string} fallback - Default value
 * @returns {string} Unescaped, declaration-safe value
 */
function safeColor(value, fallback) {
  const raw = (typeof value === 'string' || typeof value === 'number') ? String(value).trim() : '';
  return raw && !/[;{}]/.test(raw) ? raw : fallback;
}

/**
 * Prepare a user-supplied value for a CSS declaration inside `style="..."`
 * @param {*} value - Raw value
 * @param {string} fallback - Default value
 * @returns {string} Escaped, declaration-safe value
 */
function cssValue(value, fallback) {
  return escapeHtml(safeColor(value, fallback));
}

/**
 * Compare legend IDs: numeric IDs numerically, otherwise lexically
 * @param {{id: *}} a - First item
 * @param {{id: *}} b - Second item
 * @returns {number} Sort order
 */
function compareIds(a, b) {
  const aNum = parseInt(a.id, 10);
  const bNum = parseInt(b.id, 10);
  if (!isNaN(aNum) && !isNaN(bNum)) {
    return aNum - bNum;
  }
  return String(a.id).localeCompare(String(b.id));
}

/**
 * Normalize a valid arrow: clamp coordinates, resolve defaults, and compute
 * the legend badge position (midpoint of the line).
 * @param {object} a - Raw arrow
 * @returns {object} Normalized arrow
 */
function normalizeArrow(a) {
  const x1 = pct(a.x1), y1 = pct(a.y1), x2 = pct(a.x2), y2 = pct(a.y2);
  return {
    type: 'arrow',
    id: a.id,
    label: a.label,
    x1, y1, x2, y2,
    color: safeColor(a.color, DEFAULTS.arrowColor),
    strokeWidth: toPositiveNumber(a.strokeWidth, DEFAULTS.strokeWidth, LIMITS.strokeWidth),
    badgeX: (x1 + x2) / 2,
    badgeY: (y1 + y2) / 2
  };
}

/**
 * Normalize a valid box: clamp position and size so the box stays inside the
 * image, resolve defaults, and compute the legend badge position (inset from
 * the top-left corner, but never past the box centre for small boxes).
 * @param {object} b - Raw box
 * @returns {object} Normalized box
 */
function normalizeBox(b) {
  const x = pct(b.x);
  const y = pct(b.y);
  const width = clamp(b.width, 0, 100 - x);
  const height = clamp(b.height, 0, 100 - y);
  return {
    type: 'box',
    id: b.id,
    label: b.label,
    x, y, width, height,
    color: safeColor(b.color, DEFAULTS.boxColor),
    fill: safeColor(b.fill, DEFAULTS.boxFill),
    strokeWidth: toPositiveNumber(b.strokeWidth, DEFAULTS.strokeWidth, LIMITS.strokeWidth),
    badgeX: x + Math.min(DEFAULTS.boxBadgeInset, width / 2),
    badgeY: y + Math.min(DEFAULTS.boxBadgeInset, height / 2)
  };
}

/**
 * Clamp a rectangle (x, y, width, height in %) so it stays inside the image
 * @param {object} r - Raw rectangle
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function clampRect(r) {
  const x = pct(r.x);
  const y = pct(r.y);
  return { x, y, width: clamp(r.width, 0, 100 - x), height: clamp(r.height, 0, 100 - y) };
}

/**
 * Normalize a valid line: like an arrow without a head, optionally dashed.
 * @param {object} l - Raw line
 * @returns {object} Normalized line
 */
function normalizeLine(l) {
  const x1 = pct(l.x1), y1 = pct(l.y1), x2 = pct(l.x2), y2 = pct(l.y2);
  return {
    type: 'line',
    id: l.id,
    label: l.label,
    x1, y1, x2, y2,
    color: safeColor(l.color, DEFAULTS.lineColor),
    strokeWidth: toPositiveNumber(l.strokeWidth, DEFAULTS.strokeWidth, LIMITS.strokeWidth),
    dashed: l.dashed === true,
    badgeX: (x1 + x2) / 2,
    badgeY: (y1 + y2) / 2
  };
}

/**
 * Normalize a valid ellipse (given by its bounding box, clamped inside the
 * image). Its badge sits on the outline, up and left of the centre (45°).
 * @param {object} e - Raw ellipse
 * @returns {object} Normalized ellipse
 */
function normalizeEllipse(e) {
  const { x, y, width, height } = clampRect(e);
  const rx = width / 2;
  const ry = height / 2;
  return {
    type: 'ellipse',
    id: e.id,
    label: e.label,
    cx: x + rx, cy: y + ry, rx, ry,
    color: safeColor(e.color, DEFAULTS.ellipseColor),
    fill: safeColor(e.fill, DEFAULTS.ellipseFill),
    strokeWidth: toPositiveNumber(e.strokeWidth, DEFAULTS.strokeWidth, LIMITS.strokeWidth),
    badgeX: Number((x + rx - rx * Math.SQRT1_2).toFixed(4)),
    badgeY: Number((y + ry - ry * Math.SQRT1_2).toFixed(4))
  };
}

/**
 * Normalize a valid highlight: a filled, see-through rectangle (no outline).
 * @param {object} h - Raw highlight
 * @returns {object} Normalized highlight
 */
function normalizeHighlight(h) {
  const opacity = typeof h.opacity === 'number' && Number.isFinite(h.opacity)
    ? clamp(h.opacity, 0, 1)
    : DEFAULTS.highlightOpacity;
  return {
    type: 'highlight',
    ...clampRect(h),
    color: safeColor(h.color, DEFAULTS.highlightColor),
    opacity
  };
}

/**
 * Normalize a valid text overlay
 * @param {object} t - Raw text
 * @returns {object} Normalized text
 */
function normalizeText(t) {
  return {
    x: pct(t.x),
    y: pct(t.y),
    text: t.text,
    fontSize: toPositiveNumber(t.fontSize, DEFAULTS.fontSize, LIMITS.fontSize),
    color: t.color,
    background: t.background
  };
}

/** True when a shape should appear in the legend (has id and label) */
function hasLegendEntry(item) {
  return typeof item.id !== 'undefined' && item.id !== null && !!item.label;
}

/**
 * FNV-1a 32-bit hash, as a short base-36 string
 * @param {string} text - Text to hash
 * @returns {string}
 */
function shortHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Build one arrowhead <marker> per distinct arrow color so each head matches
 * its line. Each id is a hash of the block's own source and the color
 * (`arrowhead-{hash}`), so it is the same however often or separately the
 * block is rendered, and different blocks never share an id unless they are
 * identical (then the definitions are identical too) (PD5).
 * @param {Array} arrows - Normalized arrows
 * @param {string} blockKey - The block's source (image path + YAML)
 * @returns {{defs: string, markerIdFor: Map<string, string>}} Defs markup and color→id map
 */
function generateArrowheadDefs(arrows, blockKey) {
  const markerIdFor = new Map();
  const parts = [];
  for (const { color } of arrows) {
    if (markerIdFor.has(color)) continue;
    const id = `arrowhead-${shortHash(`${blockKey}\n${color}`)}`;
    markerIdFor.set(color, id);
    parts.push(
      `        <marker id="${id}" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">\n` +
      `          <polygon points="0 0, 10 3, 0 6" fill="${escapeHtml(color)}" />\n` +
      `        </marker>\n`
    );
  }
  const defs = parts.length ? `      <defs>\n${parts.join('')}      </defs>\n` : '';
  return { defs, markerIdFor };
}

/**
 * Generate SVG arrow elements
 * @param {Array} arrows - Normalized arrows
 * @param {Map<string, string>} markerIdFor - Color → arrowhead marker id
 * @returns {string} SVG line elements
 */
function generateArrowsSvg(arrows, markerIdFor) {
  return arrows.map(a =>
    `    <line x1="${a.x1}" y1="${a.y1}" x2="${a.x2}" y2="${a.y2}" stroke="${escapeHtml(a.color)}" ` +
    `stroke-width="${a.strokeWidth}" marker-end="url(#${markerIdFor.get(a.color)})" ` +
    `vector-effect="non-scaling-stroke" />\n`
  ).join('');
}

/**
 * Generate SVG box elements
 * @param {Array} boxes - Normalized boxes
 * @returns {string} SVG rect elements
 */
function generateBoxesSvg(boxes) {
  return boxes.map(b =>
    `    <rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" ` +
    `stroke="${escapeHtml(b.color)}" fill="${escapeHtml(b.fill)}" stroke-width="${b.strokeWidth}" ` +
    `vector-effect="non-scaling-stroke" />\n`
  ).join('');
}

/**
 * Generate SVG line elements (arrows without heads)
 * @param {Array} lines - Normalized lines
 * @returns {string} SVG line elements
 */
function generateLinesSvg(lines) {
  return lines.map(l => {
    const dash = l.dashed ? ` stroke-dasharray="${l.strokeWidth * 3} ${l.strokeWidth * 2}"` : '';
    return `    <line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${escapeHtml(l.color)}" ` +
      `stroke-width="${l.strokeWidth}"${dash} vector-effect="non-scaling-stroke" />\n`;
  }).join('');
}

/**
 * Generate SVG ellipse elements
 * @param {Array} ellipses - Normalized ellipses
 * @returns {string} SVG ellipse elements
 */
function generateEllipsesSvg(ellipses) {
  return ellipses.map(e =>
    `    <ellipse cx="${e.cx}" cy="${e.cy}" rx="${e.rx}" ry="${e.ry}" ` +
    `stroke="${escapeHtml(e.color)}" fill="${escapeHtml(e.fill)}" stroke-width="${e.strokeWidth}" ` +
    `vector-effect="non-scaling-stroke" />\n`
  ).join('');
}

/**
 * Generate SVG highlight rectangles (filled, see-through, no outline)
 * @param {Array} highlights - Normalized highlights
 * @returns {string} SVG rect elements
 */
function generateHighlightsSvg(highlights) {
  return highlights.map(h =>
    `    <rect x="${h.x}" y="${h.y}" width="${h.width}" height="${h.height}" ` +
    `fill="${escapeHtml(h.color)}" fill-opacity="${h.opacity}" stroke="none" style="mix-blend-mode: multiply" />\n`
  ).join('');
}

/**
 * Generate text overlays as absolutely positioned HTML spans.
 * (x, y) is the top-left corner of the text box.
 * @param {Array} texts - Normalized text overlays
 * @returns {string} HTML span elements
 */
function generateTextHtml(texts) {
  return texts.map(t => {
    let style = `left: ${t.x}%; top: ${t.y}%; font-size: ${t.fontSize}px; ` +
      `color: ${cssValue(t.color, DEFAULTS.textColor)};`;
    if (t.background) {
      style += ` background: ${cssValue(t.background, 'transparent')};`;
    }
    // A line break in the text starts a new line (PD21)
    const text = escapeHtml(t.text).replace(/\r?\n/g, '<br>');
    return `    <span class="annotation-text" style="${style}">${text}</span>\n`;
  }).join('');
}

/** FIGURE's named widths, shared by annotated images (A7) */
const SEMANTIC_WIDTHS = ['full', 'half', 'third', 'quarter'];

/**
 * Class names an author may add (A7): plain CSS identifiers only
 * @param {*} value - Raw `class` option (space-separated string)
 * @returns {string[]} Safe class names
 */
function safeClasses(value) {
  if (typeof value !== 'string') return [];
  return value.split(/\s+/).filter(c => /^-?[A-Za-z_][\w-]*$/.test(c));
}

/**
 * Wrap the image in a link, with the same rules as FIGURE's `link` (A7):
 * javascript:, data: and vbscript: links are dropped; http(s) links open in
 * a new tab.
 * @param {string} imgTag - The <img> markup
 * @param {*} link - Raw `link` option
 * @returns {string} Markup
 */
function wrapInLink(imgTag, link) {
  if (typeof link !== 'string' || !link.trim()) return imgTag;
  if (/^(javascript|data|vbscript):/i.test(link.trim())) return imgTag;
  const attrs = [`href="${escapeHtml(link)}"`];
  if (/^https?:\/\//i.test(link)) attrs.push('target="_blank"', 'rel="noopener noreferrer"');
  return `<a ${attrs.join(' ')}>${imgTag}</a>`;
}

/**
 * Inline style that gives a shape's badge (and legend number) the shape's color
 * @param {object} item - Legend item
 * @returns {string} Style fragment ('' for markers)
 */
function badgeColorStyle(item) {
  return item.type === 'marker' ? '' : ` --marker-color: ${escapeHtml(item.color)};`;
}

/**
 * Generate SVG redaction boxes (editor mode only: opaque, under every shape, as in the baked picture)
 * @param {Array} rects - From readRedactions
 * @returns {string} SVG rect elements
 */
function generateRedactionsSvg(rects) {
  return rects.map(r =>
    `    <rect class="annotation-redact" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="#000000" stroke="none" />\n`
  ).join('');
}

/** Shown instead of a redacted picture when no blacked-out copy was supplied (fail closed, R-251) */
const REDACTION_PLACEHOLDER = 'Redacted picture not prepared';

/**
 * Generate HTML for annotated image
 * @param {string} imagePath - Path to image
 * @param {object} data - Parsed YAML (options + shape lists)
 * @param {number|null} figureNumber - Figure number if caption provided
 * @param {string} blockKey - The block's source, for SVG marker ids
 * @param {{editor: boolean, env: object}} [ctx] - The dialect's mode and markdown-it's env (pictureSize, redacted)
 * @returns {string} HTML output
 */
function generateHtml(imagePath, data, figureNumber, blockKey, ctx = { editor: false, env: {} }) {
  const { options, markers, arrows, boxes, text: texts, lines, ellipses, highlights } = data;
  const env = ctx.env && typeof ctx.env === 'object' ? ctx.env : {};
  const keys = readPictureKeys(options);
  const edited = keys.crop || keys.rotate !== 0 || keys.flip !== '';
  const { rects: redactRects, error: redactError } = readRedactions(data.redact);
  const redacted = redactRects.length > 0 || !!redactError;
  // Render mode: a redacted picture is drawn only from the blacked-out copy the caller baked; never from its own path
  let src = imagePath;
  let placeholder = false;
  if (redacted && !ctx.editor) {
    const baked = !redactError && typeof env.redacted === 'function' ? env.redacted(imagePath, redactRects, keys.rotate, keys.flip) : null;
    if (typeof baked === 'string' && baked.trim() && baked !== imagePath) src = baked;
    else placeholder = true;
  }
  const showLabels = options.showLabels === true;
  const caption = options.caption || '';
  const legendColumns = Math.round(
    toPositiveNumber(options.legendColumns, DEFAULTS.legendColumns, LIMITS.legendColumns)
  );
  const figId = options.id || '';
  const alt = typeof options.alt === 'string' ? options.alt : caption;

  // Validate + normalize every shape type once
  const validMarkers = markers
    .filter(isValidMarker)
    .map(m => ({
      type: 'marker', id: m.id, label: m.label, badgeX: pct(m.x), badgeY: pct(m.y),
      scale: markerScale(m.size), showLabel: m.showLabel === true || (showLabels && m.showLabel !== false)
    }));
  const validArrows = arrows.filter(isValidArrow).map(normalizeArrow);
  const validBoxes = boxes.filter(isValidBox).map(normalizeBox);
  const validTexts = texts.filter(isValidText).map(normalizeText);
  const validLines = lines.filter(isValidLine).map(normalizeLine);
  const validEllipses = ellipses.filter(isValidEllipse).map(normalizeEllipse);
  const validHighlights = highlights.filter(isValidHighlight).map(normalizeHighlight);

  // Legend: all markers + arrows/boxes/lines/ellipses that carry an id and
  // label, sorted by id. Every legend item also gets a numbered badge.
  const legendItems = [
    ...validMarkers,
    ...validArrows.filter(hasLegendEntry),
    ...validBoxes.filter(hasLegendEntry),
    ...validLines.filter(hasLegendEntry),
    ...validEllipses.filter(hasLegendEntry)
  ].sort(compareIds);

  // <figure>: id, classes (width-*, author classes), and --marker-color on the
  // figure itself so the legend badges inherit it too (PD4)
  const classes = ['annotated-image-container'];
  const styles = [`--marker-color: ${cssValue(options.markerColor, DEFAULTS.markerColor)};`];
  const width = typeof options.width === 'string' || typeof options.width === 'number' ? String(options.width).trim() : '';
  if (SEMANTIC_WIDTHS.includes(width)) {
    classes.push(`width-${width}`);
  } else if (width) {
    styles.push(`max-width: ${cssValue(width, '')};`);
  }
  classes.push(...safeClasses(options.class));
  const idAttr = figId ? ` id="${escapeHtml(figId)}"` : '';
  const escapedCaption = escapeHtml(caption);

  let html = `<figure class="${classes.map(escapeHtml).join(' ')}"${idAttr} style="${styles.join(' ')}">\n`;

  // Over the picture: numbered badges (markers at their point, arrows and lines at the middle, boxes inset from their
  // top-left corner, ellipses on their outline), marker labels, the SVG shapes and the text notes
  let inner = '';
  for (const item of legendItems) {
    const scale = item.type === 'marker' && item.scale !== MARKER_SIZE.default ? ` --marker-scale: ${item.scale};` : '';
    inner += `    <span class="marker" style="left: ${item.badgeX}%; top: ${item.badgeY}%;${badgeColorStyle(item)}${scale}">${escapeHtml(String(item.id))}</span>\n`;
  }
  for (const m of validMarkers) {
    if (!m.showLabel) continue;
    const scale = m.scale !== MARKER_SIZE.default ? ` --marker-scale: ${m.scale};` : '';
    inner += `    <span class="marker-label" style="left: ${m.badgeX}%; top: ${m.badgeY}%;${scale}">${escapeHtml(m.label)}</span>\n`;
  }

  // SVG shapes layer: (editor mode) redactions, then highlights, then boxes and ellipses, then lines and arrows
  const editorRedactions = ctx.editor ? redactRects : [];
  if (validArrows.length || validBoxes.length || validLines.length || validEllipses.length || validHighlights.length || editorRedactions.length) {
    const { defs, markerIdFor } = generateArrowheadDefs(validArrows, blockKey);
    inner += `    <svg class="annotation-shapes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">\n`;
    inner += defs;
    inner += generateRedactionsSvg(editorRedactions);
    inner += generateHighlightsSvg(validHighlights);
    inner += generateBoxesSvg(validBoxes);
    inner += generateEllipsesSvg(validEllipses);
    inner += generateLinesSvg(validLines);
    inner += generateArrowsSvg(validArrows, markerIdFor);
    inner += `    </svg>\n`;
  }

  // Text overlays (HTML, above the SVG layer)
  inner += generateTextHtml(validTexts);

  const imgTag = (style) => wrapInLink(`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${style ? ` style="${escapeHtml(style)}"` : ''}>`, options.link);
  if (placeholder) {
    // Fail closed: no picture, no shapes over it (the caption and the legend stay)
    html += `  <div class="image-wrapper redaction-placeholder" role="img" aria-label="${REDACTION_PLACEHOLDER}" ` +
      `style="display: inline-block; max-width: 100%; padding: 3rem 2rem; background: #d0d0d0; color: #333333; border: 1px dashed #666666;">` +
      `${REDACTION_PLACEHOLDER}</div>\n`;
  } else if (!edited) {
    html += `  <div class="image-wrapper">\n`;
    html += `    ${imgTag('')}\n`;
    html += inner;
    html += `  </div>\n`;
  } else {
    const turned = keys.rotate === 90 || keys.rotate === 270;
    // FIX-CF (R-258): `height` with a crop gives the picture a box of its own; `crop-fit` says how the shown part fills it
    const boxHeight = keys.crop ? parseBoxHeight(options.height) : '';
    const fit = CROP_FITS.includes(options['crop-fit']) ? options['crop-fit'] : 'cover';
    const size = (turned || boxHeight) && typeof env.pictureSize === 'function' ? env.pictureSize(imagePath) : null;
    const picture = pictureMarkup({
      img: imgTag(''), imgWith: imgTag, keys, size, inner, indent: '    ', windowClass: 'image-wrapper image-window',
      box: boxHeight ? { height: boxHeight, fit } : undefined
    });
    html += picture.windowed ? picture.html : `  <div class="image-wrapper">\n${picture.html}  </div>\n`;
  }

  // Render caption if present
  if (caption && figureNumber) {
    html += `  <figcaption>Figure <span class="fig-num">${figureNumber}</span>: ${escapedCaption}</figcaption>\n`;
  }

  // Render combined legend (`showLegend: false` hides it; the badges stay: FIX-S50, AD-FIX-S50-05)
  if (legendItems.length > 0 && options.showLegend !== false) {
    html += `  <div class="annotation-legend">\n`;
    html += `    <div class="legend-grid" style="--legend-columns: ${legendColumns};">\n`;

    for (const item of legendItems) {
      const numStyle = item.type === 'marker' ? '' : ` style="${badgeColorStyle(item).trim()}"`;
      html += `      <div class="legend-item">\n`;
      html += `        <span class="legend-num"${numStyle}>${escapeHtml(String(item.id))}</span>\n`;
      html += `        <span class="legend-text">${escapeHtml(item.label)}</span>\n`;
      html += `      </div>\n`;
    }

    html += `    </div>\n`;
    html += `  </div>\n`;
  }

  html += `</figure>\n`;

  return html;
}

/**
 * The shapes a % crop hides entirely (C13, R-249: they stay in the YAML, hidden by the window, and are flagged).
 * Only valid shapes count, as drawn; a shape touching the shown area is not hidden. Unknown (null) when the crop or
 * shift is not in % (the browser alone knows the sizes then) or there is no crop.
 * @param {object} data - Normalised annotation data (options plus shape lists)
 * @returns {Array<{list: string, index: number}>|null}
 */
export function shapesHiddenByCrop(data) {
  const area = visibleArea(readPictureKeys((data && data.options) || {}));
  if (!area) return null;
  const outside = (x0, y0, x1, y1) => x1 < area.x0 || x0 > area.x1 || y1 < area.y0 || y0 > area.y1;
  const lists = {
    markers: [isValidMarker, (m) => [m.x, m.y, m.x, m.y]],
    text: [isValidText, (t) => [t.x, t.y, t.x, t.y]],
    arrows: [isValidArrow, (a) => [Math.min(a.x1, a.x2), Math.min(a.y1, a.y2), Math.max(a.x1, a.x2), Math.max(a.y1, a.y2)]],
    lines: [isValidLine, (a) => [Math.min(a.x1, a.x2), Math.min(a.y1, a.y2), Math.max(a.x1, a.x2), Math.max(a.y1, a.y2)]],
    boxes: [isValidBox, (b) => [b.x, b.y, b.x + b.width, b.y + b.height]],
    ellipses: [isValidEllipse, (b) => [b.x, b.y, b.x + b.width, b.y + b.height]],
    highlights: [isValidHighlight, (b) => [b.x, b.y, b.x + b.width, b.y + b.height]]
  };
  const hidden = [];
  for (const [list, [valid, box]] of Object.entries(lists)) {
    toArray(data[list]).forEach((shape, index) => {
      if (valid(shape) && outside(...box(shape))) hidden.push({ list, index });
    });
  }
  return hidden;
}

/**
 * Annotated Image Plugin
 * Uses custom block rule to capture raw YAML content
 *
 * @param {object} md - markdown-it instance
 * @returns {void}
 */
export function annotatedImagePlugin(md) {
  useFigureNumbering(md);

  // Block rule to capture ::: annotated-image ... ::: blocks
  md.block.ruler.before('fence', 'annotated_image', (state, startLine, endLine, silent) => {
    const startPos = state.bMarks[startLine] + state.tShift[startLine];
    const startMax = state.eMarks[startLine];
    const startLineText = state.src.slice(startPos, startMax);

    // Check for opening fence
    const openMatch = startLineText.match(OPEN_REGEX);
    if (!openMatch) return false;

    if (silent) return true;

    const imagePath = openMatch[1].trim();

    // Find closing fence and collect content
    let nextLine = startLine + 1;
    let contentLines = [];
    let foundClose = false;

    while (nextLine < endLine) {
      // Use bMarks only (not + tShift) to preserve indentation for YAML
      const linePos = state.bMarks[nextLine];
      const lineMax = state.eMarks[nextLine];
      const lineText = state.src.slice(linePos, lineMax);

      // Check for closing fence (trimmed to handle any indentation)
      if (CLOSE_REGEX.test(lineText.trim())) {
        foundClose = true;
        break;
      }

      contentLines.push(lineText);
      nextLine++;
    }

    if (!foundClose) {
      // No closing fence found, don't match
      return false;
    }

    // Create token. The YAML is parsed once, here, so the figure numbering
    // pass can see the caption and callers never parse it a second time.
    const token = state.push('annotated_image', 'figure', 0);
    token.content = contentLines.join('\n');
    const { error, ...data } = parseYamlContent(token.content);
    token.meta = { imagePath, data };
    // A YAML error renders an empty figure; the message lets an editor say why
    // without reading the YAML a second time (C2, A1)
    if (error) token.meta.yamlError = error;
    token.map = [startLine, nextLine + 1];

    state.line = nextLine + 1;
    return true;
  });

  // Renderer for annotated_image token
  md.renderer.rules.annotated_image = (tokens, idx, _options, env) => {
    const token = tokens[idx];
    const meta = token.meta || {};
    const imagePath = meta.imagePath;
    const data = meta.data || parseYamlContent(token.content);
    const figureNumber = meta.figureNumber || null;
    return generateHtml(imagePath, data, figureNumber, `${imagePath}\n${token.content}`, { editor: isEditor(md), env: env || {} });
  };
}

/**
 * The CSS the annotated-image HTML needs to be read correctly, whatever the
 * theme (phase P4, D18): the image wrapper is the positioning frame, and the
 * shapes, text notes and numbered markers sit on top of the image at their
 * coordinates. Part of the item's HTML contract (`structuralCss`), so an
 * editor's plain Draft view can place markers without pagemd's theme.
 *
 * pagemd's styles/base.css holds the same declarations (with the rest of the
 * look: margins, fonts, shadows, the legend); pagemd's
 * tests/integration/structural-css.test.js fails if one of these is not there.
 * Besides positions, a marker keeps its badge size, round shape and colors:
 * its number is white, so without them it could not be seen.
 */
export const ANNOTATED_IMAGE_STRUCTURAL_CSS = `.annotated-image-container {
  overflow: visible;
}
.image-wrapper {
  position: relative;
  display: inline-block;
  max-width: 100%;
}
.image-wrapper img {
  display: block;
  max-width: 100%;
  height: auto;
}
.annotation-shapes {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}
.annotation-text {
  position: absolute;
  white-space: nowrap;
  pointer-events: none;
  z-index: 8;
}
.marker {
  position: absolute;
  transform: translate(-50%, -50%);
  width: var(--marker-size, 1.4rem);
  height: var(--marker-size, 1.4rem);
  min-width: var(--marker-size, 1.4rem);
  border-radius: 50%;
  background-color: var(--marker-color, #cc0000);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 10;
}
`;

/** Parameter shapes for the Inspector (A6) */
const COORD = { type: 'number', min: 0, max: 100, help: '% of the image (0-100)' };
const STROKE = { key: 'strokeWidth', type: 'number', label: 'Line width', default: DEFAULTS.strokeWidth, min: 0, max: LIMITS.strokeWidth, help: 'Pixels' };
const LEGEND_ID = { key: 'id', type: 'string', label: 'Number', help: 'Badge number; with a label, adds a legend entry' };
const LEGEND_LABEL = { key: 'label', type: 'string', label: 'Label', help: 'Legend text' };
const at = (key, label) => ({ key, label, ...COORD });
/** The picture keys an annotated image shares with FIGURE (C13, R-248, R-249) */
const CROP_HELP = '% of the picture shown (0-100), or a CSS length (e.g. 300px, 12em)';
const POS_HELP = 'Moves the picture under the crop: % of the picture, or a CSS length (negative: left / up)';
export const PICTURE_FIELDS = Object.freeze([
  { key: 'crop-x', type: 'string', label: 'Crop width', help: CROP_HELP },
  { key: 'crop-y', type: 'string', label: 'Crop height', help: CROP_HELP },
  { key: 'pos-x', type: 'string', label: 'Shift left/right', help: POS_HELP },
  { key: 'pos-y', type: 'string', label: 'Shift up/down', help: POS_HELP },
  { key: 'height', type: 'string', label: 'Box height', help: 'With a crop in %: the height of the picture\'s box (a CSS length such as 300px); Crop fit decides how the cropped part fills it' },
  { key: 'crop-fit', type: 'enum', label: 'Crop fit', values: ['cover', 'contain', 'fill', 'scale-down'] },
  { key: 'rotate', type: 'enum', label: 'Rotate', values: ['0', '90', '180', '270'], default: '0', help: 'Clockwise, in degrees' },
  { key: 'flip', type: 'enum', label: 'Flip', values: ['h', 'v', 'hv'], help: 'h: left-right, v: top-bottom, hv: both' }
]);

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'annotated-image',
  group: 'media',
  read(md) {
    annotatedImagePlugin(md);
  },
  write: writeAnnotatedImage,
  structuralCss: ANNOTATED_IMAGE_STRUCTURAL_CSS,
  htmlContract: [
    '<figure class="annotated-image-container [width-{width}] [{class}]" id="{id}" style="--marker-color: …; [max-width: {width}]"><div class="image-wrapper">[<a href="{link}">]<img src="{src}" alt="{alt}">[</a>]<span class="marker" style="left: …; top: …;[ --marker-color: {shape color}][ --marker-scale: {size}]">N</span>[<span class="marker-label" style="left: …; top: …;">{label}</span>]<svg class="annotation-shapes">[{redactions, editor mode}]{highlights}{boxes}{ellipses}{lines}{arrows}</svg><span class="annotation-text">…</span></div><figcaption>Figure <span class="fig-num">N</span>: {caption}</figcaption><div class="annotation-legend">…</div></figure>',
    // A crop (C13): the picture and everything over it in a frame, clipped by the window
    '<div class="image-crop" style="container-type: inline-size;"><div class="image-wrapper image-window" style="…"><div class="image-frame" style="…">{picture}{badges}{shapes}{notes}</div></div></div>',
    // A 90°/270° turn with the picture\'s size known (C13): the box has the turned shape
    '<div class="image-turn" style="…"><img src="{src}" alt="{alt}" style="…"></div>',
    // A redaction in render mode without the caller\'s blacked-out copy (fail closed, C13)
    '<div class="image-wrapper redaction-placeholder" role="img" aria-label="Redacted picture not prepared">Redacted picture not prepared</div>'
  ],
  params: [
    { key: 'src', type: 'path', label: 'Image', help: 'Image path after "::: annotated-image"' },
    {
      key: 'options', type: 'object', label: 'Options',
      fields: [
        { key: 'caption', type: 'string', label: 'Caption', help: 'Numbered "Figure N" only when present' },
        { key: 'id', type: 'string', label: 'ID', help: 'For cross-references' },
        { key: 'alt', type: 'string', label: 'Alt text', help: 'Defaults to the caption' },
        { key: 'width', type: 'string', label: 'Width', help: 'full | half | third | quarter, or a CSS length' },
        { key: 'link', type: 'string', label: 'Link', help: 'URL to wrap the image in' },
        { key: 'class', type: 'string', label: 'CSS classes', help: 'Space-separated' },
        { key: 'markerColor', type: 'color', label: 'Marker color', default: DEFAULTS.markerColor },
        { key: 'legendColumns', type: 'number', label: 'Legend columns', default: DEFAULTS.legendColumns, min: 1, max: LIMITS.legendColumns },
        ...PICTURE_FIELDS,
        { key: 'showLegend', type: 'boolean', label: 'Show legend', default: true, help: 'Off hides the legend under the picture (the numbered badges stay)' },
        { key: 'showLabels', type: 'boolean', label: 'Show labels', default: false, help: 'Every marker\'s label beside its badge on the picture' }
      ]
    },
    {
      key: 'markers', type: 'list', label: 'Markers',
      fields: [
        { ...LEGEND_ID, required: true }, at('x', 'X'), at('y', 'Y'), { ...LEGEND_LABEL, required: true },
        { key: 'size', type: 'number', label: 'Size', default: MARKER_SIZE.default, min: MARKER_SIZE.min, max: MARKER_SIZE.max, help: 'Times the theme\'s badge size' },
        { key: 'showLabel', type: 'boolean', label: 'Show label', default: false, help: 'The label beside the badge on the picture' }
      ]
    },
    {
      key: 'arrows', type: 'list', label: 'Arrows',
      fields: [
        LEGEND_ID, at('x1', 'Start X'), at('y1', 'Start Y'), at('x2', 'End X'), at('y2', 'End Y'), LEGEND_LABEL,
        { key: 'color', type: 'color', label: 'Color', default: DEFAULTS.arrowColor }, STROKE
      ]
    },
    {
      key: 'boxes', type: 'list', label: 'Boxes',
      fields: [
        LEGEND_ID, at('x', 'X'), at('y', 'Y'), at('width', 'Width'), at('height', 'Height'), LEGEND_LABEL,
        { key: 'color', type: 'color', label: 'Color', default: DEFAULTS.boxColor },
        { key: 'fill', type: 'color', label: 'Fill', default: DEFAULTS.boxFill }, STROKE
      ]
    },
    {
      key: 'text', type: 'list', label: 'Text',
      fields: [
        at('x', 'X'), at('y', 'Y'),
        { key: 'text', type: 'string', label: 'Text', required: true, help: 'A line break starts a new line' },
        { key: 'fontSize', type: 'number', label: 'Font size', default: DEFAULTS.fontSize, min: 0, max: LIMITS.fontSize, help: 'Pixels' },
        { key: 'color', type: 'color', label: 'Color', default: DEFAULTS.textColor },
        { key: 'background', type: 'color', label: 'Background' }
      ]
    },
    {
      key: 'lines', type: 'list', label: 'Lines',
      fields: [
        LEGEND_ID, at('x1', 'Start X'), at('y1', 'Start Y'), at('x2', 'End X'), at('y2', 'End Y'), LEGEND_LABEL,
        { key: 'color', type: 'color', label: 'Color', default: DEFAULTS.lineColor }, STROKE,
        { key: 'dashed', type: 'boolean', label: 'Dashed', default: false }
      ]
    },
    {
      key: 'ellipses', type: 'list', label: 'Ellipses',
      fields: [
        LEGEND_ID, at('x', 'X'), at('y', 'Y'), at('width', 'Width'), at('height', 'Height'), LEGEND_LABEL,
        { key: 'color', type: 'color', label: 'Color', default: DEFAULTS.ellipseColor },
        { key: 'fill', type: 'color', label: 'Fill', default: DEFAULTS.ellipseFill }, STROKE
      ]
    },
    {
      key: 'highlights', type: 'list', label: 'Highlights',
      fields: [
        at('x', 'X'), at('y', 'Y'), at('width', 'Width'), at('height', 'Height'),
        { key: 'color', type: 'color', label: 'Color', default: DEFAULTS.highlightColor },
        { key: 'opacity', type: 'number', label: 'Opacity', default: DEFAULTS.highlightOpacity, min: 0, max: 1 }
      ]
    },
    {
      key: 'redact', type: 'list', label: 'Redactions',
      help: 'Blacked out in pagemd\'s output (provisional, OQ-61); the picture file itself is not changed',
      fields: [at('x', 'X'), at('y', 'Y'), at('width', 'Width'), at('height', 'Height')]
    }
  ]
};
