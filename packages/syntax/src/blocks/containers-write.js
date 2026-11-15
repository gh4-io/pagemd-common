/**
 * Named container write rule (phase C3): :::name [Title] … :::
 *
 * The opening line keeps the author's text (marker length, spacing) when the
 * name and title did not change. A container nested in another container needs
 * a longer marker (`::::`); `data.markup` carries it.
 *
 * Canonical example:
 *   writeContainer({ name: 'tip', title: 'Shortcut' }, 'Press **F5**.')
 *   → '::: tip Shortcut\nPress **F5**.\n:::'
 */

import { oneLine } from '../shared/write.js';

/**
 * Name and title from a container token's `info`
 * @param {string} info - Text after the marker, as written
 * @returns {{name: string, title: string}}
 */
export function readContainerInfo(info) {
  const text = String(info || '').trim();
  const name = text.split(/\s+/)[0] || '';
  return { name, title: text.slice(name.length).trim() };
}

/**
 * Write a named container back to markdown
 * @param {object} data - The container_<name>_open token's data
 * @param {string} data.name - One of CONTAINER_TYPES
 * @param {string} [data.title] - Optional title after the name
 * @param {string} [data.markup] - The marker as written (default ':::')
 * @param {string} [data.info] - The text after the marker, as written
 * @param {string} [content] - The already-written inner markdown
 * @returns {string}
 */
export function writeContainer(data, content = '') {
  const markup = /^:{3,}$/.test(data.markup || '') ? data.markup : ':::';
  const title = oneLine(data.title || '');
  const before = data.info === undefined ? null : readContainerInfo(data.info);
  const head = before && before.name === data.name && before.title === title
    ? `${markup}${data.info}`
    : `${markup} ${data.name}${title ? ` ${title}` : ''}`;
  const body = String(content).replace(/\n+$/, '');
  return `${head}\n${body ? `${body}\n` : ''}${markup}`;
}
