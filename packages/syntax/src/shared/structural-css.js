/**
 * The structural CSS of the items a rendered document uses (pagemd-editor P26; picture markers, C13).
 *
 * Footnotes and task lists need a little CSS whatever the theme (a checkbox without a bullet, the small raised
 * reference). pagemd adds it only to documents whose HTML has them, so the output of every other document stays
 * exactly as it was (base.css, which every document carries, is not changed). The editor's canvas uses the same text.
 *
 * Two places in the cascade: footnotes in the `base` layer (a profile can restyle them), task lists in the `structural` layer,
 * after the profile's (every profile gets the same GitHub look; a profile or a document's own `styles:` file can still set another
 * indent, since nothing here is `!important`; the bundled profiles state GitHub's 2em themselves, AD-FIX-ADT-09). `structuralCssFor`
 * gives the first, `lateStructuralCssFor` the second.
 */

import { FOOTNOTES_STRUCTURAL_CSS } from '../text/footnotes.js';
import { TASK_LISTS_STRUCTURAL_CSS } from '../lists/task-lists.js';
import { HIDE_FIRST_H1_CSS } from '../document/hide-first-h1.js';
import { MARKER_SCALE_STRUCTURAL_CSS, MARKER_LABEL_STRUCTURAL_CSS } from '../media/picture.js';

/** Each item's CSS, with the HTML that shows the item is used */
const BY_ITEM = Object.freeze([
  { item: 'footnotes', layer: 'base', css: FOOTNOTES_STRUCTURAL_CSS, used: /class="footnote-ref"|class="footnotes"/ },
  { item: 'hide-first-h1', layer: 'structural', css: HIDE_FIRST_H1_CSS, used: /<h1 [^>]*class="[^"]*\bhide-first-h1\b/ },
  { item: 'task-lists', layer: 'structural', css: TASK_LISTS_STRUCTURAL_CSS, used: /class="task-list-item[" ]/ },
  // pagemd-editor C13 (R-250): a marker's size and its label on the picture (the crop, turn and flip need none: inline)
  { item: 'marker-size', layer: 'base', css: MARKER_SCALE_STRUCTURAL_CSS, used: /class="marker" style="[^"]*--marker-scale:/ },
  { item: 'marker-label', layer: 'base', css: MARKER_LABEL_STRUCTURAL_CSS, used: /class="marker-label"/ }
]);

/** The CSS of the items of `layer` that `html` uses */
function cssOf(html, layer) {
  const text = String(html ?? '');
  return BY_ITEM.filter((entry) => entry.layer === layer && entry.used.test(text))
    .map((entry) => `/* pagemd: ${entry.item} */\n${entry.css}\n`)
    .join('');
}

/**
 * The CSS the items found in `html` need in the `base` layer (footnotes), one block per item, or '' when none is used
 * @param {string} html - A rendered document (or its body)
 * @returns {string}
 */
export function structuralCssFor(html) {
  return cssOf(html, 'base');
}

/**
 * The CSS the items found in `html` need in the `structural` layer, after the profile's (task lists), or '' when none is used
 * @param {string} html - A rendered document (or its body)
 * @returns {string}
 */
export function lateStructuralCssFor(html) {
  return cssOf(html, 'structural');
}
