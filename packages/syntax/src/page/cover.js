/**
 * <!-- ::COVER_START --> … <!-- ::COVER_END --> cover page wrapper.
 */

import { registerDirective, directiveWriter } from '../shared/directives.js';

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'cover',
  group: 'page',
  read(md) {
    registerDirective(md, 'COVER_START', (token, { state }) => {
      (state.sectionStack ??= []).push('cover');
      token.content = '<div class="cover">\n';
      return true;
    }, { item: 'cover' });
    registerDirective(md, 'COVER_END', (token, { state }) => {
      const sectionStack = (state.sectionStack ??= []);
      if (sectionStack.length > 0 && sectionStack[sectionStack.length - 1] === 'cover') {
        sectionStack.pop();
      }
      token.content = '</div>\n';
      return true;
    }, { item: 'cover' });
  },
  write: directiveWriter([]),
  htmlContract: ['<div class="cover">…</div>'],
  params: []
};
