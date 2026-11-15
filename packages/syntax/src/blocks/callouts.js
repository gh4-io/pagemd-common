/**
 * Block callouts: [[WARNING]]…[[/WARNING]] and [[DANGER]]…[[/DANGER]]
 * (single-line or multi-line). The inline badge form [!WARNING] is the
 * text/inline-callout item.
 */

import { writeCallout } from './callouts-write.js';

/**
 * Give the tokens a callout pushed its line range, and record how it was written (C2)
 * @param {object} state - markdown-it block state
 * @param {number} first - Index of the callout's first token
 * @param {number[]} lines - [first line, line after the callout]
 * @param {object} meta - type as written, form, closed
 */
function finishCallout(state, first, lines, meta) {
  for (let i = first; i < state.tokens.length; i++) {
    if (state.tokens[i].nesting !== -1) state.tokens[i].map = lines;
  }
  state.tokens[first].meta = meta;
}

/**
 * Block callout rule and renderers
 * @param {MarkdownIt} md - Markdown-it instance
 */
export function blockCalloutPlugin(md) {
  md.block.ruler.before('fence', 'block_callout', (state, startLine, endLine, silent) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const lineText = state.src.slice(pos, max);

    // Check for opening tag - must be at start of line
    const openMatch = lineText.match(/^\[\[(WARNING|DANGER)\]\](.*)$/i);
    if (!openMatch) return false;

    const type = openMatch[1].toUpperCase();
    const firstLineContent = openMatch[2].trim();

    if (silent) return true;
    const first = state.tokens.length;

    // Look for closing tag on same line first (single-line format)
    const singleLineMatch = lineText.match(/^\[\[(WARNING|DANGER)\]\](.*?)(\[\[\/\1\]\])?$/i);
    if (singleLineMatch && singleLineMatch[3]) {
      // Single-line format: [[WARNING]] content
      const content = singleLineMatch[2].trim();

      const token_open = state.push('callout_open', 'div', 1);
      token_open.attrSet('class', `callout callout-${type.toLowerCase()}`);

      const label_token = state.push('callout_label', 'span', 0);
      label_token.attrSet('class', 'callout-label');
      label_token.content = type;

      const content_open = state.push('callout_content_open', 'div', 1);
      content_open.attrSet('class', 'callout-content');

      if (content) {
        const inline_token = state.push('inline', '', 0);
        inline_token.content = content;
        inline_token.children = [];
      }

      state.push('callout_content_close', 'div', -1);
      state.push('callout_close', 'div', -1);

      state.line = startLine + 1;
      finishCallout(state, first, [startLine, state.line], { type, typeText: openMatch[1], form: 'single', closed: true });
      return true;
    }

    // Multi-line format - look for closing tag
    let nextLine = startLine + 1;
    let content = firstLineContent;
    let foundClose = false;
    let blankLineCount = 0;
    const MAX_BLANK_LINES = 2; // Stop after 2 consecutive blank lines without closing tag

    // Search for closing tag
    while (nextLine < endLine) {
      const linePos = state.bMarks[nextLine] + state.tShift[nextLine];
      const lineMax = state.eMarks[nextLine];
      const line = state.src.slice(linePos, lineMax);

      // Found closing tag
      const closeMatch = line.match(new RegExp(`^\\[\\[\\/${type}\\]\\]`, 'i'));
      if (closeMatch) {
        foundClose = true;
        break;
      }

      // Stop if we hit another block-level element (another callout, heading, directive, etc.)
      if (line.match(/^#+\s/) ||                          // Heading
          line.match(/^\[\[(WARNING|DANGER)\]\]/i) ||     // Another callout
          line.match(/^<!--\s*::/)) {                     // Directive comment
        break;
      }

      // Track consecutive blank lines - stop after too many without finding closing tag
      if (line.trim() === '') {
        blankLineCount++;
        if (blankLineCount > MAX_BLANK_LINES) {
          break;
        }
        // Include blank line in content
        if (content) content += '\n';
        content += line;
        nextLine++;
        continue;
      }

      // Reset blank line counter when we see content
      blankLineCount = 0;

      if (content) content += '\n';
      content += line;
      nextLine++;
    }

    // Create tokens
    const token_open = state.push('callout_open', 'div', 1);
    token_open.attrSet('class', `callout callout-${type.toLowerCase()}`);

    const label_token = state.push('callout_label', 'span', 0);
    label_token.attrSet('class', 'callout-label');
    label_token.content = type;

    const content_open = state.push('callout_content_open', 'div', 1);
    content_open.attrSet('class', 'callout-content');

    if (content.trim()) {
      const inline_token = state.push('inline', '', 0);
      inline_token.content = content.trim();
      inline_token.children = [];
    }

    state.push('callout_content_close', 'div', -1);
    state.push('callout_close', 'div', -1);

    state.line = foundClose ? nextLine + 1 : nextLine;
    finishCallout(state, first, [startLine, state.line], { type, typeText: openMatch[1], form: 'multi', closed: foundClose });
    return true;
  });

  // Renderers
  md.renderer.rules.callout_open = (tokens, idx) => {
    const className = tokens[idx].attrGet('class');
    return `<div class="${className}">`;
  };

  md.renderer.rules.callout_close = () => '</div>';

  md.renderer.rules.callout_label = (tokens, idx) => {
    return `<span class="callout-label">${md.utils.escapeHtml(tokens[idx].content)}</span>`;
  };

  md.renderer.rules.callout_content_open = () => '<div class="callout-content">';
  md.renderer.rules.callout_content_close = () => '</div>';
}

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'callouts',
  group: 'blocks',
  read(md) {
    blockCalloutPlugin(md);
  },
  write: writeCallout,
  htmlContract: [
    '<div class="callout callout-{type}"><span class="callout-label">{TYPE}</span><div class="callout-content">…</div></div>'
  ],
  params: [
    { key: 'type', type: 'enum', values: ['WARNING', 'DANGER'] }
  ]
};
