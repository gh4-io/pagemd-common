/**
 * The shared fixture (phase C8 acceptance: "the same Diagnostic[] in the CLI and the editor for the same file").
 * test/fixtures/shared/ is a small project; expected.json is what `validate` answers for each of its documents,
 * with the fixture's folder written `<fixture>`. Three places check against this one file:
 *   - here: the package itself, with Node's file system;
 *   - pagemd `tests/integration/validate-command.test.js`: the CLI's `checkFile` (pagemd's own ports);
 *   - pagemd-editor `packages/plugin-diagnostics/test/shared-fixture.test.ts`: the editor's checks (P14).
 * The environment is pinned the same way in all three: home `<fixture>/home` (no such folder), pagemd's own files
 * `<fixture>/defaults`, the shared profiles folder `<fixture>/config/profiles` (phase L2: PAGEMD_CONFIG_DIR `<fixture>/config`;
 * `docs/by-name.md` names a profile pack there by name).
 * Update expected.json only on purpose: PAGEMD_UPDATE_SHARED=1 npx vitest run packages/validate/test/shared-fixture.test.js
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../src/index.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'shared');
const EXPECTED = path.join(FIXTURE, 'expected.json');
const DOCUMENTS = ['docs/broken.md', 'docs/plain.md', 'docs/legacy.md', 'docs/includes.md', 'docs/by-name.md'];

const nodeFs = {
  exists: (p) => fs.existsSync(p),
  readText: (p) => fs.promises.readFile(p, 'utf8'),
  stat: (p) => { try { const s = fs.statSync(p); return { isFile: s.isFile(), isDirectory: s.isDirectory(), size: s.size }; } catch { return null; } },
  list: (p) => fs.readdirSync(p)
};

/** The fixture's folder written `<fixture>`, '/'-separated. */
const placeholders = (value) => JSON.parse(JSON.stringify(value).split(JSON.stringify(FIXTURE).slice(1, -1)).join('<fixture>').replace(/\\\\/g, '/'));

describe('the shared fixture', () => {
  it('validate answers expected.json for every document', async () => {
    const actual = {};
    for (const rel of DOCUMENTS) {
      const file = path.join(FIXTURE, rel);
      const result = await validate(
        { path: file, text: fs.readFileSync(file, 'utf8') },
        { cliPath: path.join(FIXTURE, 'defaults') },
        { fs: nodeFs, env: { homePath: path.join(FIXTURE, 'home'), cwd: FIXTURE, path, defaultsPath: path.join(FIXTURE, 'defaults'), sharedProfilesPath: path.join(FIXTURE, 'config', 'profiles') } }
      );
      actual[rel] = placeholders(result);
    }
    if (process.env.PAGEMD_UPDATE_SHARED === '1') fs.writeFileSync(EXPECTED, `${JSON.stringify(actual, null, 2)}\n`);
    expect(actual).toEqual(JSON.parse(fs.readFileSync(EXPECTED, 'utf8')));
  });
});
