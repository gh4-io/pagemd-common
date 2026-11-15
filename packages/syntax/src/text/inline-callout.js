/**
 * Inline badge callouts: [!WARNING] and [!DANGER] inside a line of text.
 * (The block form [[WARNING]]…[[/WARNING]] is the blocks/callouts item.)
 */

/**
 * Register the inline [!WARNING] / [!DANGER] rule and its renderer
 * @param {MarkdownIt} md - markdown-it instance
 */
export function inlineCalloutPlugin(md) {
  md.inline.ruler.before('emphasis', 'inline_callout', (state, silent) => {
    const max = state.posMax;
    const start = state.pos;

    if (state.src.charCodeAt(start) !== 0x5B /* [ */) return false;
    if (state.src.charCodeAt(start + 1) !== 0x21 /* ! */) return false;

    const match = state.src.slice(start).match(/^\[!(\w+)\]/);
    if (!match) return false;

    const type = match[1].toUpperCase();
    if (type !== 'WARNING' && type !== 'DANGER') return false;

    if (!silent) {
      const token = state.push('inline_callout', '', 0);
      token.content = type;
      token.markup = `[!${type}]`;
    }

    state.pos += match[0].length;
    return true;
  });
}

/**
 * Register the inline callout renderer
 * @param {MarkdownIt} md - markdown-it instance
 */
export function inlineCalloutRenderer(md) {
  md.renderer.rules.inline_callout = (tokens, idx) => {
    const type = tokens[idx].content.toLowerCase();
    return `<span class="callout callout-${type} callout-inline"><span class="callout-label">${md.utils.escapeHtml(tokens[idx].content)}</span></span>`;
  };
}

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'inline-callout',
  group: 'text',
  read(md) {
    inlineCalloutPlugin(md);
    inlineCalloutRenderer(md);
  },
  // Phase C3: '[!WARNING]' / '[!DANGER]'; the author's letter case is kept (data.markup)
  write: (data) => {
    const type = String(data.type || data.content || 'WARNING').toUpperCase() === 'DANGER' ? 'DANGER' : 'WARNING';
    return data.markup && data.markup.toUpperCase() === `[!${type}]` ? data.markup : `[!${type}]`;
  },
  htmlContract: ['<span class="callout callout-{type} callout-inline"><span class="callout-label">{TYPE}</span></span>'],
  params: [
    { key: 'type', type: 'enum', values: ['WARNING', 'DANGER'] }
  ]
};
