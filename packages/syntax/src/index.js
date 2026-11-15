/**
 * @pagemd/syntax - the pagemd markdown dialect.
 *
 * Every syntax item lives in src/<group>/<item>.js and exports a
 * SyntaxItemDef. createDialect() registers them on a markdown-it instance in
 * one fixed order. Callers that add their own render-only steps (heading ids,
 * zebra rows, file includes, ...) insert them through named slots, so the
 * overall rule order stays exactly as pagemd's parser had it.
 *
 * Two modes (phase C2): 'render' is the CLI's behaviour; 'editor' gives tokens
 * an editor can turn back into the same markdown (see ./shared/mode.js).
 * applyDialect() adds the dialect to a markdown-it instance the caller built
 * (the editor builds its own). Each item's write() (phase C3) turns the data an
 * editor-mode token carries back into markdown; it is used only for blocks
 * the author changed.
 *
 * Browser-safe: no Node built-ins, no process.* (see test/browser-safe.test.js).
 */

import MarkdownIt from 'markdown-it';
import { MODES, setMode } from './shared/mode.js';

import multimdTable from './tables/multimd-table.js';
import tableCaptions from './tables/table-captions.js';
import attrsFix from './tables/attrs-fix.js';
import tableDirective from './tables/table-directive.js';
import attributes from './text/attributes.js';
import inlineCallout from './text/inline-callout.js';
import indexMarker from './text/index-marker.js';
import wikilinks from './text/wikilinks.js';
import fancyLists from './lists/fancy-lists.js';
import taskLists from './lists/task-lists.js';
import footnotes from './text/footnotes.js';
import githubAlerts from './blocks/github-alerts.js';
import attributeContainer from './blocks/attribute-container.js';
import containers from './blocks/containers.js';
import callouts from './blocks/callouts.js';
import figure from './media/figure.js';
import annotatedImage from './media/annotated-image.js';
import embeds from './media/embeds.js';
import pagebreak from './page/pagebreak.js';
import toc from './page/toc.js';
import section from './page/section.js';
import layout from './page/layout.js';
import cover from './page/cover.js';
import indexBlock from './page/index-block.js';
import includeDirective from './document/include-directive.js';
import include from './document/include.js';

/**
 * @typedef {object} FieldSpec
 * @property {string} key
 * @property {string} type - string | number | boolean | enum | path | color | list | object
 * @property {string} [label] - Short name for UI
 * @property {string[]} [values] - Allowed values for enum
 * @property {string} [help]
 * @property {*} [default] - The value used when the author writes none
 * @property {number} [min] - Lowest allowed number
 * @property {number} [max] - Highest allowed number
 * @property {boolean} [required] - The entry is dropped without it
 * @property {FieldSpec[]} [fields] - For 'object': its keys; for 'list': the keys of each entry
 */

/**
 * @typedef {object} SyntaxItemDef
 * @property {string} id - Stable item id
 * @property {string} group - One of GROUPS
 * @property {(md: object, mode: string, options: object) => void} read - Registers the item's rules and renderers
 * @property {{field: string, value: any}} [gate] - Only registered when options.fields[field] === value
 * @property {string[]} htmlContract - The HTML shapes (and class names) the item produces
 * @property {string} [structuralCss] - CSS the HTML needs whatever the theme (e.g. markers placed on an
 *   annotated image); pagemd's styles/base.css holds the same declarations (phase P4, D18)
 * @property {FieldSpec[]} params - The item's parameters
 * @property {(data: object, content?: string) => string} [write] - Writes the item back to markdown from the
 *   data its editor-mode token carries; `content` is the already-written inner markdown of a wrapper
 *   (container, callout, alert, table cell). Items with nothing an author writes (attrs-fix) have none.
 */

/** The 7 author-facing groups */
export const GROUPS = Object.freeze(['text', 'lists', 'tables', 'blocks', 'media', 'page', 'document']);

/** Named slots where a caller can insert its own steps */
export const SLOTS = Object.freeze(['afterTables', 'afterAttrs', 'beforeContainers']);

/** markdown-it options used when the caller passes none */
const DEFAULT_MARKDOWN_IT = Object.freeze({ html: true, linkify: true });

const slot = (name) => ({ slot: name });

/**
 * Registration order. Order matters (rules inserted "before X" land in
 * registration order); it is pagemd's historical createParser() order.
 */
