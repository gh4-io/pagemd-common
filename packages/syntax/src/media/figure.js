/**
 * Figures: <!-- ::FIGURE src="…" caption="…" … --> (and the legacy form with
 * the image on the next line). Captioned figures share one document-order
 * counter with annotated images (./figure-numbers.js); a figure without a
 * caption gets no number and no <figcaption>.
 *
 * Readable style (pagemd-editor "readable figures", R-253): `![alt](src "caption")` on its own line, and under it (no blank line)
 * `<!-- ::FIGURE id="…" width="…" -->`, which holds only what plain markdown cannot. The comment attaches to that picture
 * the way `::TABLE` attaches to its table. The title is the caption; a `caption=` in the comment wins. A bare
 * `<!-- ::FIGURE -->` there makes a numbered figure of a titled picture. All older forms are read for ever.
 *
 * Since pagemd-editor C13 (R-249): `rotate="0|90|180|270"`, `flip="h|v|hv"`, and crop-x / crop-y in any CSS length
 * (not only %). A crop in % only, on a picture that is not turned or flipped, keeps its `object-view-box` drawing
 * exactly as before; any other crop is drawn with a window, and turns and flips as on an annotated image (./picture.js).
 */

import { useFigureNumbering } from './figure-numbers.js';
import { writeFigure } from './figure-write.js';
import { parseBoxHeight, parseCropValue, pictureMarkup, readPictureKeys } from './picture.js';

/**
 * Crop edge as a CSS percentage: 100 - value, without float noise
 * (crop values may be decimals, e.g. 33.3 -> 66.7).
 * @param {string} value - Validated crop value (0-100)
 * @returns {number}
 */
function cropInset(value) {
  return Number((100 - parseFloat(value)).toFixed(4));
}

/**
 * Parse figure directive attributes
 * Handles: key="value with spaces" key='value' key=value
 * @param {string} attrString - The attribute string to parse
 * @returns {Object} Parsed attributes
 */
function parseFigureAttributes(attrString) {
  const attrs = {};
  if (!attrString) return attrs;

  // Match key="value" (double quotes) or key='value' (single quotes) or key=value (no quotes)
  // Order matters: try quoted patterns first, then unquoted
  // Use [\w-]+ to support hyphenated attribute names like crop-fit, crop-x, crop-y
  const attrRegex = /([\w-]+)=(?:"([^"]+)"|'([^']+)'|(\S+))/g;
  let match;

  while ((match = attrRegex.exec(attrString)) !== null) {
    // match[2] = double-quoted, match[3] = single-quoted, match[4] = unquoted
    attrs[match[1]] = match[2] || match[3] || match[4];
  }

  return attrs;
}

/**
 * Validate CSS length values (e.g., "300px", "-100px", "0", "50vh", "80%", "auto")
 * @param {string} value - The CSS length value to validate
 * @returns {string} Valid value or empty string if invalid
 */
function validateCSSLength(value) {
  if (!value) return '';
  // Accept: unitless zero, number + unit, or "auto"
  // Unitless zero: -?0(.0*)?
  // Number with unit: -?\d+\.?\d* followed by px|em|rem|vh|vw|%
  const valid = /^-?0(\.0*)?$|^(-?\d+\.?\d*)(px|em|rem|vh|vw|%)$|^auto$/i.test(value.trim());
  return valid ? value.trim() : '';
}

/**
 * A picture on its own line: `![alt](src "title")`, nothing else on it (no `{…}`, not a `![[embed]]`).
 * The readable style's picture (R-253): a FIGURE comment right under it belongs to it.
 */
const IMAGE_LINE = /^!\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^<>\n]*>|[^\s()<>]+)(?:\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))?\s*\)$/;

/**
 * The lone picture paragraph that ends right where a FIGURE comment starts (the readable style, R-253): the
 * comment under a picture attaches to it, like `::TABLE` under its table. Null when the block above is anything else.
 * @param {object} state - markdown-it block state
 * @param {number} startLine - The comment's line
 * @returns {{alt: string, src: string, title: string, line: string, start: number}|null}
 */
