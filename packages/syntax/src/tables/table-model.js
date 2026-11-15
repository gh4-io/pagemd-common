/**
 * pagemd tables in editor mode (phase C2) and their write rule (phase C3).
 *
 * markdown-it-multimd-table gives the HTML shape (colspan/rowspan attributes)
 * but not what the author wrote. In editor mode a core rule (after
 * `table_captions`) puts a table model on each table's `table_open` token
 * (`meta.table`) and stretches the table's line range over a
 * `Table: …` caption paragraph that markdown-it-table-captions moved into it.
 *
 * The model:
 *   {
 *     columns: [{ align: '' | 'left' | 'right' | 'center', wrap: boolean }],
 *     header:  Row[],          // [] = a headerless table (starts with the separator line)
 *     bodies:  Row[][],        // body groups, written with a blank line between them
 *     caption:      null | { text, position: 'top' | 'bottom', label: string | null }   // [text][label] line
 *     tableCaption: null | { text, form: 'table' | 'colon', position: 'top' | 'bottom' } // "Table: text" paragraph
 *   }
 * A table can have both: markdown-it-multimd-table reads the [text] line next
 * to the table, markdown-it-table-captions a "Table:"/":" paragraph before or after it.
 *   Row  = { cells: Cell[], multiline: boolean }
 *   Cell = { text: string, colspan: number, rowspan: number }
 * Cells are listed in reading order and skip the positions covered by a
 * colspan or rowspan. `text` is the cell's markdown as written between the
 * pipes (inline markdown; in a multi-line row, block markdown with line breaks).
 *
 * Tables inside a multi-line cell get no model (markdown-it-multimd-table
 * reads them from a separate text).
 */

import { oneLine } from '../shared/write.js';

const BRACKET_CAPTION = /\[(.+?)\](\[([^[\]]+)\])?\s*$/;

/**
 * The text of a multi-line cell's line, without the one space after the pipe
 * @param {string} s
 * @returns {string}
 */
const unpad = (s) => (s.startsWith(' ') ? s.slice(1) : s);

/**
 * Build the model of the table whose tokens run from `open` to `close`
 * @param {object[]} tokens - Block tokens
 * @param {number} open - Index of table_open
 * @param {number} close - Index of the matching table_close
 * @param {string} src - The source the tokens were read from
 * @param {string[]} lines - src split into lines
 * @returns {object|null}
 */
function modelFor(tokens, open, close, src, lines) {
  const tm = tokens[open].meta;
  if (!tm || !tm.sep || !Array.isArray(tm.tr)) return null;
  const columns = tm.sep.aligns.map((align, k) => ({ align, wrap: !!tm.sep.wraps[k] }));
  const header = [];
  const bodies = [];
  let group = null;
  let up = [];
  let caption = null;
  let tableCaption = null;

  if (tm.cap) {
    const m = (lines[tm.cap.map[0]] || '').match(BRACKET_CAPTION);
    caption = {
      text: tm.cap.text,
      position: tm.cap.first ? 'top' : 'bottom',
      label: m && m[3] !== undefined ? m[3] : null
    };
  }

  let k = open + 1;
  while (k < close) {
    const t = tokens[k];
    if (t.type === 'caption_open' && !(tm.cap && t.map === tm.cap.map) && !tableCaption) {
      const inline = tokens[k + 1];
      const first = (lines[t.map[0]] || '').replace(/^[\s>]*/, '');
      tableCaption = {
        text: inline.content,
        form: first.startsWith('Table:') ? 'table' : 'colon',
        position: t.map[0] < tokens[open].map[0] ? 'top' : 'bottom'
      };
    }
    if (t.type === 'thead_open') { group = header; up = []; }
    if (t.type === 'tbody_open') { group = []; bodies.push(group); up = []; }
    if (t.type === 'tr_open') {
      const cellTokens = [];
      let depth = 0;
      let e = k + 1;
      for (; e < close; e++) {
        const x = tokens[e];
        if (x.type === 'tr_close' && depth === 0) break;
        if ((x.type === 'td_open' || x.type === 'th_open') && depth === 0) cellTokens.push(x);
        if (x.type === 'table_open') depth++;
        if (x.type === 'table_close') depth--;
      }
      if (group) group.push(rowFor(t, cellTokens, src, up));
      k = e;
    }
    k++;
  }

  return { columns, header, bodies, caption, tableCaption };
}

/**
 * One row of the model, read from the source the way the plugin reads it
 * @param {object} tr - tr_open token (meta.bounds, meta.mbounds)
 * @param {object[]} cellTokens - Its th/td tokens, in order
 * @param {string} src - Source
 * @param {boolean[]} up - Per column: a cell above in this group (for ^^)
 * @returns {{cells: object[], multiline: boolean}}
 */
