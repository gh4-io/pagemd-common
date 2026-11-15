/**
 * Level `profile`: the profile and every profile it `extends` (ADR-0017). That the profile exists and has no
 * `extends` loop is checked before any level runs (run.js: rendering would stop, so it is always reported).
 * - a profile found by name whose `id` differs from its file name → warning (rendering only warns too; the old
 *   `validateProfile` threw, R-186)
 * - a setting the profile format doesn't have (`profile.schema.json`'s top-level keys) → warning
 * - a `validation` key that isn't a setting (e.g. the removed `validation.schema`, R-185) → warning
 * - deprecated settings still used: `layout.source` (read as the template, R-183), `layout.css`, `styles.profile` → info
 */

import { isProfilePath, loadProfileGen, profileSourcePath } from '@pagemd/resolver';
import { diagnostic } from '../diagnostic.js';

/**
 * The top-level keys of pagemd's `schemas/profile.schema.json` (pagemd's tests check this list against the file),
 * plus `$schema`.
 */
export const PROFILE_KEYS = Object.freeze([
  '$schema', 'id', 'extends', 'description', 'layout', 'resources', 'styles', 'pagedjs', 'outputs', 'validation',
  'metadata', 'rendering', 'annotatedImage'
]);

const DEPRECATED = [
  ['layout.source', '`layout.source` is an old setting: use `resources.template` (and `resources.layout` for the page CSS)'],
  ['layout.css', '`layout.css` is an old setting: use `resources.layout`'],
  ['styles.profile', '`styles.profile` is an old setting: use `resources.css`']
];

const valueAt = (object, key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), object);

/** @returns {Generator<object, import('../diagnostic.js').Diagnostic[]>} */
export default function* profile(ctx) {
  const out = [];
  const { resolved, config, P } = ctx;
  const where = { searchFrom: resolved.markdownDir || resolved.projectRoot, configDir: resolved.projectRoot, cliPath: resolved.cliPath, variant: 'sync' };

  // The chain as written: each profile file, unmerged
  const seen = new Set();
  let name = resolved.profileId;
  while (name && !seen.has(name)) {
    seen.add(name);
    const one = yield* loadProfileGen(name, where, ctx.ports);
    if (!one) break;
    const file = profileSourcePath(one) ?? undefined;
    const label = one.id ?? name;

    if (!isProfilePath(name) && file) {
      const fileName = P.basename(file).replace(/\.(json|ya?ml)$/i, '');
      if (one.id && one.id !== fileName) {
        out.push(diagnostic('warning', 'profile', 'profile-id-mismatch', `Profile ID '${one.id}' does not match filename '${fileName}'`, { file }));
      }
    }
    for (const key of Object.keys(one)) {
      if (key.startsWith('_') || PROFILE_KEYS.includes(key)) continue;
      out.push(diagnostic('warning', 'profile', 'unknown-profile-setting', `Profile ${label} has a setting pagemd doesn't read: ${key}`, { file }));
    }
    for (const [key, note] of DEPRECATED) {
      if (valueAt(one, key) !== undefined && valueAt(one, key) !== null) {
        out.push(diagnostic('info', 'profile', 'deprecated-setting', `Profile ${label}: ${note}`, { file }));
      }
    }
    name = one.extends;
  }

  for (const key of config.unknownKeys) {
    const extra = key === 'schema' ? ' (validation.schema was never read and is no longer a setting)' : '';
    out.push(diagnostic('warning', 'profile', 'unknown-validation-setting', `validation.${key} is not a validation setting${extra}`, { file: resolved.profileChain[0]?.path ?? undefined }));
  }
  return out;
}
