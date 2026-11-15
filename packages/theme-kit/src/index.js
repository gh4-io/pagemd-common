/**
 * @pagemd/theme-kit: from a document's stylesheets to its final CSS and page (phase C5; moved here
 * from pagemd, where the package started).
 *
 * - CSS_LAYER_ORDER: base → primary → layout → syntax → profile → frontmatter
 * - formatStyleBlock(): the style block pagemd puts in its HTML (inline, extract or split)
 * - generatePageLayoutCSS() / runningContent(): running headers, footers, page numbers
 * - pageGeometry(): @page size and margins as millimetres
 * - layoutRunningContent() / marginBoxes() / stringSets(): headers and footers written in a layout's CSS
 * - buildStyles(): all of the above for one document
 * - DEFAULTS: pagemd's default CSS and page layout, in `defaults/`
 * - fillTemplate() / templateData() / withColorScheme(): a profile's HTML template with its {{tokens}} filled
 *
 * Finding the files is @pagemd/resolver's job; reading them is the caller's. Runs anywhere.
 */

export { CSS_LAYER_ORDER, SHARED_LAYERS, PROFILE_LAYERS, LATE_LAYER } from './layers.js';
export { formatStyleBlock, formatStyleTag, minifyCSS, inlineStyles, layerOrderStatement } from './style-block.js';
export {
  generatePageLayoutCSS,
  runningContent,
  tokensToCSSContent,
  mergeFooterConfig,
  parseFirstPage
} from './page-layout.js';
export { pageGeometry, namedPages, hasPageRule, lengthToMm, PAGE_SIZES, FALLBACK_PAGE } from './geometry.js';
export { marginBoxes, stringSets, layoutRunningContent, contentToTokens, FROM_PROPERTIES, isFromProperties } from './margin-boxes.js';
export { buildStyles, DEFAULTS } from './build.js';
export { fillTemplate, templateData, withColorScheme, PATH_TOKENS } from './template.js';
