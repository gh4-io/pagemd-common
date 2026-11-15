/**
 * Advanced tables - replaces the built-in GFM table parser.
 * Adds: colspan (||), rowspan (^^), multiline cells (\), headerless tables.
 */

import markdownItMultimdTable from 'markdown-it-multimd-table';
import { writeTable } from './table-model.js';

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'multimd-table',
  group: 'tables',
  read(md) {
    // Adapter (U1): markdown-it 15 removed `md.utils.assign`, which markdown-it-multimd-table 4.2.3
    // still calls once to merge its options. Put it back as Object.assign (upstream's own fix, PR #83:
    // github.com/redbug312/markdown-it-multimd-table/pull/83). test/multimd-table-adapter.test.js
    // fails once an installed release stops needing it; then delete these lines.
    if (typeof md.utils.assign !== 'function') md.utils.assign = Object.assign;
    md.use(markdownItMultimdTable, {
      multiline: true,
      rowspan: true,
      headerless: true
    });
  },
  // Phase C3: from the table model an editor-mode table_open carries (meta.table); see table-model.js
  write: writeTable,
  htmlContract: [
    '<table><thead><tr><th>…</th></tr></thead><tbody><tr><td>…</td></tr></tbody></table>',
    '<td colspan="N">', '<td rowspan="N">'
  ],
  params: []
};
