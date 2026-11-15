/**
 * buildStyles(): the stylesheets of one document → its final CSS and page (phase C5).
 *
 * The caller finds the files (@pagemd/resolver resolveDocument) and reads them; buildStyles only
 * arranges text, so the CLI and the editor get the same CSS from the same files. pagemd's renderer
 * produces its style block with the same function (formatStyleBlock), so its CSS is this CSS.
 */

import { formatStyleBlock } from './style-block.js';
import { generatePageLayoutCSS, runningContent } from './page-layout.js';
import { pageGeometry, namedPages, hasPageRule, FALLBACK_PAGE } from './geometry.js';
import { layoutRunningContent } from './margin-boxes.js';

/**
 * pagemd's default files, relative to the defaults folder (`@pagemd/theme-kit/defaults/`). The
 * folder mirrors pagemd's own (`styles/…`, `layouts/…`), so it can serve as the resolver's
 * `defaultsPath`. pagemd keeps byte-identical copies (its test checks them).
 * The default layout is pagemd's letter.css: what the default profile (standard_letter) and every
 * bundled profile but book-wiki print with (R-21, ADR-0014, C5 choice Q1).
 */
export const DEFAULTS = Object.freeze({
  base: 'styles/base.css',
  primary: 'styles/primary.css',
  syntax: 'styles/syntax/shiki-base.css',
  layout: 'layouts/letter.css'
});

const sheet = (value) => (value == null ? null : typeof value === 'string' ? { content: value } : value);

function inside(path, folder) {
  if (!path || !folder) return false;
  const p = String(path).replace(/\\/g, '/');
  const f = String(folder).replace(/\\/g, '/').replace(/\/+$/, '');
  return p.startsWith(`${f}/`);
}

/**
 * @typedef {{ content: string, path?: string, source?: string }} Sheet
 *
 * @param {object} input
 * @param {Sheet|string|null} input.base - styles/base.css
 * @param {string} [input.structural] - CSS added at the end of the base layer (pagemd-editor P26: the CSS of the footnotes
 *   and task lists a document uses, @pagemd/syntax's structuralCssFor(html); pagemd's renderer adds the same text)
 * @param {string} [input.structuralLate] - CSS in a layer of its own, `structural`, after the profile's (FIX-ADT: the task lists' look,
 *   @pagemd/syntax's lateStructuralCssFor(html); pagemd's renderer adds the same text); '' or none: no such layer, the output is as before
 * @param {Sheet|string|null} input.primary - styles/primary.css
 * @param {Sheet|string|null} [input.syntax] - styles/syntax/shiki-base.css
 * @param {Sheet|null} [input.layout] - the profile's layout (null: none, or it wasn't found)
 * @param {Sheet[]} [input.profile] - the profile's CSS, in order (base/primary entries left out)
 * @param {Sheet[]} [input.frontmatter] - the document's `styles:` files, in order
 * @param {object} [input.metadata] - properties layered as pagemd does (running header/footer…)
 * @param {boolean} [input.syntaxHighlight=true] - the syntax layer (pagemd: PAGEMD_SYNTAX_HIGHLIGHT)
 * @param {Sheet|string|null} [input.defaultLayout] - used as the layout when neither a layout nor
 *   any @page rule exists (the editor passes DEFAULTS.layout; pagemd's CLI passes nothing, so its
 *   output is unchanged)
 * @param {string|null} [input.defaultsPath] - pagemd's own folder: a layout inside it is `bundled`
 *   (the editor must not write to it)
 * @param {boolean|'split'} [input.extractCSS=false] - the form of `styleBlock` (see formatStyleBlock)
 * @param {boolean} [input.useCSSLayers=true]
 * @param {boolean} [input.minify=false]
 * @param {string} [input.profileId]
 * @param {object} [input.log] - a logger
 * @returns {{
 *   css: string,
 *   styleBlock: string|object,
 *   frontmatterCSS: string,
 *   layers: Array<{ layer: string, content: string, source?: string, path?: string }>,
 *   page: { width: number, height: number, margins: { top: number, right: number, bottom: number, left: number } },
 *   pageUnreadable: string[],
 *   namedPages: Record<string, { width: number, height: number, margins: object }>,
 *   header: object|null, footer: object|null, firstPage: object|false|null, marginFontSize: string|null,
 *   layoutRunning: { header: object|null, footer: object|null, firstPage: object|null, strings: object, named?: object },
 *   usingDefault: boolean,
 *   layout: { path: string|null, source: string|null, bundled: boolean } | null,
 *   sources: string[]
 * }}
 *   `css`: every layer as one CSS text (the external stylesheet pagemd writes with extractCSS, then
 *   the frontmatter layer); `styleBlock`: exactly what pagemd puts in its HTML.
 */
