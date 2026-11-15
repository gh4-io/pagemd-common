/**
 * Table column widths (pagemd-editor phase P19).
 *
 * Widths ride on the table's `{…}` attribute line, which markdown-it-attrs
 * already reads; no new syntax:
 *
 *   | Item | Qty | Notes |
 *   |------|-----|-------|
 *   | Bolts | 4 | Stainless |
 *   {data-col-widths="50% 15% 35%"}
 *
 * - `data-col-widths`: one value per column, left to right, separated by
 *   spaces (or commas), or `*` for "not set". A value is a share of the
 *   table's width (columnWidthValue):
 *     `30%`, `30.5%`  a percentage (more than 0, at most 100);
 *     `30`, `30.5`    a number above 1 without `%`: a percentage too;
 *     `0.3`, `.25`    a number below 1 written with a decimal point: a
 *                     fraction of the table (0.3 = 30 %);
 *     `1`, `1.0`      not accepted (1 % or the whole table? write `1%` or
 *                     `100%`), nor 0, above 100, `2in`, words.
 *   A value not accepted counts as "not set" (the `syntax` validation level
 *   says so). Columns that are not set share equally what the set ones leave
 *   (the browser's fixed table layout does that).
 * - `.fixed-layout`: fixed column widths; alone, equal columns.
 *
 * Render mode only (editor mode reads the attribute from the `{…}` pairs and
 * gets no new tokens). For a table with `.fixed-layout` or at least one set
 * width:
 * - `<table>` gets `table-layout:fixed` at the start of its `style`;
 * - with a set width, a `<colgroup>` with one `<col>` per column goes right
 *   after the `<caption>` (or `<table>`);
 * - each cell whose columns are all set gets `width:N%` (the sum over its
 *   colspan): Paged.js rebuilds a table it splits over two pages from a
 *   shallow copy of `<table>`, without the `<colgroup>`, so the cells carry
 *   the widths onto the next page. In a fixed layout a `<col>` width wins
 *   over a cell width (CSS 2.1, 17.5.2.1), so page 1 is the same either way.
 * Any other table's HTML is unchanged.
 */

import { isEditor } from '../shared/mode.js';
import { EQUAL_WIDTHS, tableCloseOf, tableDirectiveAttrs } from './table-directive.js';

/** The attribute that holds the widths */
export const COLUMN_WIDTHS_ATTR = 'data-col-widths';

/** The class that switches the fixed table layout on (equal columns without widths) */
export const FIXED_LAYOUT_CLASS = 'fixed-layout';

const VALUE = /^(\d+(?:\.\d*)?|\.\d+)(%?)$/;

/**
 * One written width as a percentage, or null when it isn't accepted (see the rules above)
 * @param {string} part - e.g. "30%", "30", "30.5", "0.3"
 * @returns {number|null}
 */
export function columnWidthValue(part) {
  const match = VALUE.exec(String(part).trim());
  if (!match) return null;
  const n = Number(match[1]);
  let percent;
  if (match[2] === '%') percent = n;
  else if (n > 1) percent = n;
  else if (match[1].includes('.') && n < 1) percent = Number((n * 100).toFixed(4));
  else return null; // 1 and 1.0 (ambiguous), 0
  return percent > 0 && percent <= 100 ? percent : null;
}

/** The parts of an attribute value, as written */
const partsOf = (value) => String(value ?? '').split(/[\s,]+/).filter(Boolean);

/**
 * The widths an attribute value sets, one entry per column written
 * @param {string|null|undefined} value - e.g. "30% 20% *"
 * @returns {(number|null)[]} a percentage, or null for "not set"
 */
export function parseColumnWidths(value) {
  return partsOf(value).map((part) => (part === '*' ? null : columnWidthValue(part)));
}

/**
 * What is wrong with a written value, in plain words (the `syntax` validation level's hints): parts that are not
 * accepted, and set widths adding up to more than 100 %.
 * @param {string|null|undefined} value
 * @returns {string[]}
 */
export function columnWidthProblems(value) {
  const problems = [];
  for (const part of partsOf(value)) {
    if (part === '*' || columnWidthValue(part) !== null) continue;
    problems.push(/^1(\.0*)?$/.test(part)
      ? `"${part}" could mean 1 % or the whole table: write 1% or 100% (it counts as not set)`
      : `"${part}" is not a width (write 30%, 30, or 0.3 for 30 %; * for not set): it counts as not set`);
  }
  const total = parseColumnWidths(value).reduce((sum, w) => sum + (w ?? 0), 0);
  if (total > 100.01) problems.push(`the widths add up to ${Number(total.toFixed(2))} %, more than the table (the browser scales them down)`);
  return problems;
}

/** A percentage as written: at most two decimals, no trailing zeros */
const percent = (n) => `${Number(n.toFixed(2))}%`;

/**
 * The attribute value for widths (the editor's write rule)
 * @param {(number|null|undefined)[]} widths - a percentage, or null for "not set"
 * @returns {string} '' when no column is set
 */
export function writeColumnWidths(widths) {
  const parts = (widths || []).map((w) => (typeof w === 'number' && w > 0 && Number.isFinite(w) ? percent(w) : '*'));
  while (parts.length && parts[parts.length - 1] === '*') parts.pop();
  return parts.join(' ');
}

