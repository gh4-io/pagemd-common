/**
 * tables/column-widths.js (pagemd-editor phase P19): widths on a table's `{…}` line become a <colgroup>, cell
 * widths and the fixed table layout in pagemd's HTML; every other table's HTML stays as it was.
 */

import { describe, it, expect } from 'vitest';
import { createDialect, parseColumnWidths, writeColumnWidths, tableLayoutOf, columnWidthValue, columnWidthProblems, tableDirectiveAttrs, writeTableDirective } from '../src/index.js';

const render = (src) => createDialect().render(src);
const TABLE = '| A | B | C |\n|:--|---|--:|\n| 1 | 2 | 3 |\n';

describe('parseColumnWidths / writeColumnWidths', () => {
  it('reads percentages, bare numbers and * (not set); anything else is not set', () => {
    expect(parseColumnWidths('30% 20 *')).toEqual([30, 20, null]);
    expect(parseColumnWidths('12.5%, 2in, abc, 0, 101%, 50%')).toEqual([12.5, null, null, null, null, 50]);
    expect(parseColumnWidths('')).toEqual([]);
    expect(parseColumnWidths(null)).toEqual([]);
  });

  it('the forms a width may take (P19 follow-up): %, a number above 1, a decimal fraction below 1; 1 is refused', () => {
    expect(parseColumnWidths('30% 30 30.5% 30.5 0.3 .25 0.125')).toEqual([30, 30, 30.5, 30.5, 30, 25, 12.5]);
    expect(parseColumnWidths('1 1.0 1% 100% 100 0.0 0% 0 -5 101')).toEqual([null, null, 1, 100, 100, null, null, null, null, null]);
    expect(columnWidthValue('1.5')).toBe(1.5); // above 1 without %: a percentage
    expect(columnWidthValue('0.333')).toBe(33.3);
  });

  it('columnWidthProblems names each value that counts as not set, and a total above 100', () => {
    expect(columnWidthProblems('30% * 0.2 50')).toEqual([]);
    expect(columnWidthProblems('1 abc')).toEqual([
      '"1" could mean 1 % or the whole table: write 1% or 100% (it counts as not set)',
      '"abc" is not a width (write 30%, 30, or 0.3 for 30 %; * for not set): it counts as not set'
    ]);
    expect(columnWidthProblems('60% 0.5')).toEqual(['the widths add up to 110 %, more than the table (the browser scales them down)']);
  });

  it('a fraction renders as the same percentage in the HTML', () => {
    expect(render(`${TABLE}{data-col-widths="0.5 20 30%"}\n`)).toContain('<colgroup>\n<col style="width:50%">\n<col style="width:20%">\n<col style="width:30%">');
  });

  it('writes whole or two-decimal percentages, * for not set, nothing trailing', () => {
    expect(writeColumnWidths([30, 20, 50])).toBe('30% 20% 50%');
    expect(writeColumnWidths([33.3333, null, 33.335])).toBe('33.33% * 33.34%');
    expect(writeColumnWidths([25, null, null])).toBe('25%');
    expect(writeColumnWidths([null, null])).toBe('');
  });

  it('a written value reads back', () => {
    const widths = [12.5, null, 40, 47.5];
    expect(parseColumnWidths(writeColumnWidths(widths))).toEqual(widths);
  });

  it('tableLayoutOf: .fixed-layout alone is fixed without widths; a set width is fixed', () => {
    expect(tableLayoutOf('fixed-layout striped', null)).toEqual({ fixed: true, widths: [] });
    expect(tableLayoutOf(null, '* *')).toEqual({ fixed: false, widths: [] });
    expect(tableLayoutOf(null, '40% *')).toEqual({ fixed: true, widths: [40, null] });
  });
});

