/**
 * GitHub alert write rule (phase C3): > [!NOTE] … (NOTE, TIP, IMPORTANT, WARNING, CAUTION).
 *
 * A title is written only when it differs from the alert's default title
 * (markdown-it-github-alerts gives "Note", "Tip", … when none is written).
 * Every line of the content is quoted with "> "; blank lines get ">".
 *
 * Canonical example:
 *   writeAlert({ type: 'tip' }, 'Save often.')
 *   → '> [!TIP]\n> Save often.'
 */

import { oneLine } from '../shared/write.js';

/**
 * The title markdown-it-github-alerts shows when none is written
 * @param {string} type - Alert type
 * @returns {string} e.g. 'Note'
 */
function defaultTitle(type) {
  const t = String(type).toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Write a GitHub alert back to markdown
 * @param {object} data - What the alert_open token carries in `meta` (type, title)
 * @param {string} [content] - The already-written inner markdown
 * @returns {string}
 */
export function writeAlert(data, content = '') {
  const type = String(data.type || 'note').toUpperCase();
  const title = oneLine(data.title || '');
  const head = `> [!${type}]${title && title !== defaultTitle(type) ? ` ${title}` : ''}`;
  const body = String(content).replace(/\n+$/, '');
  if (!body) return head;
  return `${head}\n${body.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')}`;
}
