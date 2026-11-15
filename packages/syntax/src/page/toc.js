/**
 * <!-- ::TOC levels=3 min=1 pages=false pageLevels=2 section --> table of contents placeholder.
 * A bare <!-- ::TOC --> is placement-only; frontmatter controls settings.
 */

import { registerDirective, directiveWriter } from '../shared/directives.js';

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'toc',
  group: 'page',
  read(md) {
    registerDirective(md, 'TOC', (token, { attrs }) => {
      // Only emit data attributes when explicitly set in the directive.
      // <!-- ::TOC levels="3" --> explicitly overrides frontmatter.
      let tocAttrs = '';
      if (attrs.levels !== undefined) {
        tocAttrs += ` data-levels="${md.utils.escapeHtml(String(attrs.levels))}"`;
      }
      if (attrs.min !== undefined) {
        tocAttrs += ` data-min-level="${md.utils.escapeHtml(String(attrs.min))}"`;
      }
      if (attrs.pages !== undefined) {
        const showPages = (attrs.pages === 'false' || attrs.pages === '0' || attrs.pages === 'no') ? 'false' : 'true';
        tocAttrs += ` data-pages="${showPages}"`;
      }
      if (attrs.pageLevels !== undefined) {
        tocAttrs += ` data-page-levels="${md.utils.escapeHtml(String(attrs.pageLevels))}"`;
      }
      // 'section' keyword: detect as flag (attrs.section === true from parseDirectiveAttributes)
      if (attrs.section !== undefined) {
        tocAttrs += ` data-scope="section"`;
      }
      token.content = `<div class="toc-placeholder"${tocAttrs}></div>\n`;
      return true;
    }, { item: 'toc' });
  },
  write: directiveWriter(['levels', 'min', 'pages', 'pageLevels', 'section']),
  htmlContract: ['<div class="toc-placeholder" data-levels="…" data-min-level="…" data-pages="true|false" data-page-levels="…" data-scope="section"></div>'],
  params: [
    { key: 'levels', type: 'number', help: 'Deepest heading level listed' },
    { key: 'min', type: 'number', help: 'Shallowest heading level listed' },
    { key: 'pages', type: 'boolean', help: 'Show page numbers (false | 0 | no turn them off)' },
    { key: 'pageLevels', type: 'number', help: 'Deepest level that shows page numbers' },
    { key: 'section', type: 'boolean', help: 'Flag: only the current section' }
  ]
};
