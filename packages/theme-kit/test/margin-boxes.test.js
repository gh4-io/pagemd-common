/**
 * Headers and footers written in a layout's own margin boxes (pagemd-editor P6, R-141 / OQ-35).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildStyles, contentToTokens, DEFAULTS, FROM_PROPERTIES, isFromProperties, layoutRunningContent, marginBoxes, stringSets } from '../src/index.js';

const defaults = (rel) => readFileSync(fileURLToPath(new URL(`../defaults/${rel}`, import.meta.url)), 'utf8');

describe('contentToTokens', () => {
  it.each([
    ['counter(page)', ':::PAGE'],
    ['"Page " counter(page) " of " counter(pages)', 'Page :::PAGE of :::PAGES'],
    ["string(chapter-title, first)", ':::STRING(chapter-title)'],
    ['string(book-title)', ':::STRING(book-title)'],
    ['"a \\"quoted\\" word"', 'a "quoted" word'],
    ['none', null],
    ['normal', null]
  ])('%s → %j', (value, expected) => {
    expect(contentToTokens(value)).toBe(expected);
  });

  it.each(['var(--page-header-left, none)', 'attr(title)', 'counter(chapter)', '"x" var(--y)', 'element(header)', ''])(
    '%s cannot be read',
    (value) => {
      expect(contentToTokens(value)).toBeUndefined();
    }
  );
});

describe("book-wiki's book.css (pagemd's own layout)", () => {
  const css = defaults('layouts/book.css');

  it('reads its three boxes, its :first page and its string-set rules', () => {
    expect(marginBoxes(css)).toEqual({
      all: { 'top-left': ':::STRING(book-title)', 'top-right': ':::STRING(chapter-title)', 'bottom-center': ':::PAGE' },
      first: { 'top-left': null, 'top-right': null, 'bottom-center': null }
    });
    expect(stringSets(css)).toEqual({ 'book-title': '.book-title-string', 'chapter-title': '.book-content h1' });
  });

  it('as running content: header left/right, footer center, both hidden on the first page', () => {
    expect(layoutRunningContent(css)).toEqual({
      header: { left: ':::STRING(book-title)', right: ':::STRING(chapter-title)' },
      footer: { center: ':::PAGE' },
      firstPage: { header: false, footer: false },
      strings: { 'book-title': '.book-title-string', 'chapter-title': '.book-content h1' }
    });
  });
});

describe('other layouts', () => {
  it("pagemd's default letter.css takes everything from var() (the document's properties): nothing read", () => {
    const { named, ...running } = layoutRunningContent(defaults(DEFAULTS.layout));
    expect(running).toEqual({ header: null, footer: null, firstPage: null, strings: {} });
    // P21: its landscape and default pages write every box with var(): each one is the document's property
    const props = { left: FROM_PROPERTIES, center: FROM_PROPERTIES, right: FROM_PROPERTIES };
    expect(named).toEqual({ landscape: { header: props, footer: props }, default: { header: props, footer: props } });
  });

  it('later rules win; :left/:right are ignored (named pages: see below); a :first box replaces one position', () => {
    const css = `
      @page { @top-center { content: "One"; } @bottom-right { content: counter(page); } }
      @page { @top-center { content: "Two"; } }
      @page :left { @top-left { content: "Left page"; } }
      @page landscape { @top-left { content: "Wide"; } }
      @page :first { @top-center { content: "Cover"; } }
      @media print { h2.x, h3 { string-set: sub content(); } }
      p { string-set: ignored attr(title); }`;
    const { named, ...unnamed } = layoutRunningContent(css);
    expect(unnamed).toEqual({
      header: { center: 'Two' },
      footer: { right: ':::PAGE' },
      firstPage: { header: { center: 'Cover' } },
      strings: { sub: 'h2.x, h3' }
    });
    expect(named).toEqual({ landscape: { header: { left: 'Wide' } } });
  });

  it('an unreadable later value removes an earlier readable one (the box is then not known)', () => {
    expect(marginBoxes('@page { @top-left { content: "A"; } } @page { @top-left { content: var(--x); } }').all).toEqual({});
  });
});

describe('buildStyles', () => {
  it('reports the layout running content beside the metadata one (book.css as the layout)', () => {
    const built = buildStyles({ layout: { content: defaults('layouts/book.css'), path: '/x/book.css' } });
    expect(built.layoutRunning.footer).toEqual({ center: ':::PAGE' });
    expect(built.header).toBeNull();
  });
});

describe('named pages (pagemd-editor P21)', () => {
  // The session-41 layout (pagemd-editor docs/phases/P21.md): checked against pagemd's PDF there
  const css = `
    @page { size: Letter; margin: 1in;
      @top-left { content: "MAIN HEADER"; } @top-right { content: "MAIN RIGHT"; }
      @bottom-center { content: "Page " counter(page) " of " counter(pages); } }
    @page :first { @top-left { content: none; } @bottom-center { content: none; } }
    @page wide { size: Letter landscape; margin: 0.5in 0.75in;
      @top-left { content: "WIDE HEADER"; } @bottom-center { content: "Wide page " counter(page); } }
    @page wide:first { @top-left { content: "WIDE FIRST"; } }
    .page-wide { page: wide; }`;

  it('reads @page name and @page name:first, in the same value form; the unnamed result is as before', () => {
    const boxes = marginBoxes(css);
    expect(boxes.named).toEqual({
      wide: { all: { 'top-left': 'WIDE HEADER', 'bottom-center': 'Wide page :::PAGE' }, first: { 'top-left': 'WIDE FIRST' } }
    });
    expect(boxes.all).toEqual({ 'top-left': 'MAIN HEADER', 'top-right': 'MAIN RIGHT', 'bottom-center': 'Page :::PAGE of :::PAGES' });
    expect(boxes.first).toEqual({ 'top-left': null, 'bottom-center': null });
    const { named, ...unnamed } = layoutRunningContent(css);
    expect(unnamed).toEqual({
      header: { left: 'MAIN HEADER', right: 'MAIN RIGHT' },
      footer: { center: 'Page :::PAGE of :::PAGES' },
      firstPage: { header: { right: 'MAIN RIGHT' }, footer: false },
      strings: {}
    });
    expect(named).toEqual({
      wide: { header: { left: 'WIDE HEADER' }, footer: { center: 'Wide page :::PAGE' }, first: { header: { left: 'WIDE FIRST' } } }
    });
  });

  it('none is null (it hides an inherited box); var() is the FROM_PROPERTIES marker, not left out', () => {
    const boxes = marginBoxes('@page wide { @top-left { content: none; } @top-right { content: var(--page-header-right, none); } }');
    expect(boxes.named.wide.all['top-left']).toBeNull();
    expect(boxes.named.wide.all['top-right']).toBe(FROM_PROPERTIES);
    expect(isFromProperties(JSON.parse(JSON.stringify(boxes.named.wide.all['top-right'])))).toBe(true);
    expect(isFromProperties('text')).toBe(false);
    expect(isFromProperties(null)).toBe(false);
  });

  it('two named pages; later rules win; names in lower case; comments and spacing', () => {
    const boxes = marginBoxes(`
      /* a comment @page fake { @top-left { content: "no"; } } */
      @page Legal{@top-left{content:"L1"}}
      @page legal   {  @top-left  {  content : 'L2' ; }  @bottom-right { content: counter(pages) } }
      @page wide :first { @bottom-left { content: "W" } }`);
    expect(boxes.named).toEqual({
      legal: { all: { 'top-left': 'L2', 'bottom-right': ':::PAGES' }, first: {} },
      wide: { all: {}, first: { 'bottom-left': 'W' } }
    });
  });

  it('@page wide:left, :blank, selector lists and other boxes are ignored, without throwing', () => {
    const boxes = marginBoxes(`
      @page wide:left { @top-left { content: "no"; } }
      @page :blank { @top-left { content: "no"; } }
      @page wide, legal { @top-left { content: "no"; } }
      @page wide { @left-top { content: "no"; } size: A4; }`);
    expect(boxes.named).toBeUndefined();
    expect(layoutRunningContent('@page wide:left { @top-left { content: "x"; } }').named).toBeUndefined();
  });

  it('a layout without named pages has no named key (as before)', () => {
    expect('named' in marginBoxes('@page { @top-left { content: "A"; } }')).toBe(false);
    expect('named' in layoutRunningContent(defaults('layouts/book.css'))).toBe(false);
  });

  it('buildStyles reports the named running content (letter.css: every box from the properties)', () => {
    const built = buildStyles({ layout: { content: css, path: '/x/multi.css' } });
    expect(built.layoutRunning.named.wide.first).toEqual({ header: { left: 'WIDE FIRST' } });
  });
});
