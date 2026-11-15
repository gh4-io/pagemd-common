/**
 * pagemd-editor fix run FIX-CF (R-258): a crop with a `height` gives the picture a box of its own; crop-fit decides how the
 * cropped part fills it. Controls: contain written like cover (the contain test fails), height read without a crop (the
 * no-crop and unchanged tests fail), the fit box drawn without the picture's size (the fallback test fails).
 */
import { describe, it, expect } from 'vitest';
import { createDialect, items } from '../src/index.js';

const render = (text, env) => createDialect().render(text, env);
const size = { pictureSize: () => ({ width: 400, height: 200 }) };
const figure = (fit, extra = '') => `<!-- ::FIGURE src="a.png" crop-x="50" height="100px" ${fit ? `crop-fit="${fit}"` : ''} ${extra} -->\n`;
const frameOf = (html) => /<div class="image-frame" style="([^"]*)">/.exec(html)?.[1] ?? '';

describe('FIGURE: crop + height = a box, crop-fit fills it (400 x 200 picture, left half shown = 200 x 200)', () => {
  it('cover: the larger scale, no clip', () => {
    const html = render(figure('cover'), size);
    expect(html).toContain('container-type: size;');
    expect(html).toContain('white-space: normal;'); // a line break between the tags is not a line (the editor's canvas keeps white space)
    expect(html).toContain('height: 100px;');
    const frame = frameOf(html);
    expect(frame).toContain('--fw: max(200cqw, 200cqh);');
    expect(frame).toContain('--fh: max(100cqw, 100cqh);');
    expect(frame).toContain('left: calc(50cqw - 0.25 * var(--fw));');
    expect(frame).not.toContain('clip-path');
  });
  it('contain: the smaller scale, clipped to the cropped part', () => {
    const frame = frameOf(render(figure('contain'), size));
    expect(frame).toContain('--fw: min(200cqw, 200cqh);');
    expect(frame).toContain('--fh: min(100cqw, 100cqh);');
    expect(frame).toContain('clip-path: inset(0% 50% 0% 0%);');
  });
  it('scale-down: contain, never larger than 1:1', () => {
    const frame = frameOf(render(figure('scale-down'), size));
    expect(frame).toContain('--fw: min(400px, min(200cqw, 200cqh));');
    expect(frame).toContain('clip-path: inset(0% 50% 0% 0%);');
  });
  it('fill: each side on its own', () => {
    const frame = frameOf(render(figure('fill'), size));
    expect(frame).toContain('--fw: 200cqw;');
    expect(frame).toContain('--fh: 100cqh;');
  });
  it('no crop-fit written: cover; a shift moves the shown part (pos-x -25%: it shows x 25 to 75)', () => {
    expect(frameOf(render(figure(''), size))).toContain('--fw: max(');
    const frame = frameOf(render(figure('contain', 'pos-x="-25"'), size));
    expect(frame).toContain('left: calc(50cqw - 0.5 * var(--fw));');
    expect(frame).toContain('clip-path: inset(0% 25% 0% 25%);');
  });
  it('a turned picture: the box uses the turned size, the image is stretched in a turn box', () => {
    const html = render('<!-- ::FIGURE src="a.png" crop-y="50" rotate="90" height="100px" crop-fit="contain" -->\n', size);
    expect(html).toContain('class="image-turn"');
    expect(html).toContain('width: var(--fh); height: var(--fw);');
    expect(frameOf(html)).toContain('--fw: min(');
  });
  it('without the picture\'s size: the old drawing, the image takes the height (cover and fill are right there)', () => {
    const html = render(figure('cover'));
    expect(html).toContain('object-view-box: inset(0% 50% 0% 0%)');
    expect(html).toContain('width: 100%; height: 100px');
    expect(html).not.toContain('image-frame');
  });
  it('no height: unchanged (no box)', () => {
    const html = render('<!-- ::FIGURE src="a.png" crop-x="50" crop-fit="contain" -->\n', size);
    expect(html).toBe('<figure style="--crop-fit: contain; --crop-x: 50%"><img src="a.png" alt="" style="object-view-box: inset(0% 50% 0% 0%); object-fit: contain"></figure>');
  });
  it('a height without a crop stays the figure\'s height; a crop in a length unit ignores the height', () => {
    expect(render('<!-- ::FIGURE src="a.png" height="100px" -->\n', size)).toContain('<figure style="height: 100px">');
    expect(render('<!-- ::FIGURE src="a.png" crop-x="300px" height="100px" -->\n', size)).not.toContain('image-box');
  });
});

describe('annotated image: options height + crop + crop-fit', () => {
  const doc = (fit) => `::: annotated-image shots/app.png\noptions:\n  crop-x: 50\n  height: 120px\n  ${fit ? `crop-fit: ${fit}` : ''}\nmarkers:\n  - { id: 1, x: 10, y: 20, label: A }\n:::\n`;
  it('the box, with the marker still inside the frame at its % of the whole picture', () => {
    const html = render(doc('contain'), size);
    expect(html).toContain('class="image-wrapper image-window image-box"');
    expect(html).toContain('height: 120px;');
    expect(html).toContain('--fw: min(200cqw, 200cqh);');
    expect(html.indexOf('class="marker"')).toBeGreaterThan(html.indexOf('image-frame'));
    expect(html).toContain('<span class="marker" style="left: 10%; top: 20%;">1</span>');
  });
  it('without a crop or without the size: as before', () => {
    expect(render(doc('contain'))).not.toContain('image-box');
    expect(render(doc('contain').replace('crop-x: 50\n  ', ''), size)).not.toContain('image-box');
  });
  it('the Inspector knows the height key', () => {
    const item = items.find((i) => i.id === 'annotated-image');
    expect(item.params.find((p) => p.key === 'options').fields.map((f) => f.key)).toContain('height');
  });
});

describe('listPictureEdits: a boxed picture asks the build for its size', () => {
  it('flags box on a crop (or crop-fit) with a height, on both forms; nothing else is listed', async () => {
    const { listPictureEdits } = await import('../src/index.js');
    const tokens = (text) => createDialect().parse(text, {});
    expect(listPictureEdits(tokens('<!-- ::FIGURE src="a.png" crop-x="50" height="100px" -->\n')).map((e) => [e.form, e.box])).toEqual([['figure', true]]);
    expect(listPictureEdits(tokens('<!-- ::FIGURE src="a.png" crop-x="50" -->\n'))).toEqual([]);
    expect(listPictureEdits(tokens('::: annotated-image a.png\noptions: { crop-x: 50, height: 90px }\n:::\n')).map((e) => [e.form, e.box])).toEqual([['annotated', true]]);
  });
});
