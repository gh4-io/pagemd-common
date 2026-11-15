/**
 * Hide the first heading (pagemd-editor FIX-S50, OQ-68): when the title is already shown (the template's title page, the properties), the
 * document's first `# Heading` repeats it. With `hide_first_h1: true` (the frontmatter, or a profile's `metadata.defaults`) the first level-1
 * heading gets the class `hide-first-h1` and is not drawn; it stays in the markdown, and the document's other headings are unchanged.
 * Opt-in: pagemd's parser uses `hideFirstH1Plugin` only when the property is on.
 *
 * Render only. The editor never gets the class (it would read back as a `{.hide-first-h1}` the author never wrote, and a save would
 * write it): the editor's canvas marks the same heading itself.
 */

/** The class the first heading carries */
export const HIDE_FIRST_H1_CLASS = 'hide-first-h1';

/** The CSS that does the hiding (in the late layer: after the profile's, which may state `h1 { display }`) */
export const HIDE_FIRST_H1_CSS = `h1.hide-first-h1 {
  display: none;
}
`;

/** Core rule: the first level-1 heading gets the class (an existing class list keeps what it has) */
function hideFirstH1(state) {
  const first = state.tokens.find((token) => token.type === 'heading_open' && token.tag === 'h1');
  if (first) first.attrJoin('class', HIDE_FIRST_H1_CLASS);
}

/**
 * markdown-it plugin: the first level-1 heading gets the class. Not a dialect item (it adds no syntax and nothing is written back): the
 * caller that renders (pagemd's parser) uses it when `hide_first_h1` is on.
 * @param {object} md - markdown-it instance
 */
export function hideFirstH1Plugin(md) {
  md.core.ruler.push('pagemd_hide_first_h1', hideFirstH1);
}