function rowFor(tr, cellTokens, src, up) {
  const bounds = tr.meta.bounds;
  const mbounds = tr.meta.mbounds;
  const multiline = !!(tr.meta.multiline && mbounds);
  const cells = [];
  let next = 0;
  for (let c = 0; c < bounds.length - 1; c++) {
    const text = src.slice(bounds[c] + 1, bounds[c + 1]);
    if (text === '') continue;
    if (up[c] && text.trim() === '^^') continue;
    const token = cellTokens[next++];
    if (!token) break;
    up[c] = true;
    let cellText;
    if (multiline) {
      const parts = [unpad(text.trimEnd())];
      for (let b = 1; b < mbounds.length; b++) {
        if (c > mbounds[b].length - 2) continue;
        parts.push(unpad(src.slice(mbounds[b][c] + 1, mbounds[b][c + 1]).trimEnd()));
      }
      while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
      cellText = parts.join('\n');
    } else {
      cellText = text.trim();
    }
    cells.push({
      text: cellText,
      colspan: Number(token.attrGet('colspan')) || 1,
      rowspan: Number(token.attrGet('rowspan')) || 1
    });
  }
  return { cells, multiline };
}

/**
 * Editor-mode core rule: a model on every table, and table lines that include a moved caption
 * @param {object} state - markdown-it core state
 */
export function modelTables(state) {
  const tokens = state.tokens;
  const lines = state.src.split('\n');
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'table_open') continue;
    let depth = 0;
    let j = i;
    for (; j < tokens.length; j++) {
      if (tokens[j].type === 'table_open') depth++;
      if (tokens[j].type === 'table_close' && --depth === 0) break;
    }
    const open = tokens[i];
    const model = modelFor(tokens, i, j, state.src, lines);
    open.meta = { ...open.meta, table: model };
    // table-captions moves a "Table: …" paragraph from outside the table into it
    for (let k = i + 1; k < j; k++) {
      const t = tokens[k];
      if (t.type === 'caption_open' && t.map && open.map) {
        open.map = [Math.min(open.map[0], t.map[0]), Math.max(open.map[1], t.map[1])];
      }
    }
    i = j;
  }
}

// ── write (phase C3) ──

/**
 * Escape a cell's text so the table reader gives it back: "|" outside code
 * spans gets a backslash, and (where a cell above makes "^^" a rowspan
 * marker) a cell that is only "^^" becomes "\^^".
 * @param {string} text - One line of cell markdown
 * @param {boolean} [belowCell=true] - A cell starts above this one in the same group
 * @returns {string}
 */
export function escapeCell(text, belowCell = true) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') { out += text.slice(i, i + 2); i += 2; continue; }
    if (ch === '`') {
      let n = 1;
      while (text[i + n] === '`') n++;
      const run = '`'.repeat(n);
      const end = findRun(text, i + n, n);
      if (end >= 0) { out += text.slice(i, end + n); i = end + n; continue; }
      out += run;
      i += n;
      continue;
    }
    out += ch === '|' ? '\\|' : ch;
    i++;
  }
  return belowCell && out.trim() === '^^' ? out.replace('^^', '\\^^') : out;
}

/**
 * Position of the next run of exactly n backticks at or after from
 * @returns {number} -1 when there is none
 */
function findRun(text, from, n) {
  for (let i = from; i < text.length; i++) {
    if (text[i] !== '`') continue;
    let m = 1;
    while (text[i + m] === '`') m++;
    if (m === n) return i;
    i += m - 1;
  }
  return -1;
}

/**
 * One separator cell: --- with ":" for alignment and "+" for wrap
 * @param {{align: string, wrap: boolean}} col
 * @returns {string}
 */
function separatorCell(col) {
  const left = col.align === 'left' || col.align === 'center' ? ':' : '';
  const right = col.align === 'right' || col.align === 'center' ? ':' : '';
  return ` ${left}---${right}${col.wrap ? '+' : ''} `;
}

/**
 * Write the rows of one group (the header, or one body)
 * @param {object[]} rows - Rows of the model
 * @param {number} ncols - Number of columns
 * @returns {string[]} Lines
 */
