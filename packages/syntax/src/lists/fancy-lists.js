/**
 * Fancy lists: letter (a. A.) and Roman numeral (i. I.) ordered lists.
 * Opt-in: registered only when the document property fancy_lists is true
 * (the caller passes it in options.fields; this package never reads the environment).
 */

import { markdownItFancyListPlugin as baseFancyListPlugin } from 'markdown-it-fancy-lists'
import { listMarker } from './fancy-lists-write.js'

/**
 * Map of type attribute values to CSS class names
 * Case-sensitive: 'a' vs 'A' produce different classes
 */
const TYPE_TO_CLASS = {
  'a': 'list-lower-alpha',
  'A': 'list-upper-alpha',
  'i': 'list-lower-roman',
  'I': 'list-upper-roman'
  // Note: '1' (decimal) is browser default, no class needed
}

/**
 * Enhanced fancy list plugin that adds CSS classes for reliable styling
 * Browsers treat type attribute as case-insensitive, but we need case-sensitive
 * styling (a→lowercase, A→uppercase). This plugin adds classes that CSS can target.
 *
 * @param {MarkdownIt} md - markdown-it instance
 */
export function markdownItFancyListPlugin(md) {
  // Apply the base fancy-lists plugin first
  md.use(baseFancyListPlugin)

  // Store the original renderer (or create a proxy if none exists)
  const defaultRenderer = md.renderer.rules.ordered_list_open ||
    function(tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options)
    }

  // Override the ordered_list_open renderer to add CSS classes
  md.renderer.rules.ordered_list_open = function(tokens, idx, options, env, self) {
    const token = tokens[idx]

    // Get the type attribute value (case-sensitive at token level)
    const typeAttr = token.attrGet('type')

    if (typeAttr && TYPE_TO_CLASS[typeAttr]) {
      // Add the corresponding CSS class
      token.attrJoin('class', TYPE_TO_CLASS[typeAttr])
    }

    // Call the original renderer
    return defaultRenderer(tokens, idx, options, env, self)
  }
}

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'fancy-lists',
  group: 'lists',
  gate: { field: 'fancy_lists', value: true },
  read(md) {
    md.use(markdownItFancyListPlugin);
  },
  // Phase C3: the marker of item data.index; see fancy-lists-write.js
  write: (data) => listMarker(data, data.index || 0),
  htmlContract: ['<ol type="a|A|i|I" class="list-lower-alpha|list-upper-alpha|list-lower-roman|list-upper-roman">…</ol>'],
  params: []
};