const ORDER = Object.freeze([
  multimdTable,        // replaces the built-in table parser
  tableCaptions,
  slot('afterTables'), // pagemd: zebra row classes
  attributes,          // {.class #id}
  attrsFix,            // must follow attributes
  slot('afterAttrs'),  // pagemd: heading ids (markdown-it-anchor)
  footnotes,           // P26: [^label], ^[inline], [^label]: note (markdown-it-footnote + line ranges, editor mode)
  fancyLists,          // opt-in (gate)
  taskLists,           // P26: - [ ] / - [x] (our own rule, markdown-it-task-lists' HTML)
  githubAlerts,
  slot('beforeContainers'), // pagemd: !!!include(path)!!! file reads
  include,             // editor mode only: !!!include(path)!!! as an atom
  attributeContainer,  // before the named containers so it catches ::: {…} first
  containers,
  callouts,
  inlineCallout,
  figure,
  annotatedImage,
  pagebreak,           // comment directives share one core rule
  toc,
  section,
  layout,
  cover,
  includeDirective,
  indexBlock,
  tableDirective,      // P19: <!-- ::TABLE widths="…" --> (after the other directives: its editor-mode rule follows theirs)
  indexMarker,
  embeds,              // ![[…]] before [[…]]
  wikilinks            // last: [[…]] conflicts with callouts
]);

/** Every syntax item, in registration order */
export const items = Object.freeze(ORDER.filter((entry) => !entry.slot));

/**
 * Check createDialect()/applyDialect() arguments
 * @param {string} mode
 * @param {string[]} [groups]
 * @param {object} slots
 */
function checkArgs(mode, groups, slots) {
  if (!MODES.includes(mode)) {
    throw new Error(`@pagemd/syntax: unknown mode "${mode}" (use ${MODES.map((m) => `"${m}"`).join(' or ')})`);
  }
  if (groups) {
    const unknown = groups.filter((g) => !GROUPS.includes(g));
    if (unknown.length) throw new Error(`@pagemd/syntax: unknown group(s): ${unknown.join(', ')}`);
  }
  const unknownSlots = Object.keys(slots).filter((s) => !SLOTS.includes(s));
  if (unknownSlots.length) throw new Error(`@pagemd/syntax: unknown slot(s): ${unknownSlots.join(', ')}`);
}

/**
 * Add the pagemd dialect to a markdown-it instance the caller built, in the
 * dialect's fixed order.
 *
 * Editor mode also sets what the dialect needs from markdown-it itself:
 * `html` on (directives are HTML comments), `typographer` off (it would turn
 * quotes curly, and a save would write them back), and the `table` rule on
 * (markdown-it's 'commonmark' preset, which the editor starts from, has it off,
 * so pagemd tables would read as plain text).
 *
 * @param {MarkdownIt} md - markdown-it instance
 * @param {object} [opts] - As createDialect() (options.markdownIt is ignored: md already exists)
 * @returns {MarkdownIt} The same instance
 */
export function applyDialect(md, { mode = 'render', groups, slots = {}, options = {} } = {}) {
  checkArgs(mode, groups, slots);
  setMode(md, mode);
  if (mode === 'editor') md.set({ html: true, typographer: false });
  const fields = options.fields || {};

  for (const entry of ORDER) {
    if (entry.slot) {
      const steps = slots[entry.slot];
      for (const step of [].concat(steps || [])) step(md);
      continue;
    }
    if (groups && !groups.includes(entry.group)) continue;
    if (entry.gate && fields[entry.gate.field] !== entry.gate.value) continue;
    entry.read(md, mode, options);
  }

  if (mode === 'editor') md.block.ruler.enable(['table'], true);
  return md;
}

/**
 * Create a markdown-it instance configured with the pagemd dialect.
 *
 * @param {object} [opts]
 * @param {'render'|'editor'} [opts.mode='render'] - 'render' = the CLI's behaviour; 'editor' = tokens an
 *   editor can write back (line range on every block token, directives kept as written, include as an atom)
 * @param {string[]} [opts.groups] - Only register items from these groups (default: all)
 * @param {Object<string, Function|Function[]>} [opts.slots] - Steps to run at the named SLOTS; each gets (md)
 * @param {object} [opts.options]
 * @param {object} [opts.options.markdownIt] - markdown-it options (default: { html: true, linkify: true })
 * @param {object} [opts.options.fields] - Document property values that switch gated items on, e.g. { fancy_lists: true }
 * @param {object} [opts.options.wikilinks] - baseUrl, imageBaseUrl, linkClass, imageClass, generateSlugs
 * @returns {MarkdownIt} Configured markdown-it instance
 */
