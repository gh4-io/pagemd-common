/**
 * Attribute container: ::: {.class #id key="value"} … :::
 * Registered BEFORE markdown-it-container so it catches attribute syntax first.
 */

import { writeAttributeContainer } from './attribute-container-write.js';

/**
 * Parse attribute syntax {.class #id key="value"} into HTML attributes
 * @param {string} attrs - Attribute string like '.warning #id style="color: red"' (without braces)
 * @returns {string} HTML attribute string like ' class="warning" id="id" style="color: red"'
 */
export function parseAttributes(attrs) {
  const parts = [];
  const classes = [];
  let id = null;
  const kvPairs = {};

  // Match .class and #id patterns
  const classMatches = attrs.match(/\.([a-zA-Z0-9_-]+)/g);
  const idMatch = attrs.match(/#([a-zA-Z0-9_-]+)/);

  if (classMatches) {
    classes.push(...classMatches.map(m => m.slice(1)));
  }
  if (idMatch) {
    id = idMatch[1];
  }

  // Match key="value" and key='value' patterns
  const kvRegex = /([a-zA-Z][a-zA-Z0-9_-]*)=(?:"([^"]*)"|'([^']*)')/g;
  let kvMatch;
  while ((kvMatch = kvRegex.exec(attrs)) !== null) {
    const key = kvMatch[1];
    const value = kvMatch[2] ?? kvMatch[3];
    if (!(key in kvPairs)) kvPairs[key] = value;
  }

  if (classes.length > 0) {
    parts.push(`class="${classes.join(' ')}"`);
  }
  if (id) {
    parts.push(`id="${id}"`);
  }
  for (const [key, value] of Object.entries(kvPairs)) {
    parts.push(`${key}="${value}"`);
  }

  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

/**
 * Custom block rule for attribute-based containers `::: {.class}`
 * Runs before markdown-it-container to catch attribute syntax
 * @param {object} state - Markdown-it state
 * @param {number} startLine - Starting line number
 * @param {number} endLine - Ending line number
 * @param {boolean} silent - Silent mode (don't generate tokens)
 * @returns {boolean} True if rule matched and processed
 */
function attributeContainerRule(state, startLine, endLine, silent) {
  const marker = ':';
  const markerCount = 3;
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];

  // Check for ::: marker
  if (pos + markerCount > max) return false;

  const markerStr = state.src.slice(pos, pos + markerCount);
  if (markerStr !== marker.repeat(markerCount)) return false;

  pos += markerCount;

  // Get the content after :::
  const firstLine = state.src.slice(pos, max).trim();

  // Only match if it starts with { (attribute syntax)
  if (!firstLine.startsWith('{')) return false;

  // If we're in silent mode (checking if rule matches), return true
  if (silent) return true;

  // Find the closing :::
  let nextLine = startLine;
  let autoClosed = false;

  while (nextLine < endLine) {
    nextLine++;
    if (nextLine >= endLine) break;

    pos = state.bMarks[nextLine] + state.tShift[nextLine];
    max = state.eMarks[nextLine];

    if (pos < max && state.sCount[nextLine] < state.blkIndent) {
      // Non-empty line with negative indent should stop the container
      break;
    }

    // Check for closing :::
    const line = state.src.slice(pos, max).trim();
    if (line === marker.repeat(markerCount)) {
      autoClosed = true;
      break;
    }
  }

  const oldParent = state.parentType;
  const oldLineMax = state.lineMax;
  state.parentType = 'container';

  // Create opening token
  const tokenOpen = state.push('div_open', 'div', 1);
  tokenOpen.markup = marker.repeat(markerCount);
  tokenOpen.block = true;
  tokenOpen.map = [startLine, nextLine + (autoClosed ? 1 : 0)];
  tokenOpen.meta = { attributes: firstLine, closed: autoClosed }; // as written (C2)

  // Parse attributes and add to token
  const attrMatch = firstLine.match(/^\{(.+)\}$/);
  if (attrMatch) {
    const attrStr = parseAttributes(attrMatch[1]);
    // Extract all key="value" pairs from the attribute string
    const pairRegex = /([a-zA-Z][a-zA-Z0-9_-]*)="([^"]*)"/g;
    let pair;
    while ((pair = pairRegex.exec(attrStr)) !== null) {
      if (!tokenOpen.attrs) tokenOpen.attrs = [];
      tokenOpen.attrs.push([pair[1], pair[2]]);
    }
  }

  // Parse block content
  state.lineMax = nextLine;
  state.md.block.tokenize(state, startLine + 1, nextLine);
  state.lineMax = oldLineMax;
  state.parentType = oldParent;

  // Create closing token
  const tokenClose = state.push('div_close', 'div', -1);
  tokenClose.markup = marker.repeat(markerCount);
  tokenClose.block = true;

  state.line = nextLine + (autoClosed ? 1 : 0);
  return true;
}

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'attribute-container',
  group: 'blocks',
  read(md) {
    md.block.ruler.before('fence', 'attribute_container', attributeContainerRule);
  },
  write: writeAttributeContainer,
  htmlContract: ['<div class="…" id="…" key="value">…</div>'],
  params: [
    { key: 'attributes', type: 'string', help: '{.class #id key="value"} after :::' }
  ]
};
