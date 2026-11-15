/**
 * <!-- ::INDEX --> (no term) marks where the generated index goes.
 * The term form <!-- ::INDEX term="…" --> is the text/index-marker item.
 */

import { registerDirective, directiveWriter } from '../shared/directives.js';

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'index',
  group: 'page',
  read(md) {
    registerDirective(md, 'INDEX', (token, { attrs }) => {
      if (attrs.term) return false;
      // Placeholder for generated index
      token.content = `<div class="index-placeholder"></div>\n`;
      return true;
    }, { item: 'index', accepts: ({ attrs }) => !attrs.term });
  },
  write: directiveWriter([]),
  htmlContract: ['<div class="index-placeholder"></div>'],
  params: []
};
