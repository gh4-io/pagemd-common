/**
 * @pagemd/validate: the checks a document's profile asks for (ADR-0017, phase C8). pagemd's CLI
 * (`pagemd validate`, `pagemd build --dry-run`) and pagemd-editor's Problems panel (P14) run these same rules, so
 * they give the same list for the same file.
 *
 *   const { diagnostics, enabled, strict } = await validate({ path, text }, { cliPath }, ports);
 *
 * `ports` are @pagemd/resolver's (`{ fs, env, log, cache }`): `validate` accepts a file system whose methods may
 * answer with Promises (the editor), `validateSync` needs a synchronous one. With no `validation` block in the
 * profile there are no checks (R-30). Levels and what each checks: see src/levels/*.js and config.js.
 *
 * Browser-safe: no Node built-ins, no process.* (see test/browser-safe.test.js).
 */

import { twins } from '@pagemd/resolver';
import { validateGen } from './run.js';

export { LEVELS, VALIDATION_KEYS, readConfig } from './config.js';
export { SEVERITIES, diagnostic, passes, lookupReason } from './diagnostic.js';
export { frontmatterBlock, readFrontmatter } from './document.js';
export { PROFILE_KEYS } from './levels/profile.js';
export { validateGen };

/** Run the checks (async file system allowed) → `{ diagnostics, enabled, strict, profileId }`. */
export const [validate, validateSync] = twins(validateGen);