function pictureAbove(state, startLine) {
  const t = state.tokens;
  const n = t.length;
  if (n < 3) return null;
  const [open, inline, close] = [t[n - 3], t[n - 2], t[n - 1]];
  if (open.type !== 'paragraph_open' || inline.type !== 'inline' || close.type !== 'paragraph_close') return null;
  if (!open.map || open.map[1] !== startLine || open.level !== state.level || open.hidden || (open.attrs && open.attrs.length)) return null;
  const m = IMAGE_LINE.exec(inline.content);
  if (!m) return null;
  const { unescapeAll } = state.md.utils;
  const dest = m[2].startsWith('<') ? m[2].slice(1, -1) : m[2];
  const title = m[3] ? unescapeAll(m[3].slice(1, -1)) : '';
  return { alt: unescapeAll(m[1]), src: dest, title, line: inline.content, start: open.map[0] };
}

/**
 * Figure plugin for <!-- ::FIGURE ... --> syntax
 * Supports: caption, src, id, width, height, crop parameters, alt, loading, link
 * Captioned figures are numbered in document order (shared with annotated images)
 *
 * Usage:
 *   <!-- ::FIGURE src="image.png" caption="Description" id="fig-1" width="full" height="400px" crop-fit="cover" -->
 *   OR (legacy, backward compatible):
 *   <!-- ::FIGURE caption="Description" -->
 *   ![Alt](image.png)
 *
 * @param {MarkdownIt} md - Markdown-it instance
 */
