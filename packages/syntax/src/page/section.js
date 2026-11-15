/**
 * <!-- ::SECTION_START class="…" id="…" --> … <!-- ::SECTION_END --> wrapper div.
 */

import { registerDirective, directiveWriter } from '../shared/directives.js';

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'section',
  group: 'page',
  read(md) {
    registerDirective(md, 'SECTION_START', (token, { attrs, state }) => {
      const className = attrs.class || '';
      const sectionId = attrs.id || '';
      (state.sectionStack ??= []).push('section');
      let sectionAttrs = '';
      if (sectionId) sectionAttrs += ` id="${md.utils.escapeHtml(sectionId)}"`;
      if (className) sectionAttrs += ` class="${md.utils.escapeHtml(className)}"`;
      token.content = `<div${sectionAttrs}>\n`;
      return true;
    }, { item: 'section' });
    registerDirective(md, 'SECTION_END', (token, { state }) => {
      const sectionStack = (state.sectionStack ??= []);
      if (sectionStack.length > 0) {
        sectionStack.pop();
      }
      token.content = '</div>\n';
      return true;
    }, { item: 'section' });
  },
  write: directiveWriter(['id', 'class']),
  htmlContract: ['<div id="{id}" class="{class}">…</div>'],
  params: [
    { key: 'class', type: 'string' },
    { key: 'id', type: 'string' }
  ]
};