export function buildStyles(input = {}) {
  const {
    metadata = {},
    syntaxHighlight = true,
    defaultsPath = null,
    extractCSS = false,
    useCSSLayers = true,
    minify = false,
    profileId,
    log
  } = input;
  const plainBase = sheet(input.base);
  const base = plainBase && input.structural ? { ...plainBase, content: `${plainBase.content}\n${input.structural}` } : plainBase;
  const primary = sheet(input.primary);
  const syntax = sheet(input.syntax);
  const profile = (input.profile || []).map(sheet);
  const frontmatter = (input.frontmatter || []).map(sheet);
  const defaultLayout = sheet(input.defaultLayout);
  let layout = sheet(input.layout);

  // A page rule anywhere counts, as the acceptance criterion says ("no layout file / @page")
  const anyPageRule = [base, primary, syntax, ...profile, ...frontmatter]
    .some((s) => s && hasPageRule(s.content));
  const usingDefault = !layout && !anyPageRule;
  const layoutInfo = layout
    ? { path: layout.path ?? null, source: layout.source ?? null, bundled: inside(layout.path, defaultsPath) }
    : null;
  if (usingDefault && defaultLayout) layout = defaultLayout;

  // pagemd's aggregateStyles order: base, primary, layout?, syntax?, profile…
  const layers = [];
  const push = (layer, s) => {
    if (s) layers.push({ layer, content: s.content, source: s.source, path: s.path });
  };
  push('base', base);
  push('primary', primary);
  push('layout', layout);
  if (syntaxHighlight) push('syntax', syntax);
  for (const s of profile) push('profile', s);
  if (input.structuralLate) push('structural', sheet(input.structuralLate));

  // The frontmatter layer: running header/footer variables, then the `styles:` files
  const frontmatterFilesCSS = frontmatter.map((s) => s.content).join('\n');
  const frontmatterCSS = [generatePageLayoutCSS(metadata, { log }), frontmatterFilesCSS]
    .filter(Boolean)
    .join('\n');

  const aggregated = layers.map(({ layer, content, source, path }) => ({ layer, content, source, resolvedPath: path }));
  const styleBlock = formatStyleBlock(aggregated, {
    frontmatterCSS: frontmatterCSS || undefined,
    extractCSS,
    useCSSLayers,
    minify,
    profileId,
    log
  });
  const external = formatStyleBlock(aggregated, { frontmatterCSS: frontmatterCSS || undefined, extractCSS: true, minify });
  const css = external.externalCSS + (external.frontmatterCSS ? `@layer frontmatter {\n${external.frontmatterCSS}\n}\n` : '');

  // The page, from every layer in cascade order
  const allCss = [...layers.map((l) => l.content), frontmatterCSS].join('\n');
  const geometry = pageGeometry(allCss, { fallback: FALLBACK_PAGE });
  const named = {};
  for (const name of namedPages(allCss)) {
    const g = pageGeometry(allCss, { name, fallback: FALLBACK_PAGE });
    named[name] = { width: g.width, height: g.height, margins: g.margins };
  }

  const running = runningContent(metadata);
  const sources = [...layers.map((l) => l.path), ...frontmatter.map((s) => s.path)]
    .filter((p, i, all) => p && all.indexOf(p) === i);

  if (frontmatterCSS) layers.push({ layer: 'frontmatter', content: frontmatterCSS });

  return {
    css,
    styleBlock,
    frontmatterCSS,
    layers,
    page: { width: geometry.width, height: geometry.height, margins: geometry.margins },
    pageUnreadable: geometry.unreadable,
    namedPages: named,
    header: running.header,
    footer: running.footer,
    firstPage: running.firstPage,
    marginFontSize: running.marginFontSize,
    // Headers/footers written in the CSS's own margin boxes (pagemd-editor P6, R-141); pagemd's CLI ignores it
    layoutRunning: layoutRunningContent(allCss),
    usingDefault,
    layout: layoutInfo,
    sources
  };
}