describe('render mode: the widths in the HTML', () => {
  it('a table without widths or .fixed-layout is unchanged', () => {
    const html = render(TABLE);
    expect(html).not.toContain('colgroup');
    expect(html).not.toContain('table-layout');
    expect(html).not.toContain('width:');
    expect(render(`${TABLE}{.striped}\n`)).toBe('<table class="striped">' + html.slice('<table>'.length));
  });

  it('data-col-widths: colgroup, cell widths and the fixed layout', () => {
    const html = render(`${TABLE}{data-col-widths="50% 20% 30%"}\n`);
    expect(html).toContain('<table data-col-widths="50% 20% 30%" style="table-layout:fixed">\n<colgroup>\n<col style="width:50%">\n<col style="width:20%">\n<col style="width:30%">\n</colgroup>\n<thead>');
    expect(html).toContain('<th style="text-align:left;width:50%">A</th>');
    expect(html).toContain('<th style="width:20%">B</th>');
    expect(html).toContain('<td style="text-align:right;width:30%">3</td>');
  });

  it('.fixed-layout alone: the fixed layout only (equal columns), no colgroup', () => {
    const html = render(`${TABLE}{.fixed-layout}\n`);
    expect(html).toContain('<table class="fixed-layout" style="table-layout:fixed">');
    expect(html).not.toContain('colgroup');
    expect(html).not.toContain('width:');
  });

  it("the author's own style stays, after the layout", () => {
    expect(render(`${TABLE}{style="color:red" data-col-widths="40% 30% 30%"}\n`)).toContain('style="table-layout:fixed;color:red"');
  });

  it('a column not set has a plain <col> and its cells no width; values past the last column are ignored', () => {
    const html = render(`${TABLE}{data-col-widths="40% * 30% 99%"}\n`);
    expect(html).toContain('<colgroup>\n<col style="width:40%">\n<col>\n<col style="width:30%">\n</colgroup>');
    expect(html).toContain('<th>B</th>');
    expect(html.match(/<col\b/g)).toHaveLength(3);
  });

  it('a colspan cell gets the sum of its columns; a rowspan keeps the columns of the rows below', () => {
    const src = '| A | B | C |\n|---|---|---|\n| 1 || 2 |\n| x | y | z |\n| ^^ | q | r |\n{data-col-widths="50% 20% 30%"}\n';
    const html = render(src);
    expect(html).toContain('<td colspan="2" style="width:70%">1</td>');
    expect(html).toContain('<td style="width:30%">2</td>');
    expect(html).toContain('<td rowspan="2" style="width:50%">x</td>');
    expect(html).toContain('<td style="width:20%">q</td>');
    expect(html).toContain('<td style="width:30%">r</td>');
  });

  it('a spanning cell over a column that is not set gets no width', () => {
    const html = render('| A | B |\n|---|---|\n| 1 ||\n{data-col-widths="60% *"}\n');
    expect(html).toContain('<td colspan="2">1</td>');
  });

  it('the colgroup goes after the caption (a table\'s first child)', () => {
    const html = render(`Table: Parts\n\n${TABLE}{data-col-widths="50% 20% 30%"}\n`);
    expect(html).toMatch(/<caption>Parts<\/caption>\n<colgroup>/);
  });

  it('a headerless table and two tables in one document each get their own (a blank line alone would start a second body, so text sits between)', () => {
    const html = render('|---|---|\n| 1 | 2 |\n{data-col-widths="70% 30%"}\n\nText.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nMore text.\n\n| C | D |\n|---|---|\n| 3 | 4 |\n{data-col-widths="10% 90%"}\n');
    expect(html.match(/<colgroup>/g)).toHaveLength(2);
    expect(html).toContain('<td style="width:70%">1</td>');
    expect(html).toContain('<td style="width:90%">4</td>');
    expect(html).toContain('<th>A</th>');
  });

  it('editor mode adds no tokens (the editor reads the attribute itself)', () => {
    const md = createDialect({ mode: 'editor' });
    const types = md.parse(`${TABLE}{data-col-widths="50% 20% 30%"}\n`, {}).map((t) => t.type);
    expect(types).not.toContain('colgroup_open');
    const open = md.parse(`${TABLE}{data-col-widths="50% 20% 30%"}\n`, {}).find((t) => t.type === 'table_open');
    expect(open.attrGet('style')).toBeNull();
    expect(open.attrGet('data-col-widths')).toBe('50% 20% 30%');
  });
});