export function createDialect({ mode = 'render', groups, slots = {}, options = {} } = {}) {
  checkArgs(mode, groups, slots);
  const md = new MarkdownIt({ ...DEFAULT_MARKDOWN_IT, ...options.markdownIt });
  return applyDialect(md, { mode, groups, slots, options });
}

export { MODES, modeOf } from './shared/mode.js';
export { slugify } from './text/wikilinks.js';
export { CONTAINER_TYPES } from './blocks/containers.js';
export { parseDirectiveAttributes, registerDirective, registerDirectiveFallback, writeDirective } from './shared/directives.js';
export {
  oneLine, formatNumber, figureValue, directiveValue, attrValue, yamlString,
  markdownAlt, markdownDestination, markdownTitle
} from './shared/write.js';
export { markdownItFancyListPlugin } from './lists/fancy-lists.js';
export { writeTaskMarker, TASK_LISTS_STRUCTURAL_CSS } from './lists/task-lists.js';
export { writeFootnote, FOOTNOTES_STRUCTURAL_CSS } from './text/footnotes.js';
export { structuralCssFor, lateStructuralCssFor } from './shared/structural-css.js';
export { hideFirstH1Plugin, HIDE_FIRST_H1_CLASS, HIDE_FIRST_H1_CSS } from './document/hide-first-h1.js';
export { tableAttrsFixPlugin } from './tables/attrs-fix.js';
export { TABLE_DIRECTIVE, EQUAL_WIDTHS, tableDirectiveAttrs, writeTableDirective } from './tables/table-directive.js';
export {
  columnWidthsPlugin, parseColumnWidths, writeColumnWidths, tableLayoutOf, columnWidthValue, columnWidthProblems,
  COLUMN_WIDTHS_ATTR, FIXED_LAYOUT_CLASS
} from './tables/column-widths.js';
export { figurePlugin } from './media/figure.js';
export { annotatedImagePlugin, ANNOTATED_IMAGE_STRUCTURAL_CSS, loadAnnotationYaml, PICTURE_FIELDS, shapesHiddenByCrop } from './media/annotated-image.js';
// C13: picture keys shared by FIGURE and the annotated image (crop in any unit, rotate, flip, redaction, marker size)
export {
  ROTATIONS, FLIPS, MARKER_SIZE, parseCropValue, parsePosValue, normalizeRotate, normalizeFlip, markerScale, readPictureKeys,
  pictureTransform, displayedRectToNatural, visibleArea, readRedactions, redactionKey, listPictureEdits, readPictureSize,
  MARKER_SCALE_STRUCTURAL_CSS, MARKER_LABEL_STRUCTURAL_CSS
} from './media/picture.js';
export { useFigureNumbering, FIGURE_NUMBER_RULE } from './media/figure-numbers.js';
export { listImageRefs } from './media/image-refs.js';
export { extractMermaidBlocks, parseFenceAttributes, MERMAID_VERSION, MERMAID_CONFIG } from './media/mermaid.js';
// Write rules (phase C3): each item's `write` is also exported by name for callers that need one directly
export { writeFigure, FIGURE_PARAM_ORDER } from './media/figure-write.js';
export { writeAnnotatedImage, canonicalAnnotationYaml, ANNOTATION_KEYS } from './media/annotated-image-write.js';
export { writeEmbed } from './media/embeds.js';
export { writeCallout } from './blocks/callouts-write.js';
export { writeAttributeContainer, readContainerAttributes, formatContainerAttributes } from './blocks/attribute-container-write.js';
export { writeContainer, readContainerInfo } from './blocks/containers-write.js';
export { writeAlert } from './blocks/github-alerts-write.js';
export { writeAttributes } from './text/attributes.js';
export { writeWikilink } from './text/wikilinks-write.js';
export { listMarker, markerGap } from './lists/fancy-lists-write.js';
export { writeTable, writeTableCaption, writeBracketCaption, escapeCell } from './tables/table-model.js';
export { writeInclude } from './document/include.js';
// C12: the text rules of !!!include(path)!!! (frontmatter, image paths, page type, which lines count)
export {
  INCLUDE_ANYWHERE, splitLines, splitFrontmatter, isFixedRef, rebasePath, analyzeIncludes, rebaseImageRefs,
  pageTypeAt, pageTypeAtEnd, layoutRestore, includeErrorBlock
} from './document/include-rules.js';
export { updateYaml, sameData, formatYamlValue } from './shared/yaml-edit.js';
export { itemOccurrences } from './shared/occurrences.js';
export {
  calloutPlugin,
  wikilinkPlugin,
  registerExtensions,
  directivesPlugin,
  registerDirectives
} from './compat.js';
