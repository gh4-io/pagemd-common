/**
 * Level `assets`: the images the document shows (ADR-0017; image-editor inventory B2, B4, B5, PD17), every form
 * @pagemd/syntax's `listImageRefs` knows (markdown images, FIGURE, annotated images, `![[embeds]]`, `<img>`).
 * - an image file that isn't there (relative to the document's folder) → warning (the PDF shows a broken image)
 * - a path starting with `/` → part of the same message: it is read from the root of the disk
 * - a format the PDF can't show (bmp, tif, tiff, avif, heic, heif) → warning
 * Web links, `data:` images and paths with `${…}` tokens are not checked.
 */

import { listImageRefs } from '@pagemd/syntax';
import { diagnostic } from '../diagnostic.js';

const PDF_CANT_SHOW = new Set(['bmp', 'tif', 'tiff', 'avif', 'heic', 'heif']);

/** @returns {Generator<object, import('../diagnostic.js').Diagnostic[]>} */
export default function* assets(ctx) {
  const out = [];
  const { P } = ctx;
  const docDir = ctx.input.path ? P.dirname(ctx.input.path) : null;
  const seen = new Set();

  for (const ref of listImageRefs(ctx.tokens())) {
    const src = ref.src;
    if (/^(https?:|data:|\/\/|blob:)/i.test(src) || src.includes('${')) continue;
    const key = `${src}@${ref.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const line = ref.line ?? undefined;

    const clean = src.split(/[?#]/)[0];
    const ext = P.extname(clean).slice(1).toLowerCase();
    if (PDF_CANT_SHOW.has(ext)) {
      out.push(diagnostic('warning', 'assets', 'image-format', `Image ${src}: the PDF can't show .${ext} images (use png, jpg, gif, svg or webp)`, { line }));
    }
    if (!docDir && !P.isAbsolute(clean)) continue;
    const target = P.isAbsolute(clean) ? clean : P.resolve(docDir, clean);
    if (!(yield* ctx.exists(target))) {
      const rooted = clean.startsWith('/') ? ' (a path starting with / is read from the root of the disk; leave the / out to start from the document\'s folder)' : '';
      out.push(diagnostic('warning', 'assets', 'image-not-found', `Image not found: ${src}${rooted}`, { line }));
    }
  }
  return out;
}