describe('the hidden <!-- ::TABLE widths="…" --> comment (P19, round 3)', () => {
  const OLD = `${TABLE}{data-col-widths="50% 20% 30%"}\n`;
  const NEW = `${TABLE}<!-- ::TABLE widths="50% 20% 30%" -->\n`;

  it('gives the same table HTML as the {…} form (the old form keeps working), and prints nothing itself', () => {
    expect(render(NEW)).toBe(render(OLD).replace(' data-col-widths="50% 20% 30%"', ''));
    expect(render(NEW)).not.toContain('TABLE');
    expect(render(NEW)).not.toContain('<!--');
  });

  it('equal is the fixed layout without widths (as .fixed-layout); the comment wins over the {…} line', () => {
    expect(render(`${TABLE}<!-- ::TABLE widths="equal" -->\n`)).toBe(render(`${TABLE}{.fixed-layout}\n`).replace(' class="fixed-layout"', ''));
    const both = render(`${TABLE}{.striped data-col-widths="10% 10% 80%"}\n<!-- ::TABLE widths="50% 20% 30%" -->\n`);
    expect(both).toContain('<col style="width:50%">');
    expect(both).toContain('class="striped"');
  });

  it('works with spans: a colspan cell gets the sum of its columns', () => {
    const html = render('| A | B | C |\n|---|---|---|\n| wide || 3 |\n| tall | x | y |\n| ^^ | p | q |\n<!-- ::TABLE widths="20% 30% 50%" -->\n');
    expect(html).toContain('<td colspan="2" style="width:50%">wide</td>');
    expect(html).toContain('<td rowspan="2" style="width:20%">tall</td>');
    expect(html).toContain('<td style="width:30%">p</td>');
    expect(html.match(/<col\b/g)).toHaveLength(3);
  });

  it('a TABLE comment that is not under a table prints nothing and changes no table', () => {
    const html = render(`${TABLE}\nText.\n\n<!-- ::TABLE widths="50% 20% 30%" -->\n`);
    expect(html).not.toContain('colgroup');
    expect(html).not.toContain('TABLE');
  });

  it('editor mode: folded into the table (meta and line range), and written back by writeTableDirective', () => {
    const tokens = createDialect({ mode: 'editor' }).parse(`${TABLE}{.striped}\n<!-- ::TABLE widths="50% 20% 30%" -->\n\nAfter.\n`, {});
    const open = tokens.find((t) => t.type === 'table_open');
    expect(open.map).toEqual([0, 5]);
    expect(open.meta.tableDirective).toEqual({ name: 'TABLE', parenParams: null, params: 'widths="50% 20% 30%"', attrs: { widths: '50% 20% 30%' } });
    expect(tokens.some((t) => t.type === 'pagemd_directive')).toBe(false);
    expect(writeTableDirective(open.meta.tableDirective)).toBe('<!-- ::TABLE widths="50% 20% 30%" -->');
    expect(writeTableDirective({ attrs: { widths: '40% 60%' } })).toBe('<!-- ::TABLE widths="40% 60%" -->');
    expect(writeTableDirective({ attrs: {} })).toBe('');
  });

  it('tableDirectiveAttrs reads only a whole TABLE comment', () => {
    expect(tableDirectiveAttrs({ type: 'html_block', content: '<!-- ::TABLE widths="equal" -->\n' })).toEqual({ widths: 'equal' });
    expect(tableDirectiveAttrs({ type: 'html_block', content: '<!-- ::TABLES x -->' })).toBeNull();
    expect(tableDirectiveAttrs({ type: 'paragraph_open' })).toBeNull();
  });
});
