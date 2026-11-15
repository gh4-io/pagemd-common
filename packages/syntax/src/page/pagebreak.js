/**
 * <!-- ::PAGEBREAK --> forces a page break.
 */

import { registerDirective, directiveWriter } from '../shared/directives.js';

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'pagebreak',
  group: 'page',
  read(md) {
    registerDirective(md, 'PAGEBREAK', (token) => {
      token.content = '<div class="break-page"></div>\n';
      return true;
    }, { item: 'pagebreak' });
  },
  write: directiveWriter([]),
  htmlContract: ['<div class="break-page"></div>'],
  params: []
};
