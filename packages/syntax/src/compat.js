/**
 * The plugin functions pagemd's parser exported before the split, kept so
 * existing callers (and their tests) keep working. New code should use
 * createDialect() or the item modules.
 */

import { blockCalloutPlugin } from './blocks/callouts.js';
import { inlineCalloutPlugin, inlineCalloutRenderer } from './text/inline-callout.js';
import { figurePlugin } from './media/figure.js';
import { annotatedImagePlugin } from './media/annotated-image.js';
import { wikilinkEmbedPlugin } from './media/embeds.js';
import { wikilinkLinkPlugin } from './text/wikilinks.js';
import pagebreak from './page/pagebreak.js';
import toc from './page/toc.js';
import section from './page/section.js';
import layout from './page/layout.js';
import cover from './page/cover.js';
import indexBlock from './page/index-block.js';
import indexMarker from './text/index-marker.js';
import includeDirective from './document/include-directive.js';

/**
 * Block callouts [[WARNING]]/[[DANGER]] plus the inline [!WARNING]/[!DANGER] badge
 * @param {MarkdownIt} md - Markdown-it instance
 */
export function calloutPlugin(md) {
  blockCalloutPlugin(md);
  inlineCalloutPlugin(md);
  inlineCalloutRenderer(md);
}

/**
 * Obsidian-style [[Page]] links and ![[image]] embeds
 * @param {MarkdownIt} md - markdown-it instance
 * @param {object} options - baseUrl, imageBaseUrl, linkClass, imageClass, generateSlugs
 */
export function wikilinkPlugin(md, options = {}) {
  wikilinkEmbedPlugin(md, options);
  wikilinkLinkPlugin(md, options);
}

/**
 * Register callouts, figures and annotated images
 * @param {MarkdownIt} md - Markdown-it instance
 * @returns {MarkdownIt} Same instance (for chaining)
 */
export function registerExtensions(md) {
  md.use(calloutPlugin);
  md.use(figurePlugin);
  md.use(annotatedImagePlugin);
  return md;
}

/**
 * All comment directives: PAGEBREAK, TOC, SECTION_START/END, LAYOUT,
 * COVER_START/END, INCLUDE, INDEX
 * @param {MarkdownIt} md - Markdown-it instance
 */
export function directivesPlugin(md) {
  for (const item of [pagebreak, toc, section, layout, cover, includeDirective, indexBlock, indexMarker]) {
    item.read(md, 'render', {});
  }
}

/**
 * Register directives plugin with markdown-it instance
 * @param {MarkdownIt} md - Markdown-it instance
 * @returns {MarkdownIt} Same instance for chaining
 */
export function registerDirectives(md) {
  md.use(directivesPlugin);
  return md;
}
