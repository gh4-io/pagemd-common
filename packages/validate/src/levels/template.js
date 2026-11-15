/**
 * Level `template`: the HTML template rendering fills in (ADR-0017; R-183: what rendering uses).
 * - not found (`resources.template`, else the deprecated `layout.source`, else pagemd's fallback) → error, found
 *   with rendering's own search (R-184)
 * - no `{{content}}` (the document's text never appears) or no `{{styles}}` (no styling) → warning
 * - `{{#if …}}` and `{{/if}}` that don't pair up → warning
 * - `{{metadata.x}}` naming a property nothing knows and the document doesn't set → one info listing them (they print empty)
 * - a relative picture path (src, srcset, poster, <link href>, url()) found neither next to the template nor in the
 *   document's folder → warning `template-asset-missing` (FIX-template-asset-paths, R-259)
 */

import { catalogue, normalize } from '@pagemd/meta';
import { diagnostic, lookupReason } from '../diagnostic.js';
import { templateAssetWarnings } from './template-assets.js';

const TOKEN = /\{\{([^}]+)\}\}/g;
const METADATA_KEY = /\bmetadata\.([A-Za-z_][\w-]*)/g;

/** The 0-based line of a character offset. */
const lineAt = (text, index) => text.slice(0, index).split('\n').length - 1;

/** @returns {Generator<object, import('../diagnostic.js').Diagnostic[]>} */
export default function* template(ctx) {
  const out = [];
  const found = ctx.resolved.template;
  if (found.error || !found.path) {
    const fallback = found.usedDefault ? " (the profile names no template, so pagemd looks for the workspace's templates/standard_letter.html)" : '';
    out.push(diagnostic('error', 'template', 'template-not-found', `Template file not found: ${found.source} (${lookupReason(found.error)})${fallback}`, { searched: found.error?.searchedPaths }));
    return out;
  }
  const file = found.path;
  const text = yield* ctx.read(file);
  if (text === null) {
    out.push(diagnostic('error', 'template', 'template-unreadable', `Template file can't be read: ${file}`, { file }));
    return out;
  }

  const tokens = [...text.matchAll(TOKEN)].map((m) => ({ inner: m[1].trim(), index: m.index }));
  if (!tokens.some((t) => t.inner === 'content')) {
    out.push(diagnostic('warning', 'template', 'no-content-token', `Template ${ctx.P.basename(file)} has no {{content}}: the document's text won't appear`, { file }));
  }
  if (!tokens.some((t) => t.inner === 'styles')) {
    out.push(diagnostic('warning', 'template', 'no-styles-token', `Template ${ctx.P.basename(file)} has no {{styles}}: the profile's CSS won't be applied`, { file }));
  }

  let depth = 0;
  let firstUnmatched = null;
  for (const t of tokens) {
    if (/^#if\s/.test(t.inner)) depth++;
    else if (t.inner === '/if') {
      depth--;
      if (depth < 0 && firstUnmatched === null) firstUnmatched = t;
    }
  }
  if (depth !== 0 || firstUnmatched) {
    const what = firstUnmatched ? `a {{/if}} without its {{#if}} (line ${lineAt(text, firstUnmatched.index) + 1})` : `${depth} {{#if}} without {{/if}}`;
    out.push(diagnostic('warning', 'template', 'unbalanced-if', `Template ${ctx.P.basename(file)} has ${what}: part of it may be printed or dropped by mistake`, { file }));
  }

  const known = new Set(catalogue(ctx.resolved.profile).map((f) => f.key));
  for (const key of Object.keys(ctx.resolved.profile.metadata?.defaults ?? {})) known.add(key);
  for (const field of ctx.config.requiredFields) known.add(field);
  const unset = [];
  for (const t of tokens) {
    for (const [, key] of t.inner.matchAll(METADATA_KEY)) {
      const canonicalKey = Object.keys(normalize({ [key]: true }, { applyDefaults: false }).values)[0] ?? key;
      if (known.has(key) || known.has(canonicalKey) || Object.hasOwn(ctx.frontmatter, canonicalKey) || unset.includes(key)) continue;
      unset.push(key);
    }
  }
  if (unset.length > 0) {
    out.push(diagnostic('info', 'template', 'unknown-template-property', `Template ${ctx.P.basename(file)} shows ${unset.length === 1 ? 'a property' : `${unset.length} properties`} this document doesn't set and pagemd doesn't know, printed empty: ${unset.join(', ')}`, { file }));
  }
  out.push(...(yield* templateAssetWarnings(ctx, file, text, 'html', 'template', 'the template')));
  return out;
}
