/**
 * Obsidian-style embedded images: ![[image.png]] and ![[image.png|alt text]]
 *
 * The alt text is the part after `|`, else the path (PD18). `imageBaseUrl`
 * is put in front of relative paths only, never web links or data: URIs.
 * The token keeps the path as written in `meta.path` (for listImageRefs).
 */

import { wikilinkOptions } from '../text/wikilinks.js';
import { oneLine } from '../shared/write.js';

const EMBED_PATTERN = /!\[\[([^\]]+)\]\]/;

/**
 * Register the ![[...]] inline rule
 * @param {MarkdownIt} md - markdown-it instance
 * @param {object} options - Wikilink options (imageBaseUrl, imageClass)
 */
export function wikilinkEmbedPlugin(md, options = {}) {
  const opts = wikilinkOptions(options);

  /**
   * Parse embed (![[...)
   */
  function parseEmbed(state, silent) {
    const start = state.pos;

    // Must start with ![[
    if (state.src.charCodeAt(start) !== 0x21 /* ! */ ||
        state.src.charCodeAt(start + 1) !== 0x5B /* [ */ ||
        state.src.charCodeAt(start + 2) !== 0x5B /* [ */) {
      return false;
    }

    const match = state.src.slice(start).match(EMBED_PATTERN);
    if (!match) return false;

    if (!silent) {
      const inner = match[1];
      const bar = inner.indexOf('|');
      const content = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
      const alt = bar >= 0 ? inner.slice(bar + 1).trim() : content;
      const isAbsolute = /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(content);
      const url = opts.imageBaseUrl && !isAbsolute ? `${opts.imageBaseUrl}/${content}` : content;

      const token = state.push('image', 'img', 0);
      token.attrs = [
        ['src', url],
        ['alt', ''],  // Will be filled by renderer from children
        ['class', opts.imageClass]
      ];
      token.content = alt;
      // alt: the text after | as written, or null when none was written (C2)
      token.meta = { embed: true, path: content, alt: bar >= 0 ? alt : null };

      // Create child token for alt text (markdown-it renders this as alt attribute value)
      const textToken = new state.Token('text', '', 0);
      textToken.content = alt;
      token.children = [textToken];
    }

    state.pos = start + match[0].length;
    return true;
  }

  md.inline.ruler.before('link', 'wikilink_embed', parseEmbed);
}

/**
 * Write an embed back to markdown (phase C3, A11). `|alt` is written only when
 * an alt text is given. A path cannot hold "|" or "]" (the reader stops there),
 * nor alt text "]": those characters are dropped.
 *
 * Canonical example: writeEmbed({ path: 'img/a.png', alt: 'Chart' }) → '![[img/a.png|Chart]]'
 * @param {{path: string, alt?: string|null}} data - What the image token carries in `meta`
 * @returns {string}
 */
export function writeEmbed(data) {
  const path = oneLine(data.path).replace(/[|\]]/g, '');
  const alt = data.alt === null || data.alt === undefined ? '' : oneLine(data.alt).replace(/\]/g, '');
  return alt ? `![[${path}|${alt}]]` : `![[${path}]]`;
}

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'embeds',
  group: 'media',
  read(md, mode, options = {}) {
    wikilinkEmbedPlugin(md, options.wikilinks);
  },
  write: writeEmbed,
  htmlContract: ['<img src="{path}" alt="{alt or path}" class="embedded-image">'],
  params: [
    { key: 'path', type: 'path', label: 'Image', help: 'Image path inside ![[…]]' },
    { key: 'alt', type: 'string', label: 'Alt text', help: 'After "|": ![[path|alt]]; defaults to the path' }
  ]
};
