/**
 * pagemd-editor phase C13: picture keys (R-248 to R-251, ADR-0019).
 * Each test names its control: the change to the code that makes it fail (proven in the phase's As built).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDialect, items, structuralCssFor, writeAnnotatedImage, writeFigure, readPictureSize, displayedRectToNatural,
  parseCropValue, parsePosValue, normalizeRotate, normalizeFlip, markerScale, readRedactions, redactionKey,
  listPictureEdits, shapesHiddenByCrop, readPictureKeys, visibleArea, itemOccurrences
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => new Uint8Array(readFileSync(join(here, 'fixtures', 'pictures', name)));
const render = (text, env) => createDialect().render(text, env);
const editorRender = (text, env) => createDialect({ mode: 'editor' }).render(text, env);
const annotated = (yaml, path = 'shots/app.png') => `::: annotated-image ${path}\n${yaml}\n:::\n`;

/**
 * A JPEG with an EXIF orientation: an APP1 "Exif" segment put right after SOI.
 * @param {Uint8Array} jpeg
 * @param {number} orientation
 * @param {boolean} little - II (little-endian) or MM
 */
function withExif(jpeg, orientation, little) {
  const w16 = (n) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const w32 = (n) => (little ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...w16(42), ...w32(8),
    ...w16(1), ...w16(0x0112), ...w16(3), ...w32(1), ...w16(orientation), 0, 0, ...w32(0)];
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = payload.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...payload, ...jpeg.subarray(2)]);
}

