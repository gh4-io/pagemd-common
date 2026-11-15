/**
 * <!-- ::INDEX term="…" sort="…" --> marks a word for the index, including
 * markers embedded in other content ("<!-- ::INDEX term="x" -->Text after").
 * The bare <!-- ::INDEX --> placeholder is the page/index-block item.
 */

import { registerDirective, registerDirectiveFallback, parseDirectiveAttributes, directiveWriter } from '../shared/directives.js';

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'index-marker',
  group: 'text',
  read(md) {
    registerDirective(md, 'INDEX', (token, { attrs }) => {
      const indexTerm = attrs.term || '';
      if (!indexTerm) return false;
      const sortKey = attrs.sort || indexTerm.toLowerCase();
      // Inline marker - no newline to avoid breaking text flow
      token.content = `<span class="index-marker" data-term="${md.utils.escapeHtml(indexTerm)}" data-sort="${md.utils.escapeHtml(sortKey)}"></span>`;
      return true;
    }, { item: 'index-marker', accepts: ({ attrs }) => !!attrs.term });

    /**
     * Replace inline INDEX markers within mixed content (e.g., list items)
     * @param {Object} token - Token to process
     * @returns {boolean} True if any replacements were made
     */
    registerDirectiveFallback(md, (token) => {
      const content = token.content;
      // Match INDEX markers that may be embedded in other content
      const indexRegex = /<!--\s*::INDEX\s+(.*?)\s*-->/g;

      if (!indexRegex.test(content)) {
        return false;
      }

      // Reset regex state
      indexRegex.lastIndex = 0;

      token.content = content.replace(indexRegex, (match, attrString) => {
        const attrs = parseDirectiveAttributes(attrString);
        const term = attrs.term || '';
        if (term) {
          const sortKey = attrs.sort || term.toLowerCase();
          return `<span class="index-marker" data-term="${md.utils.escapeHtml(term)}" data-sort="${md.utils.escapeHtml(sortKey)}"></span>`;
        }
        // No term = placeholder (shouldn't happen inline, but handle gracefully)
        return '<div class="index-placeholder"></div>';
      });

      return true;
    });
  },
  write: directiveWriter(['term', 'sort']),
  htmlContract: ['<span class="index-marker" data-term="{term}" data-sort="{sort}"></span>'],
  params: [
    { key: 'term', type: 'string' },
    { key: 'sort', type: 'string', help: 'Sort key (defaults to the term in lower case)' }
  ]
};
