/**
 * Table captions - "Table: Caption text" before/after a table.
 *
 * Editor mode (phase C2) adds one core rule right after `table_captions`:
 * every table gets its model (`table_open.meta.table`, see ./table-model.js),
 * and a caption paragraph moved into a table widens the table's line range to
 * include it, so the table and its caption are one block.
 */

import markdownItTableCaptions from 'markdown-it-table-captions';
import { isEditor } from '../shared/mode.js';
import { modelTables, writeTableCaption } from './table-model.js';

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'table-captions',
  group: 'tables',
  read(md) {
    md.use(markdownItTableCaptions);
    if (isEditor(md)) md.core.ruler.after('table_captions', 'pagemd_table_model', modelTables);
  },
  // Phase C3: 'Table: text' or ': text' (the table model's tableCaption)
  write: writeTableCaption,
  htmlContract: ['<table><caption>…</caption>…</table>'],
  params: []
};