/**
 * Whether a table asks for the fixed layout, and its widths. The `<!-- ::TABLE widths="…" -->` comment under the table
 * (table-directive.js), when it has `widths`, wins over the `{…}` line's `data-col-widths` and `.fixed-layout`.
 * @param {string|null} classAttr - the `{…}` line's classes
 * @param {string|null} widthsAttr - the `{…}` line's `data-col-widths`
 * @param {string|true|null} [directiveWidths] - the TABLE comment's `widths` (`equal`, or values)
 */
export function tableLayoutOf(classAttr, widthsAttr, directiveWidths = null) {
  if (typeof directiveWidths === 'string') {
    if (directiveWidths.trim() === EQUAL_WIDTHS) return { fixed: true, widths: [] };
    const widths = parseColumnWidths(directiveWidths);
    if (widths.some((w) => w !== null)) return { fixed: true, widths };
  }
  const widths = parseColumnWidths(widthsAttr);
  const anySet = widths.some((w) => w !== null);
  const fixed = anySet || String(classAttr ?? '').split(/\s+/).includes(FIXED_LAYOUT_CLASS);
  return { fixed, widths: anySet ? widths : [] };
}

/** `style` with `css` appended (`a:b` + `c:d` → `a:b;c:d`) */
function appendStyle(token, css) {
  const style = token.attrGet('style');
  token.attrSet('style', style ? `${style.replace(/;\s*$/, '')};${css}` : css);
}

/**
 * The cells of the table that opens at tokens[start]: each with its first
 * column and its span, worked out like a browser does (rowspans from rows
 * above take their columns first). Hidden cells and rows are left out.
 * @returns {{cells: {token: object, col: number, span: number}[], width: number, end: number}}
 */
function tableCells(tokens, start) {
  const cells = [];
  /** column → rows it is still taken for, by a rowspan from above */
  let taken = [];
  let width = 0;
  let depth = 0;
  let col = 0;
  let rowTaken = null;
  let end = tokens.length - 1;
  for (let i = start; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'table_open') depth++;
    else if (t.type === 'table_close' && --depth === 0) {
      end = i;
      break;
    }
    if (depth !== 1 || t.hidden) continue;
    if (t.type === 'tr_open') {
      col = 0;
      rowTaken = [];
    } else if (t.type === 'tr_close') {
      // What this row's rowspans take from the rows below, plus what is left from above
      const next = [];
      for (let c = 0; c < Math.max(taken.length, rowTaken.length); c++) {
        next[c] = Math.max((taken[c] || 0) - 1, rowTaken[c] || 0);
      }
      taken = next;
      width = Math.max(width, col);
    } else if (t.type === 'td_open' || t.type === 'th_open') {
      while ((taken[col] || 0) > 0) col++;
      const span = Math.max(1, parseInt(t.attrGet('colspan') || '1', 10) || 1);
      const rows = Math.max(1, parseInt(t.attrGet('rowspan') || '1', 10) || 1);
      cells.push({ token: t, col, span });
      for (let c = col; c < col + span; c++) rowTaken[c] = rows - 1;
      col += span;
      // a later rowspan from above may sit after this cell: skip it too
      while ((taken[col] || 0) > 0) col++;
    }
  }
  return { cells, width, end };
}

/**
 * The render rule (render mode only)
 * @param {import('markdown-it')} md
 */
export function columnWidthsPlugin(md) {
  md.core.ruler.push('table_column_widths', (state) => {
    if (isEditor(md)) return;
    const tokens = state.tokens;
    const Token = state.Token;
    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i];
      if (open.type !== 'table_open') continue;
      const directive = tableDirectiveAttrs(tokens[tableCloseOf(tokens, i) + 1]);
      const { fixed, widths } = tableLayoutOf(open.attrGet('class'), open.attrGet(COLUMN_WIDTHS_ATTR), directive?.widths ?? null);
      if (!fixed) continue;
      const style = open.attrGet('style');
      open.attrSet('style', style ? `table-layout:fixed;${style}` : 'table-layout:fixed');
      if (!widths.length) continue;

      const { cells, width } = tableCells(tokens, i);
      const columns = Array.from({ length: width }, (_, c) => widths[c] ?? null);
      for (const { token, col, span } of cells) {
        const parts = columns.slice(col, col + span);
        if (parts.length === span && parts.every((w) => w !== null)) appendStyle(token, `width:${percent(parts.reduce((a, b) => a + b, 0))}`);
      }

      // The <colgroup>: after the caption (it must be the table's first child), before thead/tbody
      let at = i + 1;
      if (tokens[at] && tokens[at].type === 'caption_open') {
        while (at < tokens.length && tokens[at].type !== 'caption_close') at++;
        at++;
      }
      const level = open.level + 1;
      // Every block token has a line range (C2): the colgroup's is the table's first line.
      const map = open.map ? [open.map[0], open.map[0] + 1] : null;
      const make = (type, tag, nesting, lvl) => {
        const t = new Token(type, tag, nesting);
        t.block = true;
        t.level = lvl;
        if (nesting >= 0) t.map = map;
        return t;
      };
      const group = [make('colgroup_open', 'colgroup', 1, level)];
      for (const w of columns) {
        const col = make('col', 'col', 0, level + 1);
        if (w !== null) col.attrSet('style', `width:${percent(w)}`);
        group.push(col);
      }
      group.push(make('colgroup_close', 'colgroup', -1, level));
      tokens.splice(at, 0, ...group);
      i = at + group.length - 1;
    }
  });
}
