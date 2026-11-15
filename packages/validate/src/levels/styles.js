/**
 * Level `styles`: the profile's CSS, the document's own `styles:` and the profile's fonts and assets (ADR-0017).
 * - a profile stylesheet or a `styles:` file not found with rendering's own search (R-184) → error, in pagemd
 *   validate's words ("CSS file not found", "Custom CSS file not found")
 * - a font (`resources.fonts`) not found with the search `pagemd bundle` uses → warning ("Font file not found")
 * - a profile asset (`resources.assets`) not found next to the profile that names it → warning
 * - a stylesheet whose `{` and `}` don't pair up → warning (the rest of the file may be ignored)
 * - a `url(…)` in the layout or a profile stylesheet found neither next to that stylesheet nor in the document's folder (where
 *   rendering looks, FIX-template-asset-paths, R-259) → warning `template-asset-missing`
 * - a `url(…)` in a `styles:` file naming a file that isn't there (relative to the stylesheet) → warning `css-url-not-found`
 */

import { expandTokens, resolveResourceGen, resourceFolder, withManifestFolder } from '@pagemd/resolver';
import { diagnostic, lookupReason } from '../diagnostic.js';
import { templateAssetWarnings } from './template-assets.js';

const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;

/** CSS without comments and strings (so braces inside them don't count). */
function bareCss(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
}

/** Whether the braces pair up. */
function bracesBalanced(css) {
  let depth = 0;
  for (const ch of bareCss(css)) {
    if (ch === '{') depth++;
    else if (ch === '}' && --depth < 0) return false;
  }
  return depth === 0;
}

/** The url() references worth checking: relative files (not data:, web links, fragments or tokens). */
function localUrls(css) {
  const refs = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(URL_RE)) {
    const ref = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!ref || /^(data:|https?:|\/\/|#|about:|blob:)/i.test(ref) || ref.includes('${') || ref.startsWith('var(')) continue;
    refs.push(ref);
  }
  return [...new Set(refs)];
}

/** @returns {Generator<object, import('../diagnostic.js').Diagnostic[]>} */
export default function* styles(ctx) {
  const out = [];
  const r = ctx.resolved;
  const { P } = ctx;

  for (const entry of r.styles) {
    if (entry.skipped) continue;
    if (entry.error || !entry.path) {
      out.push(diagnostic('error', 'styles', 'css-not-found', `CSS file not found: ${entry.source} (${lookupReason(entry.error)})`, { searched: entry.error?.searchedPaths }));
    }
  }
  for (const entry of r.frontmatterStyles) {
    if (entry.error || !entry.path) {
      out.push(diagnostic('error', 'styles', 'custom-css-not-found', `Custom CSS file not found: ${entry.source} (${lookupReason(entry.error)})`, { line: 0, searched: entry.error?.searchedPaths }));
    }
  }

  // Fonts: the 5-tier search for styles, from the folder of the profile that names them (as pagemd bundle does)
  const fonts = Array.isArray(r.profile.resources?.fonts) ? r.profile.resources.fonts : [];
  const fontContext = withManifestFolder(r.pathContext, resourceFolder(r.profile, 'resources.fonts'));
  for (const font of fonts) {
    if (typeof font !== 'string') continue;
    try {
      const expanded = expandTokens(font, fontContext, ctx.ports);
      yield* resolveResourceGen(expanded, 'styles', {
        workingPath: fontContext.markdownDir,
        workspacePath: fontContext.projectRoot || fontContext.workspaceFolder,
        manifestPath: fontContext.manifestDir,
        cliPath: fontContext.cliPath,
        sourceType: 'profile'
      }, ctx.ports);
    } catch (error) {
      out.push(diagnostic('warning', 'styles', 'font-not-found', `Font file not found: ${font} (${lookupReason(error)})`, { searched: error?.searchedPaths }));
    }
  }

  // Profile assets: next to the profile that names them (as pagemd bundle does)
  const assets = Array.isArray(r.profile.resources?.assets) ? r.profile.resources.assets : [];
  const assetFolder = resourceFolder(r.profile, 'resources.assets') || r.markdownDir;
  for (const asset of assets) {
    if (typeof asset !== 'string') continue;
    let expanded = asset;
    try {
      expanded = expandTokens(asset, withManifestFolder(r.pathContext, assetFolder), ctx.ports);
    } catch {
      expanded = asset;
    }
    const file = P.isAbsolute(expanded) || !assetFolder ? expanded : P.resolve(assetFolder, expanded);
    if (!(yield* ctx.exists(file))) {
      out.push(diagnostic('warning', 'styles', 'profile-asset-not-found', `Profile asset not found: ${asset}`, { file }));
    }
  }

  // The stylesheets' own text
  const sheets = [r.layout?.path, ...r.styles.map((s) => s.path), ...r.frontmatterStyles.map((s) => s.path)].filter((p, i, all) => p && all.indexOf(p) === i);
  // The layout and the profile's CSS: their url() paths are rebased when the page is built (R-259), so they are checked the same way
  const profileSheets = new Set([r.layout?.path, ...r.styles.filter((s) => !s.skipped).map((s) => s.path)].filter(Boolean));
  for (const file of sheets) {
    const css = yield* ctx.read(file);
    if (css === null) continue;
    if (!bracesBalanced(css)) {
      out.push(diagnostic('warning', 'styles', 'css-braces', `Stylesheet ${P.basename(file)}: its { and } don't pair up, so the rest of the file may be ignored`, { file }));
    }
    if (profileSheets.has(file)) {
      out.push(...(yield* templateAssetWarnings(ctx, file, css, 'css', 'styles', file === r.layout?.path ? 'the layout' : 'the stylesheet')));
      continue;
    }
    for (const ref of localUrls(css)) {
      const clean = ref.split(/[?#]/)[0];
      let decoded = clean;
      try {
        decoded = decodeURI(clean);
      } catch {
        decoded = clean;
      }
      const target = P.isAbsolute(decoded) ? decoded : P.resolve(P.dirname(file), decoded);
      if (!(yield* ctx.exists(target))) {
        out.push(diagnostic('warning', 'styles', 'css-url-not-found', `CSS url() reference not found: ${ref} (in ${P.basename(file)})`, { file }));
      }
    }
  }
  return out;
}
