/**
 * tables/attrs-fix.js (editor phase P16, OQ-29): markdown-it-attrs hid the plain cell that follows a
 * `||` colspan cell. Fails if a cell after a span goes missing from the HTML again.
 */

import { describe, it, expect } from 'vitest';
import { createDialect } from '../src/index.js';

const cells = (html) => [...html.matchAll(/<t[dh][^>]*>([^<]*)<\/t[dh]>/g)].map((m) => m[1]);

describe('attrs-fix: the cell after a colspan cell stays', () => {
  it('shows both cells of | 1 || 2 |', () => {
    const md = createDialect();
    const html = md.render('| a | b | c |\n|---|---|---|\n| 1 || 2 |\n');
    expect(html).toContain('<td colspan="2">1</td>');
    expect(cells(html)).toEqual(['a', 'b', 'c', '1', '2']);
  });

  it('keeps cells after a span in the middle of several rows', () => {
    const md = createDialect();
    const html = md.render('| a | b | c | d |\n|---|---|---|---|\n| x || y | z |\n| 1 | 2 | 3 | 4 |\n');
    expect(cells(html)).toEqual(['a', 'b', 'c', 'd', 'x', 'y', 'z', '1', '2', '3', '4']);
  });

  it('leaves a table without spans unchanged', () => {
    const md = createDialect();
    const html = md.render('| a | b |\n|---|---|\n| 1 | 2 |\n');
    expect(cells(html)).toEqual(['a', 'b', '1', '2']);
  });

  it('keeps rowspan tables as before', () => {
    const md = createDialect();
    const html = md.render('| a | b |\n|---|---|\n| 1 | 2 |\n| ^^ | 3 |\n');
    expect(html).toContain('rowspan="2"');
    expect(cells(html)).toEqual(['a', 'b', '1', '2', '3']);
  });
});
