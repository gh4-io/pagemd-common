/**
 * One figure numbering for the whole document (phase C9, PD1-PD3).
 *
 * FIGUREs and annotated images share one counter. Only figures with a
 * caption get a number. Numbers are given in document order by a core rule
 * that runs once per parse, after the block rules have produced every figure
 * token, and are written onto the tokens themselves (`meta.figureNumber`).
 * So a number never depends on how many times parse or render ran, and a
 * caller that parses and renders separately (the editor) gets the same
 * numbers as `md.render()`.
 *
 * The item that registers first adds the rule; the second finds it and
 * skips, so either item works alone and both together share one counter.
 */

export const FIGURE_NUMBER_RULE = 'pagemd_figure_numbers';

/**
 * Does this token open a captioned, numbered figure?
 * @param {object} token - Block token
 * @returns {boolean}
 */
function isCaptionedFigure(token) {
  if (token.type === 'figure_open') return !!(token.meta && token.meta.caption);
  if (token.type === 'annotated_image') {
    const data = token.meta && token.meta.data;
    return !!(data && data.options && data.options.caption);
  }
  return false;
}

/**
 * Number every captioned figure in document order.
 * @param {object} state - markdown-it core state
 */
function numberFigures(state) {
  let count = 0;
  let open = null;
  for (const token of state.tokens) {
    if (token.type === 'figure_open') open = token;
    if (token.type === 'figcaption' && open) {
      token.meta = { ...token.meta, figureNumber: open.meta.figureNumber };
      continue;
    }
    if (!isCaptionedFigure(token)) continue;
    count += 1;
    token.meta = { ...token.meta, figureNumber: count };
  }
  state.env.figureCount = count;
}

/**
 * Register the numbering rule once per markdown-it instance.
 * @param {object} md - markdown-it instance
 */
export function useFigureNumbering(md) {
  const exists = md.core.ruler.__rules__.some((rule) => rule.name === FIGURE_NUMBER_RULE);
  if (!exists) md.core.ruler.push(FIGURE_NUMBER_RULE, numberFigures);
}
