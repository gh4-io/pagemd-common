/**
 * Which mode a markdown-it instance was set up in (phase C2).
 *
 * - 'render': the CLI's behaviour: directives become HTML, output byte-identical to pagemd.
 * - 'editor': tokens an editor can turn back into the same markdown: every block
 *   token has a line range, directives keep what the author wrote (as their own
 *   token types), `!!!include(…)!!!` is an atom, and render-only rewriting is off.
 *
 * Rules look the mode up when they run, so an item's rules behave the same
 * whether the dialect was created by createDialect() or added to the
 * caller's own instance by applyDialect().
 */

/** The modes createDialect() and applyDialect() accept */
export const MODES = Object.freeze(['render', 'editor']);

/** @type {WeakMap<object, string>} */
const modes = new WeakMap();

/**
 * Remember the mode of a markdown-it instance
 * @param {object} md - markdown-it instance
 * @param {string} mode - One of MODES
 */
export function setMode(md, mode) {
  modes.set(md, mode);
}

/**
 * The mode a markdown-it instance was set up in ('render' when unknown)
 * @param {object} md - markdown-it instance
 * @returns {string}
 */
export function modeOf(md) {
  return modes.get(md) || 'render';
}

/**
 * Is this instance in editor mode?
 * @param {object} md - markdown-it instance
 * @returns {boolean}
 */
export function isEditor(md) {
  return modeOf(md) === 'editor';
}
