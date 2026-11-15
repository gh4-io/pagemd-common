/**
 * pagemd-editor "readable figures" run (R-253 to R-257): a FIGURE comment under a lone picture line belongs to it.
 * One document per style (test/fixtures/figure-styles): each is read, written back unchanged (the exact bytes) and,
 * after one change, written in the style it was read in. Each test names its control.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDialect, itemOccurrences, writeFigure } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'fixtures', 'figure-styles');
const read = (name) => readFileSync(join(dir, name), 'utf8');
const render = (text) => createDialect().render(text);
const occurrences = (text) => itemOccurrences(createDialect({ mode: 'editor' }).parse(text, {}));
const figureOf = (text) => occurrences(text).find((o) => o.item === 'figure');
const slice = (text, token) => text.split('\n').slice(token.map[0], token.map[1]).join('\n');

describe('the six figure styles (control: the reader without the picture-above rule → style 6 gives an empty figure)', () => {
  it('has one fixture per style', () => {
    expect(readdirSync(dir).length).toBe(6);
  });

  it('style 1, a plain picture, stays a plain picture (no figure)', () => {
    const text = read('1-plain.md');
    expect(figureOf(text)).toBeUndefined();
    expect(render(text)).toContain('<p><img src="shots/login.png" alt="Login page" title="The login page"></p>');
  });

  it('style 2, the native comment, is a numbered figure and writes back the same', () => {
    const text = read('2-native.md');
    const o = figureOf(text);
    expect(o.data.attrs.caption).toBe('The login page');
    expect(writeFigure(o.data)).toBe(slice(text, o.token));
  });

  it('style 3, the comment before the image, writes back the same', () => {
    const text = read('3-legacy.md');
    const o = figureOf(text);
    expect(o.data.legacy).toBe(true);
    expect(writeFigure(o.data)).toBe(slice(text, o.token));
  });

  it('style 4, the annotated image block, is read as before', () => {
    const o = occurrences(read('4-annotated.md')).find((x) => x.item === 'annotated-image');
    expect(o.data.imagePath).toBe('shots/login.png');
  });

  it('style 5, the embed, is a picture and a comment under it is not taken for a figure picture', () => {
    expect(render(read('5-embed.md'))).toContain('class="embedded-image"');
    expect(figureOf(read('5-embed.md'))).toBeUndefined();
  });

  it('style 6, the readable form, is one figure with the title as caption, and writes back the same', () => {
    const text = read('6-readable.md');
    const o = figureOf(text);
    expect(o.data.form).toBe('after');
    expect(o.data.attrs).toMatchObject({ src: 'shots/login.png', alt: 'Login page', caption: 'The login page', id: 'fig-login', width: 'half' });
    expect(o.token.map).toEqual([2, 4]);
    expect(writeFigure(o.data)).toBe(slice(text, o.token));
  });

  it('styles 2, 3 and 6 draw the same figure (control: the picture left out of the figure → a plain <p><img> before it)', () => {
    const html = (name) => render(read(name)).replace(/\s+/g, ' ');
    const native = html('2-native.md');
    expect(html('6-readable.md')).toContain('<figure id="fig-login" class="width-half"><img src="shots/login.png" alt="Login page"><figcaption>Figure <span class="fig-num">1</span>: The login page</figcaption></figure>');
    expect(native).toContain('<figure id="fig-login" class="width-half"><img src="shots/login.png" alt="The login page">');
    expect(html('6-readable.md')).not.toContain('<p><img');
  });
});

describe('the readable form: reading', () => {
  it('a bare marker under a titled picture makes it a numbered figure', () => {
    const html = render('![A](a.png "Cap")\n<!-- ::FIGURE -->\n');
    expect(html).toContain('<figure><img src="a.png" alt="A"><figcaption>Figure <span class="fig-num">1</span>: Cap</figcaption></figure>');
  });
  it('the comment\'s caption wins over the title', () => {
    const o = figureOf('![A](a.png "Title")\n<!-- ::FIGURE caption="From comment" -->\n');
    expect(o.data.attrs.caption).toBe('From comment');
  });
  it('crop, rotate and flip in the comment are read as in the native form', () => {
    const html = render('![A](a.png)\n<!-- ::FIGURE rotate="90" flip="h" -->\n');
    expect(html).toContain('<figure>');
    expect(html).toContain('transform: scaleX(-1) rotate(90deg)');
  });
  it('a bare marker under anything else is not a figure (control: the old reader ignored it too)', () => {
    expect(figureOf('Some text\n<!-- ::FIGURE -->\n')).toBeUndefined();
    expect(figureOf('![A](a.png){.wide}\n<!-- ::FIGURE -->\n')).toBeUndefined();
  });
  it('a comment with its own src does not take the picture above it', () => {
    const o = figureOf('![A](a.png)\n<!-- ::FIGURE src="b.png" -->\n');
    expect(o.data.form).toBeUndefined();
    expect(o.token.map).toEqual([1, 2]);
  });
  it('a picture with a blank line before the comment is not attached', () => {
    expect(render('![A](a.png "C")\n\n<!-- ::FIGURE id="x" -->\n')).toContain('<p><img');
  });
  it('figures are numbered across styles in document order', () => {
    const html = render('![A](a.png "One")\n<!-- ::FIGURE -->\n\n<!-- ::FIGURE src="b.png" caption="Two" -->\n');
    expect(html).toMatch(/fig-num">1<\/span>: One[\s\S]*fig-num">2<\/span>: Two/);
  });
});

describe('the readable form: writing', () => {
  it('a new readable figure with a caption and a width', () => {
    expect(writeFigure({ form: 'readable', attrs: { src: 'a b.png', alt: 'A [x]', caption: 'Cap "q"', width: 'half' } }))
      .toBe('![A \\[x\\]](<a b.png> "Cap \\"q\\"")\n<!-- ::FIGURE width="half" -->');
  });
  it('no setting and no caption: just the picture line, no comment', () => {
    expect(writeFigure({ form: 'readable', attrs: { src: 'a.png', alt: 'A' } })).toBe('![A](a.png)');
  });
  it('a caption alone keeps the bare marker (pagemd needs it to number the figure)', () => {
    expect(writeFigure({ form: 'readable', attrs: { src: 'a.png', alt: 'A', caption: 'C' } })).toBe('![A](a.png "C")\n<!-- ::FIGURE -->');
  });
  it('a changed width is rewritten in the comment only; the picture line keeps its bytes', () => {
    const text = '![ A ](a.png   "C")\n<!-- ::FIGURE id="x" width="half" -->\n';
    const o = figureOf(text);
    expect(writeFigure({ ...o.data, attrs: { ...o.data.attrs, width: 'full' } })).toBe('![ A ](a.png   "C")\n<!-- ::FIGURE id="x" width="full" -->');
  });
  it('a changed caption is rewritten in the title; one the author wrote in the comment stays there', () => {
    const a = figureOf('![A](a.png "Old")\n<!-- ::FIGURE id="x" -->\n');
    expect(writeFigure({ ...a.data, attrs: { ...a.data.attrs, caption: 'New' } })).toBe('![A](a.png "New")\n<!-- ::FIGURE id="x" -->');
    const b = figureOf('![A](a.png "Old")\n<!-- ::FIGURE caption="In comment" -->\n');
    expect(writeFigure({ ...b.data, attrs: { ...b.data.attrs, caption: 'New' } })).toBe('![A](a.png "Old")\n<!-- ::FIGURE caption="New" -->');
  });
  it('removing the caption and every setting leaves a plain picture', () => {
    const o = figureOf('![A](a.png "Old")\n<!-- ::FIGURE -->\n');
    expect(writeFigure({ ...o.data, attrs: { ...o.data.attrs, caption: '' } })).toBe('![A](a.png)');
  });
  it('what is written reads back as the same data', () => {
    const data = { form: 'readable', attrs: { src: 'img/a.png', alt: 'Alt', caption: 'Cap', id: 'f1', width: 'half', rotate: '90' } };
    const back = figureOf(`${writeFigure(data)}\n`);
    expect(back.data.attrs).toMatchObject(data.attrs);
  });
});

describe('a new figure in the legacy style (figureStyle "legacy")', () => {
  it('the comment, then the picture line; read back as a legacy figure', () => {
    const text = writeFigure({ form: 'legacy', attrs: { src: 'a.png', alt: 'A', caption: 'Cap', width: 'half' } });
    expect(text).toBe('<!-- ::FIGURE caption="Cap" width="half" -->\n![A](a.png)');
    const o = figureOf(`${text}\n`);
    expect(o.data.legacy).toBe(true);
    expect(o.data.attrs.caption).toBe('Cap');
  });
  it('with nothing for the comment, just the picture line', () => {
    expect(writeFigure({ form: 'legacy', attrs: { src: 'a.png', alt: 'A' } })).toBe('![A](a.png)');
  });
});