export function figurePlugin(md) {
  useFigureNumbering(md);

  // HTML block rule for figure comments
  md.block.ruler.before('html_block', 'figure_comment', (state, startLine, endLine, silent) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const lineText = state.src.slice(pos, max);

    // Match <!-- ::FIGURE ... --> (flexible attribute order)
    const directiveMatch = lineText.match(/^<!--\s*::FIGURE(?:\s+(.+?))?\s*-->$/);
    if (!directiveMatch) return false;

    const params = directiveMatch[1] || '';
    const written = parseFigureAttributes(params);
    // Readable style (R-253): a comment with no `src`, right under a lone picture line, belongs to that picture. A bare
    // `<!-- ::FIGURE -->` means something only there.
    const above = written.src ? null : pictureAbove(state, startLine);
    if (!params && !above) return false;

    if (silent) return true;

    const attrs = above ? { ...written, src: above.src } : written;
    if (above) {
      // The comment's own caption (and alt) win over the picture's title (and alt): documented, R-253.
      if (!attrs.alt && above.alt) attrs.alt = above.alt;
      if (!attrs.caption && above.title) attrs.caption = above.title;
      state.tokens.splice(-3, 3);
    }
    const caption = attrs.caption || '';
    const src = attrs.src || '';
    const figId = attrs.id || '';
    const width = attrs.width || '';
    const height = validateCSSLength(attrs.height || '');

    // Extract crop parameters
    const rawCropFit = attrs['crop-fit'] || '';
    const rawCropX = attrs['crop-x'] || '';
    const rawCropY = attrs['crop-y'] || '';

    // Validate crop-x and crop-y: must be 0-100 (percentage). A CSS length (C13) is not a percentage: it is
    // drawn with a window, below
    const validateCropPosition = (val) => {
      if (val && parseCropValue(val) && 'length' in parseCropValue(val)) return '';
      const num = parseFloat(val);
      return !isNaN(num) && num >= 0 && num <= 100 ? String(num) : '';
    };
    const cropX = validateCropPosition(rawCropX);
    const cropY = validateCropPosition(rawCropY);

    // C13: turn, flip, and a crop that is not in % only: drawn as an annotated image draws them (./picture.js). An
    // old crop in % only, not turned or flipped, keeps the object-view-box drawing below, byte for byte.
    const picture = src ? readPictureKeys(attrs) : null;
    const newDrawing = !!picture && (picture.rotate !== 0 || picture.flip !== '' || (picture.crop && !picture.percentOnly));

    // Validate crop-fit: must be one of cover, contain, fill, scale-down
    const validCropFits = ['cover', 'contain', 'fill', 'scale-down'];
    const explicitCropFit = validCropFits.includes(rawCropFit) ? rawCropFit : '';
    let cropFit = explicitCropFit;

    // Auto-default crop-fit to "cover" for CSS hook (--crop-fit on figure)
    // but NOT applied as object-fit on img (would scale cropped content back up)
    if (!cropFit && (cropX || cropY)) {
      cropFit = 'cover';
    }

    // Extract position parameters (for shifting image within viewport)
    const rawPosX = attrs['pos-x'] || '';
    const rawPosY = attrs['pos-y'] || '';

    // Validate pos-x and pos-y: CSS length values (px, %, em, rem, etc.) or negative values
    const posX = validateCSSLength(rawPosX);
    const posY = validateCSSLength(rawPosY);

    // Determine if any crop params are set (for conditional rendering)
    const hasCrop = cropFit || cropX || cropY || (newDrawing && picture.crop);

    // Extract accessibility and enhancement parameters
    // alt: separate alt text (falls back to caption if not provided)
    const alt = attrs.alt || caption;

    // loading: lazy loading support (lazy or eager, validated)
    const rawLoading = attrs.loading || '';
    const validLoadingValues = ['lazy', 'eager'];
    const loading = validLoadingValues.includes(rawLoading) ? rawLoading : '';

    // link: wrap image in anchor tag
    const link = attrs.link || '';

    // Look ahead for the next line (legacy: image on next line if no src)
    let nextLine = startLine + 1;
    let imageMarkdown = '';

    if (!src && nextLine < endLine) {
      const nextPos = state.bMarks[nextLine] + state.tShift[nextLine];
      const nextMax = state.eMarks[nextLine];
      imageMarkdown = state.src.slice(nextPos, nextMax).trim();
    }

    // Legacy form: the image line is consumed only when it is an image
    const legacy = !src && !!imageMarkdown && (imageMarkdown.startsWith('![[') || imageMarkdown.startsWith('!['));
    const lines = [above ? above.start : startLine, legacy ? nextLine + 1 : nextLine];

    // Create tokens
    const token_open = state.push('figure_open', 'figure', 1);
    token_open.markup = '<!-- ::FIGURE -->';
    token_open.map = lines;
    token_open.meta = {
      raw: params,                   // the parameters as written (C2)
      attrs,                         // the same, parsed, before validation (C2)
      legacy,                        // image on the next line (C2)
      image: legacy ? imageMarkdown : above ? above.line : '',
      form: above ? 'after' : undefined,  // R-253: the comment is under its picture, which is the line above it
      imageRead: above ? { alt: above.alt, src: above.src, title: above.title } : undefined,
      caption: caption,
      id: figId,
      width: width,
      height: height,
      cropFit: cropFit,
      explicitCropFit: explicitCropFit,
      cropX: cropX,
      cropY: cropY,
      posX: posX,
      posY: posY,
      hasCrop: hasCrop
    };
    if (newDrawing) token_open.meta.picture = picture;
    // FIX-CF (R-258): a crop (or a crop-fit) with a `height` gives the picture a box of its own; crop-fit says how the shown part fills it
    const boxHeight = hasCrop && picture ? parseBoxHeight(attrs.height) : '';

    // If src is provided in directive, create image token
    if (src) {
      const img_token = state.push('figure_image', 'img', 0);
      img_token.map = lines;
      img_token.meta = {
        src: src,
        alt: alt,           // Uses alt param or falls back to caption
        cropFit: cropFit,
        explicitCropFit: explicitCropFit,
        cropX: cropX,
        cropY: cropY,
        posX: posX,
        posY: posY,
        hasCrop: hasCrop,
        loading: loading,   // lazy/eager loading
        link: link          // URL to wrap image in anchor
      };
      if (newDrawing) img_token.meta.picture = picture;
      if (boxHeight) {
        img_token.meta.box = { height: boxHeight, fit: cropFit || 'cover' };
        img_token.meta.pictureKeys = picture;
      }
    } else if (imageMarkdown && (imageMarkdown.startsWith('![[') || imageMarkdown.startsWith('!['))) {
      // Legacy: image on next line
      const inline_token = state.push('inline', '', 0);
      inline_token.map = lines;
      inline_token.content = imageMarkdown;
      inline_token.children = [];
      nextLine++;
    }

    // No caption, no number and no <figcaption> (PD2); the number itself is
    // filled in by the document-order pass (figure-numbers.js)
    if (caption) {
      const caption_token = state.push('figcaption', 'figcaption', 0);
      caption_token.map = lines;
      caption_token.content = caption;
      caption_token.meta = { caption };
    }

    state.push('figure_close', 'figure', -1);

    state.line = nextLine;
    return true;
  });

  // Renderers
  md.renderer.rules.figure_open = (tokens, idx) => {
    const meta = tokens[idx].meta || {};
    const attrs = [];
    const styles = [];

    if (meta.id) attrs.push(`id="${md.utils.escapeHtml(meta.id)}"`);

    // Width: Use class for semantic names, inline style for CSS values
    if (meta.width) {
      const semanticWidths = ['full', 'half', 'third', 'quarter'];
      if (semanticWidths.includes(meta.width)) {
        attrs.push(`class="width-${md.utils.escapeHtml(meta.width)}"`);
      } else {
        styles.push(`max-width: ${md.utils.escapeHtml(meta.width)}`);
      }
    }

    // Viewport model: crop-x/crop-y control what portion of image to show
    // Let CSS handle the actual cropping and sizing
    if (meta.picture) {
      // C13: the crop, turn and flip are drawn around the image (figure_image); only crop-fit stays a CSS hook here
      if (meta.picture.crop && meta.explicitCropFit) styles.push(`--crop-fit: ${md.utils.escapeHtml(meta.explicitCropFit)}`);
    } else if (meta.hasCrop) {
      // Add crop markers for CSS targeting
      if (meta.cropFit) styles.push(`--crop-fit: ${md.utils.escapeHtml(meta.cropFit)}`);

      // Set custom properties for CSS to use - NO fixed dimensions on figure
      if (meta.cropY) {
        styles.push(`--crop-y: ${md.utils.escapeHtml(meta.cropY)}%`);
      }
      if (meta.cropX) {
        styles.push(`--crop-x: ${md.utils.escapeHtml(meta.cropX)}%`);
      }
    } else if (meta.height) {
      // No crop - just explicit height
      styles.push(`height: ${md.utils.escapeHtml(meta.height)}`);
    }

    if (styles.length > 0) {
      attrs.push(`style="${styles.join('; ')}"`);
    }

    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    return `<figure${attrStr}>`;
  };

  md.renderer.rules.figure_close = () => '</figure>';

  md.renderer.rules.figure_image = (tokens, idx, _options, env) => {
    const meta = tokens[idx].meta || {};
    const src = md.utils.escapeHtml(meta.src || '');
    const alt = md.utils.escapeHtml(meta.alt || '');

    // FIX-CF: the box with its own shape (needs the picture's size; without it the old drawing below, whose img takes the
    // box's height)
    if (meta.box && meta.pictureKeys) {
      const boxSize = env && typeof env.pictureSize === 'function' ? env.pictureSize(meta.src) : null;
      const imgWith = (style) => {
        const parts = [`src="${src}"`, `alt="${alt}"`];
        if (meta.loading) parts.push(`loading="${md.utils.escapeHtml(meta.loading)}"`);
        if (style) parts.push(`style="${md.utils.escapeHtml(style)}"`);
        return linkWrap(md, `<img ${parts.join(' ')}>`, meta.link);
      };
      const boxed = pictureMarkup({ img: imgWith(''), imgWith, keys: meta.pictureKeys, size: boxSize, box: meta.box });
      if (boxed.boxed) return boxed.html.replace(/\n$/, '');
    }

    // C13: a turn, a flip or a crop in another unit than %: the annotated image's drawing (./picture.js)
    if (meta.picture) {
      const imgTag = (style) => {
        const parts = [`src="${src}"`, `alt="${alt}"`];
        if (meta.loading) parts.push(`loading="${md.utils.escapeHtml(meta.loading)}"`);
        if (style) parts.push(`style="${md.utils.escapeHtml(style)}"`);
        return linkWrap(md, `<img ${parts.join(' ')}>`, meta.link);
      };
      const turned = meta.picture.rotate === 90 || meta.picture.rotate === 270;
      const size = turned && env && typeof env.pictureSize === 'function' ? env.pictureSize(meta.src) : null;
      return pictureMarkup({ img: imgTag(''), imgWith: imgTag, keys: meta.picture, size }).html.replace(/\n$/, '');
    }

    // Build image attributes
    const imgAttrs = [`src="${src}"`, `alt="${alt}"`];

    // Add loading attribute (lazy/eager) if specified
    if (meta.loading) {
      imgAttrs.push(`loading="${md.utils.escapeHtml(meta.loading)}"`);
    }

    // Crop via CSS object-view-box: inset(top right bottom left)
    // crop-y=N means "show top N%" → bottom inset = (100-N)%
    // crop-x=N means "show left N%" → right inset = (100-N)%
    // pos-x/pos-y shift the visible region (integrated into inset calc)
    const imgStyles = [];
    if (meta.hasCrop) {
      let top = '0%', right = '0%', bottom = '0%', left = '0%';

      if (meta.cropY) {
        bottom = `${cropInset(meta.cropY)}%`;
      }
      if (meta.cropX) {
        right = `${cropInset(meta.cropX)}%`;
      }

      // pos-x/pos-y shift the view window (adjust inset edges)
      if (meta.posX !== '') {
        // Negative posX shifts image left → view moves right → add to left, reduce right
        left = `calc(0px - ${md.utils.escapeHtml(meta.posX)})`;
        right = meta.cropX
          ? `calc(${cropInset(meta.cropX)}% + ${md.utils.escapeHtml(meta.posX)})`
          : `calc(0px + ${md.utils.escapeHtml(meta.posX)})`;
      }
      if (meta.posY !== '') {
        top = `calc(0px - ${md.utils.escapeHtml(meta.posY)})`;
        bottom = meta.cropY
          ? `calc(${cropInset(meta.cropY)}% + ${md.utils.escapeHtml(meta.posY)})`
          : `calc(0px + ${md.utils.escapeHtml(meta.posY)})`;
      }

      imgStyles.push(`object-view-box: inset(${top} ${right} ${bottom} ${left})`);
      if (meta.box) imgStyles.push(`width: 100%; height: ${md.utils.escapeHtml(meta.box.height)}`);

      // Only apply object-fit when user explicitly set crop-fit
      // Auto-defaulted "cover" would scale cropped content back to full width
      if (meta.explicitCropFit) {
        imgStyles.push(`object-fit: ${md.utils.escapeHtml(meta.explicitCropFit)}`);
      }
    }

    if (imgStyles.length > 0) {
      imgAttrs.push(`style="${imgStyles.join('; ')}"`);
    }

    // Build the img tag
    const imgTag = `<img ${imgAttrs.join(' ')}>`;

    // Wrap in anchor if link is specified
    if (meta.link) {
      // Block dangerous URL schemes (javascript:, data:, vbscript:)
      const isDangerous = /^(javascript|data|vbscript):/i.test(meta.link.trim());
      if (isDangerous) {
        // Skip link wrapper for dangerous URLs, just return the image
        return imgTag;
      }

      const href = md.utils.escapeHtml(meta.link);
      // Check if external link (starts with http:// or https://)
      const isExternal = /^https?:\/\//i.test(meta.link);
      const linkAttrs = [`href="${href}"`];
      if (isExternal) {
        linkAttrs.push('target="_blank"', 'rel="noopener noreferrer"');
      }
      return `<a ${linkAttrs.join(' ')}>${imgTag}</a>`;
    }

    return imgTag;
  };

  /**
   * The link around a FIGURE's image (javascript:, data: and vbscript: links are dropped; http(s) opens a new tab)
   * @param {object} md
   * @param {string} imgTag
   * @param {string} link
   * @returns {string}
   */
  function linkWrap(md, imgTag, link) {
    if (!link || /^(javascript|data|vbscript):/i.test(link.trim())) return imgTag;
    const linkAttrs = [`href="${md.utils.escapeHtml(link)}"`];
    if (/^https?:\/\//i.test(link)) linkAttrs.push('target="_blank"', 'rel="noopener noreferrer"');
    return `<a ${linkAttrs.join(' ')}>${imgTag}</a>`;
  }

  md.renderer.rules.figcaption = (tokens, idx) => {
    const token = tokens[idx];
    const num = token.meta && token.meta.figureNumber ? token.meta.figureNumber : '';
    return `<figcaption>Figure <span class="fig-num">${num}</span>: ${md.utils.escapeHtml(token.content)}</figcaption>`;
  };
}

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'figure',
  group: 'media',
  read(md) {
    figurePlugin(md);
  },
  write: writeFigure,
  htmlContract: [
    '<figure id="{id}" class="width-{width}" style="…"><img src="{src}" alt="{alt}"><figcaption>Figure <span class="fig-num">N</span>: {caption}</figcaption></figure>',
    // C13: a crop in another unit than %, or a turned / flipped picture with a crop
    '<div class="image-crop" style="container-type: inline-size;"><div class="image-window" style="…"><div class="image-frame" style="…">{picture}</div></div></div>',
    // C13: a 90°/270° turn with the picture\'s size known
    '<div class="image-turn" style="…"><img src="{src}" alt="{alt}" style="…"></div>'
  ],
  params: [
    { key: 'src', type: 'path', help: 'Image path (omit for the legacy form: image on the next line)' },
    { key: 'caption', type: 'string' },
    { key: 'id', type: 'string' },
    { key: 'width', type: 'string', help: 'full | half | third | quarter, or a CSS length' },
    { key: 'height', type: 'string', help: 'CSS length. With a crop (in %) it is the height of the picture\'s box, and crop-fit decides how the cropped part fills it' },
    { key: 'crop-fit', type: 'enum', values: ['cover', 'contain', 'fill', 'scale-down'] },
    { key: 'crop-x', type: 'string', help: '0-100 (% of the image shown from the left), or a CSS length (e.g. 300px)' },
    { key: 'crop-y', type: 'string', help: '0-100 (% of the image shown from the top), or a CSS length (e.g. 12em)' },
    { key: 'pos-x', type: 'string', help: 'CSS length' },
    { key: 'pos-y', type: 'string', help: 'CSS length' },
    { key: 'rotate', type: 'enum', values: ['0', '90', '180', '270'], help: 'Clockwise, in degrees' },
    { key: 'flip', type: 'enum', values: ['h', 'v', 'hv'], help: 'h: left-right, v: top-bottom, hv: both' },
    { key: 'alt', type: 'string', help: 'Defaults to the caption' },
    { key: 'loading', type: 'enum', values: ['lazy', 'eager'] },
    { key: 'link', type: 'string', help: 'URL to wrap the image in' }
  ]
};
