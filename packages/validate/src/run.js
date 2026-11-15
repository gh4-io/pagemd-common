/**
 * validate(): run the checks a document's profile asks for (ADR-0017, phase C8).
 *
 * 1. Read the frontmatter (a YAML error stops here: "Parse error: …").
 * 2. Find the profile, template, layout and stylesheets with the resolver's `resolveDocument`, the same lookups
 *    rendering uses (R-184). A profile that can't be loaded stops here ("Profile error: …"): rendering would stop too,
 *    so this is reported whatever the profile says.
 * 3. Read the profile's `validation` (config.js). No block: no checks, an empty list (R-30).
 * 4. Run each level that is on, in LEVELS order.
 *
 * Written once as a generator that asks for file access (the resolver's ports, `yield fsOp.readText(path)`), so it
 * runs with a synchronous file system (`validateSync`, pagemd's CLI) and an asynchronous one (`validate`, the editor
 * over VS Code's file API) with one copy of the logic.
 */

import { fsOp, pathOf, resolveDocumentGen } from '@pagemd/resolver';
import { normalize } from '@pagemd/meta';
import { LEVELS, readConfig } from './config.js';
import { diagnostic } from './diagnostic.js';
import { parseBody, readFrontmatter } from './document.js';
import meta from './levels/meta.js';
import profile from './levels/profile.js';
import template from './levels/template.js';
import layout from './levels/layout.js';
import styles from './levels/styles.js';
import syntax from './levels/syntax.js';
import assets from './levels/assets.js';

const CHECKS = { meta, profile, template, layout, styles, syntax, assets };

/**
 * @typedef {object} ValidationResult
 * @property {import('./diagnostic.js').Diagnostic[]} diagnostics - in level order
 * @property {boolean} enabled - the profile asked for checks (false: `diagnostics` holds at most a parse or profile error)
 * @property {boolean} strict - the profile's `validation.strict`, or the caller's `strict`
 * @property {string|null} profileId - the profile asked for (null when the frontmatter couldn't be read)
 */

/**
 * @param {{ path: string|null, text: string }} input - the document (its path; null for text without a file)
 * @param {object} [options]
 * @param {string} [options.profile] - the profile when the frontmatter names none (`pagemd build -p`, R-57)
 * @param {string} [options.profileOverride] - the profile whatever the frontmatter says (`pagemd validate -p`)
 * @param {string|null} [options.cliPath] - pagemd's bundled files (default: the ports' `env.defaultsPath`)
 * @param {boolean} [options.strict] - warnings fail too (the CLI's --strict), on top of the profile's
 * @param {import('@pagemd/resolver').Ports} ports
 * @returns {Generator<object, ValidationResult>}
 */
export function* validateGen(input, options = {}, ports = {}) {
  const text = String(input?.text ?? '');
  const path = input?.path ?? null;

  let written;
  try {
    written = readFrontmatter(text);
  } catch (error) {
    return result([diagnostic('error', 'meta', 'frontmatter-error', `Parse error: ${error.message}`, { line: 0 })], false, options.strict, null);
  }
  const { values: frontmatter, keys: writtenKeys } = normalize(written, { applyDefaults: false });

  const asked = { ...frontmatter };
  let profileOption = options.profile;
  if (options.profileOverride) {
    delete asked.pipeline_profile;
    profileOption = options.profileOverride;
  }

  let resolved;
  try {
    resolved = yield* resolveDocumentGen(path, {
      frontmatter: asked,
      ...(profileOption !== undefined ? { profile: profileOption } : {}),
      ...(options.cliPath !== undefined ? { cliPath: options.cliPath } : {})
    }, ports);
  } catch (error) {
    return result([diagnostic('error', 'profile', 'profile-error', `Profile error: ${error.message}`)], false, options.strict, asked.pipeline_profile ?? profileOption ?? null);
  }

  const config = readConfig(resolved.profile.validation);
  if (!config.enabled) return result([], false, options.strict, resolved.profileId);

  const P = pathOf(ports.env);
  const texts = new Map();
  let tokens;
  const ctx = {
    input: { path, text },
    written,
    writtenKeys,
    frontmatter,
    resolved,
    config,
    ports,
    P,
    /** The body's block tokens (parsed once, on first use). */
    tokens() {
      if (!tokens) tokens = parseBody(text);
      return tokens;
    },
    /** A file's text, read once; null when it can't be read. */
    *read(file) {
      if (!texts.has(file)) {
        let value = null;
        try {
          value = yield fsOp.readText(file);
        } catch {
          value = null;
        }
        texts.set(file, value);
      }
      return texts.get(file);
    },
    /** Whether a file exists. */
    *exists(file) {
      try {
        return Boolean(yield fsOp.exists(file));
      } catch {
        return false;
      }
    }
  };

  const diagnostics = [];
  for (const level of LEVELS) {
    if (!config.levels[level].on) continue;
    diagnostics.push(...(yield* CHECKS[level](ctx, config.levels[level].options)));
  }
  return result(diagnostics, true, options.strict || config.strict, resolved.profileId);
}

function result(diagnostics, enabled, strict, profileId) {
  return { diagnostics, enabled, strict: Boolean(strict), profileId };
}
