/**
 * !!!include(path)!!! - pull another markdown file in (phase C2).
 *
 * Render mode registers nothing: reading files is not browser-safe, so pagemd's
 * parser adds its own include expander (the `beforeContainers` slot; phase C12,
 * it replaced markdown-it-include), which splices the file's text in before
 * parsing, using the text rules in ./include-rules.js. Paths resolve from the
 * document's folder (R-52). Since C12 the renderer expands only what editor mode
 * makes an atom: a line that holds only the include, outside code.
 *
 * Editor mode never reads files: a line that holds only an include becomes one
 * atom token, `pagemd_include`, with its line range and `meta = { path }`, so
 * the editor can show it and write it back unchanged. An include in the middle
 * of other text stays plain text (kept exactly as written).
 */

import { isEditor } from '../shared/mode.js';
import { oneLine } from '../shared/write.js';

/** The include pattern (markdown-it-include's, braces required), on a line of its own */
const INCLUDE_LINE = /^!{3}\s*include(.+?)!{3}\s*$/i;
const BRACES = /\((.+?)\)/;

/**
 * Block rule: a line that is only !!!include(path)!!!
 * @param {object} state - markdown-it block state
 * @param {number} startLine - Line to test
 * @param {number} endLine - Last line (exclusive)
 * @param {boolean} silent - Only test
 * @returns {boolean}
 */
function includeRule(state, startLine, endLine, silent) {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const pos = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const line = state.src.slice(pos, max).match(INCLUDE_LINE);
  const match = line && BRACES.exec(line[1]);
  if (!match) return false;
  if (silent) return true;

  const token = state.push('pagemd_include', 'div', 0);
  token.block = true;
  token.content = state.src.slice(pos, max);
  token.map = [startLine, startLine + 1];
  token.meta = { path: match[1].trim() };
  state.line = startLine + 1;
  return true;
}

/**
 * Write an include back to markdown
 * @param {{path: string}} data - What the pagemd_include token carries in `meta`
 * @returns {string}
 */
export function writeInclude(data) {
  // The reader stops the path at the first ")", so a path cannot hold one
  return `!!!include(${oneLine(data.path).replace(/\)/g, '')})!!!`;
}

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'include',
  group: 'document',
  read(md) {
    if (!isEditor(md)) return;
    md.block.ruler.before('paragraph', 'pagemd_include', includeRule);
    md.renderer.rules.pagemd_include = (tokens, idx) => {
      const path = md.utils.escapeHtml(tokens[idx].meta.path);
      return `<div class="include-placeholder" data-path="${path}">[Include: ${path}]</div>\n`;
    };
  },
  write: writeInclude,
  htmlContract: ['(render mode: the included file\'s content; editor mode: <div class="include-placeholder" data-path="{path}">[Include: {path}]</div>)'],
  params: [
    { key: 'path', type: 'path', label: 'File', help: 'Markdown file, relative to this document' }
  ]
};
