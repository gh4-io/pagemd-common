/**
 * pageGeometry(): @page size and margins in millimetres (phase C5).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pageGeometry, namedPages, hasPageRule, lengthToMm, FALLBACK_PAGE, DEFAULTS } from '../src/index.js';

const defaults = (rel) => readFileSync(fileURLToPath(new URL(`../defaults/${rel}`, import.meta.url)), 'utf8');
const page = (g) => ({ width: g.width, height: g.height, margins: g.margins });

describe('lengths', () => {
  it.each([
    ['1in', 25.4], ['2.54cm', 25.4], ['25.4mm', 25.4], ['72pt', 25.4], ['6pc', 25.4], ['96px', 25.4],
    ['4Q', 1], ['0', 0], ['0.75in', 19.05], ['-1mm', -1]
  ])('%s = %f mm', (text, mm) => {
    expect(lengthToMm(text)).toBeCloseTo(mm, 6);
  });

  it.each(['10%', '2em', 'auto', 'var(--m)', 'calc(1in + 2px)', '1'])('%s cannot be read', (text) => {
    expect(lengthToMm(text)).toBeNull();
  });
});

describe('pageGeometry', () => {
  it('no @page: the fallback (Paged.js: Letter, 1in), found = false', () => {
    const g = pageGeometry('body { margin: 0 }');
    expect(page(g)).toEqual(FALLBACK_PAGE);
    expect(g.found).toBe(false);
    expect(hasPageRule('body{}')).toBe(false);
  });

  it("pagemd's default layout (letter.css): Letter, 1in margins; a landscape named page", () => {
    const css = defaults(DEFAULTS.layout);
    expect(hasPageRule(css)).toBe(true);
    const g = pageGeometry(css);
    expect(g.found).toBe(true);
    expect(page(g)).toEqual({ width: 215.9, height: 279.4, margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 } });
    expect(namedPages(css)).toEqual(['landscape', 'default']);
    expect(page(pageGeometry(css, { name: 'landscape' }))).toEqual({
      width: 279.4, height: 215.9, margins: { top: 25.4, right: 19.05, bottom: 25.4, left: 19.05 }
    });
    expect(g.unreadable).toEqual([]);
  });

  it('pagemd book.css style: four margin values', () => {
    const g = pageGeometry('@page {\n  size: Letter;\n  margin: 0.75in 0.6in 0.75in 0.6in;\n  @top-left { content: string(x); }\n}');
    expect(g.margins).toEqual({ top: 19.05, right: 15.24, bottom: 19.05, left: 15.24 });
  });

  it('keywords, orientation, explicit sizes, 1–3 margin values, margin-* and later rules winning', () => {
    expect(page(pageGeometry('@page { size: A4; margin: 20mm }'))).toEqual({ width: 210, height: 297, margins: { top: 20, right: 20, bottom: 20, left: 20 } });
    expect(pageGeometry('@page { size: a4 landscape }')).toMatchObject({ width: 297, height: 210 });
    expect(pageGeometry('@page { size: 6in 9in }')).toMatchObject({ width: 152.4, height: 228.6 });
    expect(pageGeometry('@page { size: 100mm }')).toMatchObject({ width: 100, height: 100 });
    expect(pageGeometry('@page { size: 9in 6in portrait }')).toMatchObject({ width: 152.4, height: 228.6 });
    expect(pageGeometry('@page { margin: 1cm 2cm }').margins).toEqual({ top: 10, right: 20, bottom: 10, left: 20 });
    expect(pageGeometry('@page { margin: 1cm 2cm 3cm }').margins).toEqual({ top: 10, right: 20, bottom: 30, left: 20 });
    expect(pageGeometry('@page { margin: 1cm; margin-left: 3cm !important }').margins).toEqual({ top: 10, right: 10, bottom: 10, left: 30 });
    expect(pageGeometry('@page { size: A5 } @page { size: legal }')).toMatchObject({ width: 215.9, height: 355.6 });
  });

  it(':first / :left / :right rules and comments do not change the page', () => {
    const g = pageGeometry('/* @page { size: A3 } */ @page :first { margin: 0 } @page :left { size: A5 } @page { size: B5 }');
    expect(g).toMatchObject({ width: 176, height: 250, margins: FALLBACK_PAGE.margins });
  });

  it('a declaration after a nested margin box still counts', () => {
    const g = pageGeometry('@page { @top-left { content: "x"; } margin-top: 2in; }');
    expect(g.margins.top).toBe(50.8);
  });

  it('values it cannot read keep the previous value and are listed', () => {
    const g = pageGeometry('@page { size: var(--size); margin: calc(1in); margin-top: 5% }');
    expect(page(g)).toEqual(FALLBACK_PAGE);
    expect(g.unreadable).toEqual(['size: var(--size)', 'margin: calc(1in)', 'margin-top: 5%']);
  });
});