function groupLines(rows, ncols) {
  const covered = new Array(ncols).fill(null); // { rows, first } for rowspans from above
  const above = []; // per column: a cell started there in an earlier row of this group
  const out = [];
  for (const row of rows) {
    const parts = [];
    let next = 0;
    let span = 0;
    // A row may hold fewer or more cells than the table has columns: write what it holds
    const coveredLater = (from) => covered.some((c, k) => k >= from && c && c.rows > 0);
    for (let col = 0; col < ncols || next < row.cells.length || span > 0; col++) {
      // The columns a cell spans in its own row come first: `covered` (set by that same cell when it also spans rows) is
      // for the rows below it. Checked the other way round, a cell spanning columns and rows used its covered columns up in
      // its own row: `| x ||| 6 |` (three columns) and `| ^^ | 9 |` below (pagemd-editor fix run undo-bg-table-split).
      if (span > 0) { parts.push({ kind: 'span' }); span--; continue; }
      if (covered[col] && covered[col].rows > 0) {
        parts.push({ kind: covered[col].first ? 'up' : 'span' });
        covered[col].rows--;
        continue;
      }
      const cell = row.cells[next++];
      if (!cell) {
        if (!coveredLater(col + 1)) break;
        parts.push({ kind: 'cell', lines: [''] });
        continue;
      }
      const colspan = Math.max(1, Number(cell.colspan) || 1);
      const rowspan = Math.max(1, Number(cell.rowspan) || 1);
      parts.push({ kind: 'cell', lines: String(cell.text ?? '').split('\n'), below: !!above[col], col });
      span = colspan - 1;
      if (rowspan > 1) {
        for (let k = 0; k < colspan; k++) covered[col + k] = { rows: rowspan - 1, first: k === 0 };
      }
    }
    const multiline = row.multiline || parts.some((p) => p.kind === 'cell' && p.lines.length > 1);
    const count = multiline ? Math.max(2, ...parts.map((p) => (p.kind === 'cell' ? p.lines.length : 1))) : 1;
    for (let l = 0; l < count; l++) {
      const cells = parts.map((p) => {
        if (p.kind === 'span') return '';
        if (p.kind === 'up') return l === 0 ? ' ^^ ' : '  ';
        const line = p.lines[l] ?? '';
        return ` ${escapeCell(multiline ? line : line.trim(), p.below && l === 0)} `;
      });
      out.push(`|${cells.join('|')}|${l < count - 1 ? ' \\' : ''}`);
    }
    for (const p of parts) if (p.kind === 'cell') above[p.col] = true;
  }
  return out;
}

/**
 * Write the [text][label] caption line (markdown-it-multimd-table)
 * @param {{text: string, label?: string|null}} caption - The model's caption
 * @returns {string}
 */
export function writeBracketCaption(caption) {
  const text = oneLine(caption.text).replace(/\[/g, '(').replace(/\]/g, ')');
  const label = caption.label ? oneLine(caption.label).replace(/[[\]]/g, '') : '';
  return `[${text}]${label ? `[${label}]` : ''}`;
}

/**
 * Write a "Table: text" (or ": text") caption paragraph (markdown-it-table-captions)
 * @param {{text: string, form?: 'table'|'colon'}} caption - The model's tableCaption
 * @returns {string}
 */
export function writeTableCaption(caption) {
  const text = oneLine(caption.text);
  return caption.form === 'colon' ? `: ${text}` : `Table: ${text}`;
}

/**
 * Write a pagemd table back to markdown
 * @param {object} data - The model (table_open `meta.table`)
 * @returns {string}
 *
 * Canonical example:
 *   writeTable({ columns: [{ align: '' }, { align: 'center' }],
 *                header: [{ cells: [{ text: 'Name' }, { text: 'Qty' }] }],
 *                bodies: [[{ cells: [{ text: 'Bolt', colspan: 2 }] }]] })
 *   → '| Name | Qty |\n| --- | :---: |\n| Bolt ||'
 */
export function writeTable(data) {
  const ncols = Math.max(1, (data.columns || []).length);
  const columns = Array.from({ length: ncols }, (_, k) => (data.columns || [])[k] || { align: '', wrap: false });
  const out = [];
  const cap = data.caption;
  const para = data.tableCaption;
  if (para && para.position === 'top') out.push(writeTableCaption(para), '');
  if (cap && cap.position === 'top') out.push(writeBracketCaption(cap));
  out.push(...groupLines(data.header || [], ncols));
  out.push(`|${columns.map(separatorCell).join('|')}|`);
  (data.bodies || []).forEach((body, k) => {
    if (k > 0) out.push('');
    out.push(...groupLines(body, ncols));
  });
  if (cap && cap.position !== 'top') out.push(writeBracketCaption(cap));
  if (para && para.position !== 'top') out.push('', writeTableCaption(para));
  return out.join('\n');
}
