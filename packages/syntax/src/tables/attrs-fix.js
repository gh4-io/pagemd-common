import { columnWidthsPlugin } from './column-widths.js';

/**
 * Fix for markdown-it-attrs hiding colspan/rowspan table cells produced by
 * multimd-table (attrs' "tables tbody calculate" pattern miscounts columns
 * when colspan is used).
 *
 * Must be registered AFTER markdown-it-attrs.
 */

/**
 * Fix markdown-it-attrs incorrectly hiding colspan/rowspan table cells.
 *
 * The attrs plugin's "tables tbody calculate" pattern counts columns
 * from the header and hides cells that "exceed" the count. When
 * multimd-table produces colspan cells (which reduce the visible cell
 * count per row), attrs misinterprets these rows as having too many
 * cells and hides the colspan cells.
 *
 * This core rule runs AFTER attrs and un-hides any td/th tokens that
 * carry colspan or rowspan attributes, along with their inline content.
 *
 * Must be registered AFTER markdown-it-attrs.
 *
 * @param {import('markdown-it')} md - markdown-it instance
 */
/**
 * Two-phase fix for markdown-it-attrs hiding colspan/rowspan cells.
 *
 * Phase 1 (pre-attrs): Saves content of colspan/rowspan cells so it
 *   can be restored after attrs wipes it.
 * Phase 2 (post-attrs): Restores hidden cells that have colspan/rowspan,
 *   including their inline content.
 *
 * @param {import('markdown-it')} md - markdown-it instance
 */
export function tableAttrsFixPlugin(md) {
  // Phase 1: Run BEFORE attrs — snapshot colspan/rowspan cell content
  // Also fix missing meta on tbody_open (headerless tables) to prevent
  // attrs "tables tbody calculate" pattern from crashing.
  md.core.ruler.before('curly_attributes', 'table_attrs_save', (state) => {
    const tokens = state.tokens;
    let inSpanTable = false;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      // Fix headerless tables: attrs expects tbody_open.meta.colsnum
      // which is set by the "tables thead metadata" pattern from thead.
      // Headerless tables have no thead, so we count columns from the
      // first row and set meta.colsnum to prevent the TypeError.
      // Tables WITH a header are skipped — attrs sets colsnum correctly
      // from the thead. Counting from the body would give wrong results
      // when the first body row is a colspan row (counts 1 instead of 2).
      if (token.type === 'tbody_open' && (!token.meta || token.meta.colsnum == null)) {
        const prevToken = i > 0 ? tokens[i - 1] : null;
        if (!prevToken || prevToken.type !== 'thead_close') {
          // Truly headerless — count from first body row, accounting for colspan
          let colCount = 0;
          for (let j = i + 1; j < tokens.length; j++) {
            if (tokens[j].type === 'tr_close') break;
            if (tokens[j].type === 'td_open' || tokens[j].type === 'th_open') {
              colCount += parseInt(tokens[j].attrGet('colspan') || '1', 10);
            }
          }
          token.meta = Object.assign({}, token.meta, { colsnum: colCount });
        }
      }

      // A table that has any colspan/rowspan cell: attrs may also hide the
      // plain cell AFTER a `||` span (`| 1 || 2 |`), so every cell of such a
      // table is snapshotted (OQ-29). Cells hidden before attrs run stay hidden.
      if (token.type === 'table_open') {
        inSpanTable = false;
        for (let j = i + 1; j < tokens.length && tokens[j].type !== 'table_close'; j++) {
          const t = tokens[j];
          if ((t.type === 'td_open' || t.type === 'th_open') &&
              (t.attrGet('colspan') || t.attrGet('rowspan'))) {
            inSpanTable = true;
            break;
          }
        }
      } else if (token.type === 'table_close') {
        inSpanTable = false;
      }

      if ((token.type === 'td_open' || token.type === 'th_open') &&
          (inSpanTable || token.attrGet('colspan') || token.attrGet('rowspan'))) {
        // Save all tokens from td_open to td_close (inclusive).
        // Store token object references (not indices) — indices shift when
        // curly_attributes splices the {.class} annotation paragraphs, which
        // would corrupt any index-based restore for tables that appear after
        // the first table in the document.
        const closeType = token.type === 'td_open' ? 'td_close' : 'th_close';
        const saved = [];
        for (let j = i; j < tokens.length; j++) {
          const t = tokens[j];
          saved.push({
            token: t,
            hidden: t.hidden,
            content: t.content,
            children: t.children ? t.children.map(c => ({
              token: c,
              hidden: c.hidden,
              content: c.content
            })) : null
          });
          if (t.type === closeType && t.level === token.level && j > i) {
            break;
          }
        }
        // Store snapshot on the td_open token
        token._savedCellTokens = saved;
      }
    }
  });

  // Phase 2: Run AFTER attrs — restore any cells that attrs hid
  md.core.ruler.push('table_attrs_restore', (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token._savedCellTokens && token.hidden) {
        // Attrs hid this cell — restore from snapshot
        for (const snap of token._savedCellTokens) {
          snap.token.hidden = snap.hidden;
          snap.token.content = snap.content;
          if (snap.children) {
            for (const childSnap of snap.children) {
              childSnap.token.hidden = childSnap.hidden;
              childSnap.token.content = childSnap.content;
            }
          }
        }
        delete token._savedCellTokens;
      } else if (token._savedCellTokens) {
        // Cell wasn't hidden — just clean up
        delete token._savedCellTokens;
      }
    }
  });
}

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'attrs-fix',
  group: 'tables',
  read(md) {
    tableAttrsFixPlugin(md);
    // Column widths from the table's `{…}` line (pagemd-editor P19): also after
    // markdown-it-attrs and after the restore above, so restored cells get theirs.
    columnWidthsPlugin(md);
  },
  htmlContract: [
    '<table style="table-layout:fixed"> for .fixed-layout or data-col-widths',
    '<colgroup><col style="width:N%">…</colgroup> and <td style="width:N%"> for data-col-widths'
  ],
  params: []
};
