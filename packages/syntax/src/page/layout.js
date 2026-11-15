/**
 * <!-- ::LAYOUT(name) --> (or name="…") switches to a named page layout.
 * A second LAYOUT closes the previous layout's div first.
 */

import { registerDirective, directiveWriter } from '../shared/directives.js';

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'layout',
  group: 'page',
  read(md) {
    registerDirective(md, 'LAYOUT', (token, { parenParams, attrs, state }) => {
      const layoutName = parenParams || attrs.name || 'default';
      if (state.inLayout) {
        token.content = `</div>\n<div class="page-${md.utils.escapeHtml(layoutName)}">\n`;
      } else {
        token.content = `<div class="page-${md.utils.escapeHtml(layoutName)}">\n`;
        state.inLayout = true;
      }
      return true;
    }, { item: 'layout' });
  },
  write: directiveWriter(['name']),
  htmlContract: ['<div class="page-{name}">…'],
  params: [
    { key: 'name', type: 'string', help: 'Layout name, in parentheses or as name="…"; default "default"' }
  ]
};
