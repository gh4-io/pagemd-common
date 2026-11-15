/**
 * Wikilink write rule (phase C3): [[Page]] and [[Page|Display]].
 *
 * `|Display` is written only when a display text is given (null means none
 * was written). The reader stops a target at "|" or "]" and a display at "]",
 * so those characters are dropped.
 *
 * Canonical example: writeWikilink({ target: 'Setup#Install', display: 'installing' })
 *   → '[[Setup#Install|installing]]'
 */

import { oneLine } from '../shared/write.js';

/**
 * Write a wikilink back to markdown
 * @param {{target: string, display?: string|null}} data - What the link_open token carries in `meta`
 * @returns {string}
 */
export function writeWikilink(data) {
  const target = oneLine(data.target).replace(/[|\]]/g, '');
  const display = data.display === null || data.display === undefined ? '' : oneLine(data.display).replace(/\]/g, '');
  return display ? `[[${target}|${display}]]` : `[[${target}]]`;
}
