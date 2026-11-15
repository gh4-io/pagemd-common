/**
 * Task lists (pagemd-editor P26): `- [ ] to do`, `- [x] done` (also `[X]`), in any list (bullets, numbers, fancy
 * lists), nested or loose. Our own rule, written after markdown-it-task-lists 2.1.1 (ISC), which we checked and did
 * not take (research/footnote-tasklist-integration.md): it keeps its options in module-wide variables (one
 * instance's options leak into the next), is CommonJS only, and gives an editor no data to write the box back
 * from. This rule reads exactly what that plugin reads and writes the same HTML, byte for byte:
 *
 *   <ul class="contains-task-list">
 *   <li class="task-list-item"><input class="task-list-item-checkbox" disabled="" type="checkbox"> to do</li>
 *   <li class="task-list-item"><input class="task-list-item-checkbox" checked="" disabled="" type="checkbox"> done</li>
 *
 * A task is a list item whose first paragraph starts with `[ ] `, `[x] ` or `[X] ` (one space after the bracket;
 * the plugin's rule). Not a task: `[ ]` with nothing after it, a tab after the bracket, `[ ]` later in the line,
 * `[x](url)` (a link).
 *
 * Editor mode: no checkbox HTML; the list item's token carries `meta.task` = { checked, mark, gap } (`mark` is the
 * character as written, `gap` the spaces after the bracket) and the item's text starts after the gap. Write rule:
 * writeTaskMarker({ checked, mark, gap }) → `[x] ` (the mark kept when it still says the same: `X` stays `X`).
 */

import { isEditor } from '../shared/mode.js';

const MARKER = /^\[([ xX])\] /;

/**
 * The look task lists need, GitHub's (github-markdown-css 5.9.0): the list keeps its 2em indent and each box is pulled back
 * 1.4em into it (`margin: 0 .2em .25em -1.4em`), so the box starts 0.6em in, then a small gap, then the text; no bullet.
 * pagemd adds it only to documents that have task lists, in the `structural` layer, after the profile's (so every profile gets the
 * same look whatever indent its lists have; the document's own `styles:` still win). The box is drawn in the text color (a disabled
 * checkbox is drawn light grey by the browser, too faint on paper).
 */
export const TASK_LISTS_STRUCTURAL_CSS = [
  '.contains-task-list { list-style: none; padding-left: 2em; }',
  '.task-list-item { list-style: none; }',
  '.task-list-item-checkbox { -webkit-appearance: none; appearance: none; display: inline-block; position: relative; box-sizing: border-box;'
    + ' width: 0.9em; height: 0.9em; margin: 0 .2em .25em -1.4em; vertical-align: middle; border: 0.08em solid currentColor; border-radius: 0.15em;'
    + ' background: transparent; opacity: 1; }',
  'ul:dir(rtl) .task-list-item-checkbox, ol:dir(rtl) .task-list-item-checkbox { margin: 0 -1.6em .25em .2em; }',
  '.task-list-item-checkbox:checked::after { content: ""; position: absolute; left: 0.27em; top: 0.06em; width: 0.22em; height: 0.48em;'
    + ' border: solid currentColor; border-width: 0 0.12em 0.12em 0; transform: rotate(45deg); }'
].join('\n');

/** Add a class unless the token has it */
function addClass(token, name) {
  const current = token.attrGet('class');
  if (!current) token.attrSet('class', name);
  else if (!current.split(/\s+/).includes(name)) token.attrSet('class', `${current} ${name}`);
}

/** The list (open token) an item belongs to: the nearest token before it one level up */
function parentList(tokens, index) {
  const level = tokens[index].level - 1;
  for (let i = index - 1; i >= 0; i--) if (tokens[i].level === level) return tokens[i];
  return null;
}

/**
 * The task marker at the start of an item's first paragraph
 * @returns {{ mark: string, gap: string } | null}
 */
function taskAt(tokens, i) {
  const inline = tokens[i];
  if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') return null;
  const first = inline.children && inline.children[0];
  const m = MARKER.exec(inline.content);
  if (!m || !first || first.type !== 'text' || !first.content.startsWith(m[0])) return null;
  const gap = /^ +/.exec(inline.content.slice(3))[0];
  return { mark: m[1], gap };
}

function taskLists(state) {
  const tokens = state.tokens;
  const editor = isEditor(state.md);
  for (let i = 2; i < tokens.length; i++) {
    const found = taskAt(tokens, i);
    if (!found) continue;
    const inline = tokens[i];
    const item = tokens[i - 2];
    const checked = found.mark !== ' ';
    if (editor) {
      // The text starts after the gap; the box is the item's data
      const cut = 3 + found.gap.length;
      inline.content = inline.content.slice(cut);
      inline.children[0].content = inline.children[0].content.slice(cut);
      item.meta = { ...(item.meta || {}), task: { checked, mark: found.mark, gap: found.gap } };
      continue;
    }
    // Render mode: markdown-it-task-lists 2.1.1's tokens (its HTML, byte for byte)
    const box = new state.Token('html_inline', '', 0);
    box.content = `<input class="task-list-item-checkbox"${checked ? ' checked=""' : ''} disabled="" type="checkbox">`;
    inline.children[0].content = inline.children[0].content.slice(3);
    inline.content = inline.content.slice(3);
    inline.children.unshift(box);
    addClass(item, 'task-list-item');
    const list = parentList(tokens, i - 2);
    if (list) addClass(list, 'contains-task-list');
  }
}

/**
 * Task marker write rule
 * @param {object} data - { checked, mark?, gap? } (what the list item's editor-mode token carries)
 * @returns {string} e.g. '[x] '
 */
export function writeTaskMarker(data) {
  const was = typeof data.mark === 'string' ? data.mark : ' ';
  const mark = data.checked ? (was === 'x' || was === 'X' ? was : 'x') : ' ';
  const gap = typeof data.gap === 'string' && /^ +$/.test(data.gap) ? data.gap : ' ';
  return `[${mark}]${gap}`;
}

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'task-lists',
  group: 'lists',
  read(md) {
    // Right after the inline rule, as markdown-it-task-lists: before markdown-it-attrs reads `{…}` (so `{.done}` adds a class)
    md.core.ruler.after('inline', 'pagemd_task_lists', taskLists);
  },
  write: writeTaskMarker,
  structuralCss: TASK_LISTS_STRUCTURAL_CSS,
  htmlContract: [
    '<ul class="contains-task-list"><li class="task-list-item"><input class="task-list-item-checkbox" disabled="" type="checkbox"> …</li></ul>',
    '<input class="task-list-item-checkbox" checked="" disabled="" type="checkbox">'
  ],
  params: [
    { key: 'checked', type: 'boolean', label: 'Done', default: false }
  ]
};