describe('picture-size reader (control: the EXIF turn ignored → the orientation 6 and 8 cases fail)', () => {
  it('reads PNG, JPEG, GIF and the three WebP kinds', () => {
    expect(readPictureSize(fixture('p40x20.png'))).toEqual({ type: 'png', width: 40, height: 20, orientation: 1 });
    expect(readPictureSize(fixture('j40x20.jpg'))).toEqual({ type: 'jpeg', width: 40, height: 20, orientation: 1 });
    expect(readPictureSize(fixture('g40x20.gif'))).toEqual({ type: 'gif', width: 40, height: 20, orientation: 1 });
    expect(readPictureSize(fixture('w-lossy-40x20.webp'))).toEqual({ type: 'webp', width: 40, height: 20, orientation: 1 });
    expect(readPictureSize(fixture('w-lossless-40x20.webp'))).toEqual({ type: 'webp', width: 40, height: 20, orientation: 1 });
    expect(readPictureSize(fixture('w-extended-40x20.webp'))).toEqual({ type: 'webp', width: 40, height: 20, orientation: 1 });
  });

  it('applies a JPEG\'s EXIF orientation: 5 to 8 swap width and height (both byte orders)', () => {
    const jpeg = fixture('j40x20.jpg');
    for (const little of [true, false]) {
      expect(readPictureSize(withExif(jpeg, 1, little))).toMatchObject({ width: 40, height: 20, orientation: 1 });
      expect(readPictureSize(withExif(jpeg, 3, little))).toMatchObject({ width: 40, height: 20, orientation: 3 });
      expect(readPictureSize(withExif(jpeg, 6, little))).toMatchObject({ width: 20, height: 40, orientation: 6 });
      expect(readPictureSize(withExif(jpeg, 8, little))).toMatchObject({ width: 20, height: 40, orientation: 8 });
    }
  });

  it('gives null for other files and truncated headers', () => {
    expect(readPictureSize(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(readPictureSize(fixture('p40x20.png').subarray(0, 12))).toBeNull();
    expect(readPictureSize(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(readPictureSize(new Uint8Array())).toBeNull();
  });
});

describe('picture key values', () => {
  it('crop: % (bare number or N%) from 0 to 100, or any non-negative CSS length; calc() kept as written', () => {
    expect(parseCropValue(50)).toEqual({ percent: 50 });
    expect(parseCropValue('66.5')).toEqual({ percent: 66.5 });
    expect(parseCropValue('40%')).toEqual({ percent: 40 });
    expect(parseCropValue('300px')).toEqual({ length: '300px' });
    expect(parseCropValue('12.5em')).toEqual({ length: '12.5em' });
    expect(parseCropValue('3rem')).toEqual({ length: '3rem' });
    expect(parseCropValue('calc(50% - 2px)')).toEqual({ length: 'calc(50% - 2px)' });
    for (const bad of [150, -5, '150', '-10px', 'abc', '10px;color:red', 'calc(1px);x', '', null, true]) expect(parseCropValue(bad)).toBeNull();
  });

  it('shift: a signed CSS length; a bare number is %', () => {
    expect(parsePosValue('-10%')).toBe('-10%');
    expect(parsePosValue('-40px')).toBe('-40px');
    expect(parsePosValue(-12)).toBe('-12%');
    expect(parsePosValue('7')).toBe('7%');
    expect(parsePosValue('x')).toBeNull();
  });

  it('rotate 0|90|180|270, flip h|v|hv, marker size clamped 0.5–4 (default 1)', () => {
    expect([0, 90, '180', 270, 45, '90deg', -90].map(normalizeRotate)).toEqual([0, 90, 180, 270, 0, 0, 0]);
    expect(['h', 'v', 'hv', 'vh', 'x', undefined].map(normalizeFlip)).toEqual(['h', 'v', 'hv', '', '', '']);
    expect([undefined, 2, 0.1, 9, '2'].map(markerScale)).toEqual([1, 2, 0.5, 4, 1]);
  });
});

describe('displayed → natural rectangle (control: the turn direction swapped → the 90/270 cases fail)', () => {
  // A displayed point for each turn and flip: where the natural (upright file) point (u, v) is shown
  const forward = ([u, v], rotate, flip) => {
    let a = u;
    let b = v;
    if (rotate === 90) [a, b] = [1 - b, a]; // clockwise: top-left goes to top-right
    else if (rotate === 180) [a, b] = [1 - a, 1 - b];
    else if (rotate === 270) [a, b] = [b, 1 - a];
    if (flip === 'h' || flip === 'hv') a = 1 - a;
    if (flip === 'v' || flip === 'hv') b = 1 - b;
    return [a, b];
  };
  it('undoes every turn and flip', () => {
    const natural = { x: 10, y: 5, width: 20, height: 30 };
    for (const rotate of [0, 90, 180, 270]) {
      for (const flip of ['', 'h', 'v', 'hv']) {
        const c = [[0.1, 0.05], [0.3, 0.35]].map((p) => forward(p, rotate, flip));
        const displayed = { x: Math.min(c[0][0], c[1][0]) * 100, y: Math.min(c[0][1], c[1][1]) * 100, width: Math.abs(c[1][0] - c[0][0]) * 100, height: Math.abs(c[1][1] - c[0][1]) * 100 };
        const back = displayedRectToNatural(displayed, rotate, flip);
        for (const k of ['x', 'y', 'width', 'height']) expect(back[k]).toBeCloseTo(natural[k], 6);
      }
    }
  });
  it('a 90° turn: the displayed top-right corner is the file\'s top-left', () => {
    expect(displayedRectToNatural({ x: 90, y: 0, width: 10, height: 20 }, 90, '')).toEqual({ x: 0, y: 0, width: 20, height: 10 });
  });
});

describe('old documents: no new key → the same HTML and no new CSS (control: the window markup emitted unconditionally)', () => {
  const old = annotated('options:\n  caption: "Main"\n  width: half\nmarkers:\n  - { id: 1, x: 10, y: 20, label: "Menu" }\nboxes:\n  - { id: 2, x: 5, y: 5, width: 10, height: 10, label: "Box" }');
  it('an annotated image without picture keys keeps the C9 markup', () => {
    const html = render(old);
    expect(html).toContain('  <div class="image-wrapper">\n    <img src="shots/app.png" alt="Main">\n    <span class="marker" style="left: 10%; top: 20%;">1</span>\n');
    expect(html).not.toMatch(/image-crop|image-window|image-frame|image-turn|marker-scale|marker-label|redaction/);
    expect(structuralCssFor(html)).toBe('');
  });
  it('a FIGURE crop in % only keeps object-view-box, byte for byte', () => {
    expect(render('<!-- ::FIGURE src="a.png" crop-x="66.5" crop-y="50" pos-x="-10%" -->\n')).toBe(
      '<figure style="--crop-fit: cover; --crop-y: 50%; --crop-x: 66.5%"><img src="a.png" alt="" style="object-view-box: inset(0% calc(33.5% + -10%) 50% calc(0px - -10%))"></figure>');
  });
  it('the pagemd examples that have annotated images or crops draw no new markup', () => {
    const dir = join(here, '..', '..', '..', '..', 'pagemd', 'examples', 'annotated-image');
    let files = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { /* pagemd not next to pagemd-common */ }
    for (const f of files) {
      const html = render(readFileSync(join(dir, f), 'utf8'));
      expect(html, f).not.toMatch(/image-crop|image-turn|marker-scale|marker-label|redaction-placeholder/);
    }
  });
});

describe('annotated image: crop, rotate and flip (R-248, R-249)', () => {
  it('a crop in any unit: the window holds a frame of the whole picture; shapes stay in the frame', () => {
    for (const [x, css] of [[50, 'calc-size(fit-content, size * 0.5)'], ['300px', 'calc-size(fit-content, min(size, 300px))'], ['20em', 'calc-size(fit-content, min(size, 20em))']]) {
      const html = render(annotated(`options:\n  crop-x: ${x}\n  pos-x: -10%\nmarkers:\n  - { id: 1, x: 10, y: 20, label: "A" }`));
      expect(html).toContain(`<div class="image-wrapper image-window" style="display: inline-block; position: relative; overflow: hidden; max-width: 100%; vertical-align: top; width: ${css};">`);
      expect(html).toContain('<div class="image-frame" style="position: relative; width: max-content; max-width: 100cqw; transform: translate(-10%, 0px);">');
      // The marker is inside the frame, at its % of the whole picture
      expect(html.indexOf('class="marker"')).toBeGreaterThan(html.indexOf('image-frame'));
      expect(html).toContain('<span class="marker" style="left: 10%; top: 20%;">1</span>');
    }
  });
  it('rotate 90 with the picture\'s size: a box with width and height swapped; without it, turned in place', () => {
    const doc = annotated('options:\n  rotate: 90\n  flip: h');
    const sized = render(doc, { pictureSize: (src) => (src === 'shots/app.png' ? { width: 400, height: 200 } : null) });
    expect(sized).toContain('<div class="image-turn" style="position: relative; width: 200px; max-width: 100%; aspect-ratio: 200 / 400; margin: 0 auto;">');
    expect(sized).toContain('transform: translate(-50%, -50%) scaleX(-1) rotate(90deg);');
    expect(render(doc)).toContain('<img src="shots/app.png" alt="" style="transform: scaleX(-1) rotate(90deg);">');
  });
  it('the Inspector gets the new keys (params)', () => {
    const item = items.find((i) => i.id === 'annotated-image');
    const options = item.params.find((p) => p.key === 'options').fields.map((f) => f.key);
    expect(options).toEqual(expect.arrayContaining(['crop-x', 'crop-y', 'pos-x', 'pos-y', 'crop-fit', 'rotate', 'flip', 'showLabels']));
    expect(item.params.find((p) => p.key === 'markers').fields.map((f) => f.key)).toEqual(expect.arrayContaining(['size', 'showLabel']));
    expect(item.params.find((p) => p.key === 'redact').fields.map((f) => f.key)).toEqual(['x', 'y', 'width', 'height']);
    const figure = items.find((i) => i.id === 'figure').params.map((p) => p.key);
    expect(figure).toEqual(expect.arrayContaining(['rotate', 'flip']));
  });
});

describe('FIGURE: crop in another unit, rotate, flip', () => {
  it('a crop in px uses the window', () => {
    const html = render('<!-- ::FIGURE src="a.png" crop-x="300px" caption="C" -->\n');
    expect(html).toContain('<div class="image-window" style="display: inline-block; position: relative; overflow: hidden; max-width: 100%; vertical-align: top; width: calc-size(fit-content, min(size, 300px));">');
    expect(html).not.toContain('object-view-box');
    expect(html).not.toContain('--crop-x');
  });
  it('a % crop on a flipped picture uses the window (the crop is of the displayed picture)', () => {
    const html = render('<!-- ::FIGURE src="a.png" crop-x="50" flip="h" -->\n');
    expect(html).toContain('calc-size(fit-content, size * 0.5)');
    expect(html).toContain('style="transform: scaleX(-1);"');
  });
  it('rotate and flip without a crop: a transform on the image, or a turn box when the size is known', () => {
    expect(render('<!-- ::FIGURE src="a.png" rotate="180" link="https://x.test" -->\n')).toBe(
      '<figure><a href="https://x.test" target="_blank" rel="noopener noreferrer"><img src="a.png" alt="" style="transform: rotate(180deg);"></a></figure>');
    expect(render('<!-- ::FIGURE src="a.png" rotate="270" -->\n', { pictureSize: () => ({ width: 30, height: 60 }) })).toContain('aspect-ratio: 60 / 30;');
  });
  it('writes rotate and flip in the canonical order', () => {
    expect(writeFigure({ attrs: { src: 'a.png', flip: 'h', rotate: '90', caption: 'C' } })).toBe('<!-- ::FIGURE src="a.png" caption="C" rotate="90" flip="h" -->');
  });
});

describe('marker size and label (R-250; control: --marker-scale written for size 1 → the old-document test fails)', () => {
  it('size: --marker-scale only when not 1, clamped; the CSS only when used', () => {
    const html = render(annotated('markers:\n  - { id: 1, x: 10, y: 20, label: "A", size: 2 }\n  - { id: 2, x: 30, y: 20, label: "B", size: 1 }\n  - { id: 3, x: 50, y: 20, label: "C", size: 12 }'));
    expect(html).toContain('<span class="marker" style="left: 10%; top: 20%; --marker-scale: 2;">1</span>');
    expect(html).toContain('<span class="marker" style="left: 30%; top: 20%;">2</span>');
    expect(html).toContain('--marker-scale: 4;">3</span>');
    expect(structuralCssFor(html)).toContain('scale(var(--marker-scale))');
    expect(structuralCssFor(html)).not.toContain('.marker-label');
  });
  it('showLabel per marker, options.showLabels for all (a marker can opt out)', () => {
    const one = render(annotated('markers:\n  - { id: 1, x: 10, y: 20, label: "Save", showLabel: true }\n  - { id: 2, x: 30, y: 20, label: "Open" }'));
    expect(one).toContain('<span class="marker-label" style="left: 10%; top: 20%;">Save</span>');
    expect(one).not.toContain('>Open</span>\n    <span class="marker-label"');
    expect((one.match(/marker-label/g) || []).length).toBe(1);
    const all = render(annotated('options:\n  showLabels: true\nmarkers:\n  - { id: 1, x: 10, y: 20, label: "Save" }\n  - { id: 2, x: 30, y: 20, label: "Open", showLabel: false }'));
    expect((all.match(/class="marker-label"/g) || []).length).toBe(1);
    expect(structuralCssFor(all)).toContain('.marker-label');
  });
});

describe('redaction, fail closed (R-251, provisional)', () => {
  const doc = annotated('options:\n  caption: "Secret"\n  rotate: 90\nredact:\n  - { x: 10, y: 10, width: 20, height: 5 }\nmarkers:\n  - { id: 1, x: 50, y: 50, label: "A" }', 'shots/secret.png');
  it('render mode without the baked copy: the "not prepared" box, never the original (control: falling back to src)', () => {
    const html = render(doc);
    expect(html).toContain('Redacted picture not prepared');
    expect(html).not.toContain('secret.png');
    expect(html).not.toContain('<img');
    expect(html).toContain('<figcaption>');
  });
  it('render mode with the caller\'s copy: that copy, asked for with the rectangles, turn and flip', () => {
    const asked = [];
    const html = render(doc, { redacted: (...args) => { asked.push(args); return 'data:image/png;base64,QUJD'; } });
    expect(asked).toEqual([['shots/secret.png', [{ x: 10, y: 10, width: 20, height: 5 }], 90, '']]);
    expect(html).toContain('<img src="data:image/png;base64,QUJD"');
    expect(html).not.toContain('secret.png');
  });
  it('a caller that gives back the original path, or nothing, gets the box', () => {
    expect(render(doc, { redacted: (src) => src })).toContain('Redacted picture not prepared');
    expect(render(doc, { redacted: () => '' })).toContain('Redacted picture not prepared');
  });
  it('a redact that is not a list of rectangles is never baked: the box', () => {
    let called = false;
    const html = render(annotated('redact:\n  - { x: 1, y: 2 }'), { redacted: () => { called = true; return 'data:x'; } });
    expect(called).toBe(false);
    expect(html).toContain('Redacted picture not prepared');
    expect(render(annotated('redact: "all"'))).toContain('Redacted picture not prepared');
  });
  it('editor mode: the picture with opaque boxes under every shape', () => {
    const html = editorRender(doc);
    expect(html).toContain('<img src="shots/secret.png"');
    expect(html).toContain('<rect class="annotation-redact" x="10" y="10" width="20" height="5" fill="#000000" stroke="none" />');
  });
  it('readRedactions cuts rectangles at the edge, keeps covering what was asked', () => {
    expect(readRedactions([{ x: -10, y: 90, width: 30, height: 20 }]).rects).toEqual([{ x: 0, y: 90, width: 20, height: 10 }]);
    expect(readRedactions(undefined)).toEqual({ rects: [], error: null });
    expect(readRedactions([{ x: 1, y: 1, width: -2, height: 3 }]).error).toMatch(/entry 1/);
    expect(redactionKey('a.png', [{ x: 1, y: 2, width: 3, height: 4 }], 90, 'h')).toBe('["a.png",[[1,2,3,4]],90,"h"]');
  });
  it('listPictureEdits finds turned, flipped and redacted pictures as the renderer reads them', () => {
    const tokens = createDialect().parse(`${doc}\n<!-- ::FIGURE src="b.png" flip="v" -->\n\n<!-- ::FIGURE src="c.png" crop-x="50" -->\n`, {});
    expect(listPictureEdits(tokens)).toEqual([
      { form: 'annotated', src: 'shots/secret.png', line: 0, rotate: 90, flip: '', redact: [{ x: 10, y: 10, width: 20, height: 5 }], redactError: null, redacted: true },
      { form: 'figure', src: 'b.png', line: 10, rotate: 0, flip: 'v', redact: [], redactError: null, redacted: false }
    ]);
  });
  it('the write rule keeps the author\'s YAML and changes only the rectangle edited (one hunk)', () => {
    const yaml = 'options:\n  caption: "Secret"   # keep\nredact:\n  - { x: 10, y: 10, width: 20, height: 5 }\n  - { x: 50, y: 50, width: 5, height: 5 }';
    const tokens = createDialect({ mode: 'editor' }).parse(annotated(yaml), {});
    const occ = itemOccurrences(tokens).find((o) => o.item === 'annotated-image');
    const next = { ...occ.data.data, redact: [occ.data.data.redact[0], { x: 60, y: 50, width: 5, height: 5 }] };
    expect(writeAnnotatedImage({ imagePath: occ.data.imagePath, content: occ.data.content, data: next })).toBe(
      '::: annotated-image shots/app.png\noptions:\n  caption: "Secret"   # keep\nredact:\n  - { x: 10, y: 10, width: 20, height: 5 }\n  - { x: 60, y: 50, width: 5, height: 5 }\n:::');
  });
});

describe('shapes hidden by a % crop (control: the hidden test inverted)', () => {
  it('lists the shapes wholly outside the shown part; unknown for lengths', () => {
    const data = {
      options: { 'crop-x': 50, 'pos-x': '-20%' }, // shows x 20–70
      markers: [{ id: 1, x: 10, y: 5, label: 'out' }, { id: 2, x: 30, y: 5, label: 'in' }],
      boxes: [{ x: 60, y: 0, width: 20, height: 5 }, { x: 75, y: 0, width: 5, height: 5 }],
      arrows: [], text: [], lines: [], ellipses: [], highlights: []
    };
    expect(shapesHiddenByCrop(data)).toEqual([{ list: 'markers', index: 0 }, { list: 'boxes', index: 1 }]);
    expect(visibleArea(readPictureKeys(data.options))).toEqual({ x0: 20, y0: 0, x1: 70, y1: 100 });
    expect(shapesHiddenByCrop({ ...data, options: { 'crop-x': '300px' } })).toBeNull();
    expect(shapesHiddenByCrop({ ...data, options: {} })).toBeNull();
  });
});
