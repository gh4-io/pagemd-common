/**
 * `template-asset-missing` (pagemd-editor FIX-template-asset-paths, R-259, OQ-80): a picture, font or other file named with a
 * relative path inside the profile's template, layout or CSS that is in neither place pagemd looks: next to that file (the
 * new rule), nor in the document's folder (the old one, still read). A warning: the page shows a blank picture, nothing
 * stops. The places come from @pagemd/resolver's `rebaseAssetPathsGen`, the same function rendering uses.
 */

import { rebaseAssetPathsGen } from '@pagemd/resolver';
import { diagnostic } from '../diagnostic.js';

/**
 * @param {object} ctx - the run's context (run.js)
 * @param {string} file - the template or stylesheet
 * @param {string} text - its text
 * @param {'html'|'css'} kind
 * @param {string} level - the level the warning is listed under
 * @param {string} what - "the template", "the layout", "the stylesheet"
 * @returns {Generator<object, import('../diagnostic.js').Diagnostic[]>}
 */
export function* templateAssetWarnings(ctx, file, text, kind, level, what) {
  const { P } = ctx;
  const documentDir = ctx.input.path ? P.dirname(ctx.input.path) : null;
  if (!documentDir) return [];
  const { assets } = yield* rebaseAssetPathsGen(text, { kind, fileDir: P.dirname(file), documentDir, rewrite: false }, ctx.ports);
  const out = [];
  const seen = new Set();
  for (const asset of assets) {
    if (asset.outcome !== 'missing' || seen.has(asset.written)) continue;
    seen.add(asset.written);
    const places = asset.tried.join(' and ');
    out.push(diagnostic('warning', level, 'template-asset-missing', `File not found: ${asset.written}, named in ${what} ${P.basename(file)} (looked in ${places})`, { file, searched: asset.tried }));
  }
  return out;
}
