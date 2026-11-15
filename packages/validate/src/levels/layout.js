/**
 * Level `layout`: the page CSS (ADR-0017; R-183: `resources.layout`, else the deprecated `layout.css`).
 * - not found with rendering's own search (R-184) → error
 * - found, but neither it nor any other stylesheet has an `@page { … }` rule → warning (the page is Paged.js's Letter with 1 in margins)
 * - a page size or margin @pagemd/theme-kit can't read (var(), calc(), %) → info (the editor's pages may differ)
 * - every `<!-- ::LAYOUT(name) -->` the document uses (the directive opens `<div class="page-name">`) needs a
 *   `.page-name` rule and an `@page name` rule somewhere in the document's CSS → warning otherwise. `default` is
 *   the ordinary page and needs neither.
 */

import { hasPageRule, namedPages, pageGeometry } from '@pagemd/theme-kit';
import { itemOccurrences } from '@pagemd/syntax';
import { diagnostic, lookupReason } from '../diagnostic.js';

/** Every CSS file the document's styles are built from, read (layout, profile CSS, frontmatter styles, pagemd's own). */
export function* allCss(ctx) {
  const r = ctx.resolved;
  const files = [r.system?.base, r.system?.primary, r.layout?.path, ...r.styles.map((s) => s.path), ...r.frontmatterStyles.map((s) => s.path)];
  const texts = [];
  for (const file of files) {
    if (!file) continue;
    const text = yield* ctx.read(file);
    if (text !== null) texts.push(text);
  }
  return texts.join('\n');
}

/** @returns {Generator<object, import('../diagnostic.js').Diagnostic[]>} */
export default function* layout(ctx) {
  const out = [];
  const found = ctx.resolved.layout;
  if (found && (found.error || !found.path)) {
    out.push(diagnostic('error', 'layout', 'layout-not-found', `Layout file not found: ${found.source} (${lookupReason(found.error)})`, { searched: found.error?.searchedPaths }));
  } else if (found) {
    const file = found.path;
    const css = yield* ctx.read(file);
    if (css === null) {
      out.push(diagnostic('error', 'layout', 'layout-unreadable', `Layout file can't be read: ${file}`, { file }));
    } else {
      if (!hasPageRule(css) && !hasPageRule(yield* allCss(ctx))) {
        out.push(diagnostic('warning', 'layout', 'no-page-rule', `Layout file ${ctx.P.basename(file)} has no @page rule (nor has any other stylesheet): the page is Letter with 1 in margins`, { file }));
      }
      for (const item of pageGeometry(css).unreadable) {
        out.push(diagnostic('info', 'layout', 'page-unreadable', `Layout file ${ctx.P.basename(file)}: the page's ${item} can't be read by the editor, so its pages may differ from the PDF`, { file }));
      }
    }
  }

  const used = itemOccurrences(ctx.tokens()).filter((o) => o.item === 'layout');
  if (used.length === 0) return out;
  const css = yield* allCss(ctx);
  const names = new Set(namedPages(css).map((n) => n.toLowerCase()));
  const reported = new Set();
  for (const o of used) {
    const name = String(o.data.parenParams || o.data.attrs?.name || 'default').trim();
    if (name === 'default' || reported.has(name)) continue;
    const selector = new RegExp(`\\.page-${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
    const missing = [!selector.test(css) && `.page-${name} { page: ${name} }`, !names.has(name.toLowerCase()) && `@page ${name} { … }`].filter(Boolean);
    if (missing.length === 0) continue;
    reported.add(name);
    out.push(diagnostic('warning', 'layout', 'layout-name-without-page-rule', `LAYOUT(${name}) has no page rule (${missing.join(' and ')}): these pages look like the others`, { line: o.token.map?.[0] }));
  }
  return out;
}
