/**
 * <!-- ::INCLUDE path="…" --> placeholder. (The file-reading !!!include(path)!!!
 * form is a render-only step that pagemd's parser adds itself.)
 */

import { registerDirective, directiveWriter } from '../shared/directives.js';

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'include-directive',
  group: 'document',
  read(md) {
    registerDirective(md, 'INCLUDE', (token, { attrs }) => {
      const includePath = attrs.path || attrs.src || '';
      if (includePath) {
        const escapedPath = md.utils.escapeHtml(includePath);
        token.content = `<div class="include-placeholder" data-path="${escapedPath}">[Include: ${escapedPath}]</div>\n`;
      }
      return true;
    }, { item: 'include-directive' });
  },
  write: directiveWriter(['path']),
  htmlContract: ['<div class="include-placeholder" data-path="{path}">[Include: {path}]</div>'],
  params: [
    { key: 'path', type: 'path', help: 'Also accepted as src="…"' }
  ]
};
