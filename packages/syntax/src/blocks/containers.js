/**
 * Named containers: :::name [Title] … ::: for the 15 pagemd container types.
 * These complement GFM alerts with additional container types.
 */

import markdownItContainer from 'markdown-it-container';
import { writeContainer } from './containers-write.js';

// Container types for markdown-it-container (:::name blocks)
// These complement GFM alerts with additional container types
export const CONTAINER_TYPES = [
  'details', 'summary', 'aside', 'columns', 'spoiler',
  'warning', 'caution', 'note', 'important', 'tip',
  'document-header', 'title-block', 'applicability-box',
  'approval-block', 'footer-notice'
];

/**
 * Create a container renderer for markdown-it-container
 * @param {string} name - Container type name
 * @returns {object} Container configuration
 */
function createContainerConfig(name) {
  return {
    validate: (params) => params.trim().split(/\s+/)[0] === name,
    render: (tokens, idx) => {
      const token = tokens[idx];
      if (token.nesting === 1) {
        // Extract title if provided (:::name Title here)
        const params = token.info.trim().slice(name.length).trim();
        const title = params ? ` data-title="${params.replace(/"/g, '&quot;')}"` : '';
        return `<div class="container container-${name}"${title}>\n`;
      }
      return '</div>\n';
    }
  };
}

/**
 * A container's line range includes its closing ::: line, and its opening
 * token says whether it had one (`meta.closed`, like `::: {…}` and callouts
 * since C2) (phase P4, both modes; neither changes HTML). markdown-it-container
 * ends the opening token's range before the closing marker, so an editor that
 * re-uses a block's lines would see the marker as text outside every block; and
 * a container closed by its parent's end (`:::aside` inside `:::details`, both
 * with `:::`) has no closing line of its own, which its writer must know. The
 * block rule is wrapped as markdown-it-container registers it; a closed
 * container is one whose rule moved `state.line` past the range.
 * @param {Function} rule - markdown-it-container's block rule
 * @returns {Function}
 */
function withClosingLine(rule) {
  return (state, startLine, endLine, silent) => {
    const first = state.tokens.length;
    const found = rule(state, startLine, endLine, silent);
    const open = state.tokens[first];
    if (found && !silent && open && open.map) {
      const closed = state.line > open.map[1];
      if (closed) open.map = [open.map[0], state.line];
      open.meta = { ...open.meta, closed };
    }
    return found;
  };
}

/**
 * The markdown-it instance as markdown-it-container sees it: the same object,
 * except that the block rule it registers is wrapped by withClosingLine().
 * @param {MarkdownIt} md
 * @returns {object}
 */
function containerView(md) {
  const ruler = {
    before: (beforeName, ruleName, rule, options) => md.block.ruler.before(beforeName, ruleName, withClosingLine(rule), options)
  };
  const view = Object.create(md);
  view.block = Object.create(md.block, { ruler: { value: ruler } });
  return view;
}

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'containers',
  group: 'blocks',
  read(md) {
    for (const type of CONTAINER_TYPES) {
      md.use.call(containerView(md), markdownItContainer, type, createContainerConfig(type));
    }
  },
  write: writeContainer,
  htmlContract: ['<div class="container container-{name}" data-title="{title}">…</div>'],
  params: [
    { key: 'name', type: 'enum', values: CONTAINER_TYPES },
    { key: 'title', type: 'string', help: 'Optional text after the name' }
  ]
};
