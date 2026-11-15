/**
 * Block callout write rule (phase C3): [[WARNING]]…[[/WARNING]], [[DANGER]]…[[/DANGER]].
 *
 * The author's form is kept: a one-line callout stays on one line while its
 * text has no line break; otherwise the multi-line form, always with its
 * closing tag (an unclosed callout ends at a heading or blank lines, which is
 * easy to break by editing). The keyword keeps the author's letter case.
 *
 * Callout text is read as inline text: a line starting with "# ", "[[WARNING]]",
 * "[[DANGER]]" or "<!-- ::" ends a multi-line callout early, so such text
 * cannot be written inside one.
 *
 * Canonical examples:
 *   writeCallout({ type: 'WARNING', form: 'single' }, 'Hot surface')
 *   → '[[WARNING]] Hot surface [[/WARNING]]'
 *   writeCallout({ type: 'DANGER' }, 'Line one\nLine two')
 *   → '[[DANGER]]\nLine one\nLine two\n[[/DANGER]]'
 */

/**
 * Write a block callout back to markdown
 * @param {object} data - What the callout_open token carries in `meta`
 * @param {string} data.type - WARNING | DANGER
 * @param {string} [data.typeText] - The keyword as written (letter case)
 * @param {'single'|'multi'} [data.form] - How it was written
 * @param {string} [content] - The callout's text (inline markdown)
 * @returns {string}
 */
export function writeCallout(data, content = '') {
  const type = String(data.type || 'WARNING').toUpperCase() === 'DANGER' ? 'DANGER' : 'WARNING';
  const word = data.typeText && data.typeText.toUpperCase() === type ? data.typeText : type;
  const text = String(content).trim();
  if (data.form === 'single' && !text.includes('\n')) {
    return `[[${word}]]${text ? ` ${text}` : ''} [[/${word}]]`;
  }
  return text ? `[[${word}]]\n${text}\n[[/${word}]]` : `[[${word}]]\n[[/${word}]]`;
}
