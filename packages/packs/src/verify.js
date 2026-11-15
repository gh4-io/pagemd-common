/**
 * Checking a pack before anything is written (phase L2-5), the library's `verifyPack` (pagemd-library
 * `scripts/unpack.mjs`) with the same steps, in the same order, stopping at the first problem:
 *   1. the zip's sha256 equals the one given (from the index beside it, or --sha256); there is no way to skip this;
 *   2. every entry name is clean (no "..", absolute path, backslash, symbolic link; allowed file type), no name twice
 *      (case ignored), and the zip holds only <id>.json and <id>/...;
 *   3. file contents are fine (no scripts, no remote references, real pictures and fonts): stylesheets, templates and
 *      SVG are read the way a browser reads them (markup.js), not matched with text patterns;
 *   4. the manifest lists exactly the files in the zip, each with its sha256; the profile sets only what a pack may
 *      set (profile.js: no output folders, no scripts, no paths outside ./<id>/); and every file the profile, a
 *      stylesheet, the template or an SVG names is in the zip.
 * A checksum from the same place as the zip guards against damage, not against a hostile source: the content rules
 * (steps 2–4) are the real guard.
 */

import { readZip, ZipError } from './zip.js';
import { badContent, badName, incomplete, sha256 } from './rules.js';
import { badProfile } from './profile.js';

/** Exit codes, as the library's unpack.mjs, plus 4. */
export const EXIT = Object.freeze({ ok: 0, refused: 1, usage: 2, wouldOverwrite: 3, existsElsewhere: 4 });

export class PackError extends Error {
  /** @param {string} message @param {number} [code] one of EXIT */
  constructor(message, code = EXIT.refused) {
    super(message);
    this.name = 'PackError';
    this.code = code;
  }
}

/**
 * Steps 1–4. Writes nothing.
 * @param {Buffer} zipBuf
 * @param {string} expectedSha - the zip's sha256 (hex)
 * @returns {{ id: string, files: {name: string, data: Buffer}[], manifest: object }}
 * @throws {PackError}
 */
export function verifyPack(zipBuf, expectedSha) {
  if (!expectedSha) throw new PackError('no checksum to verify against (give --index or --sha256)', EXIT.usage);
  if (sha256(zipBuf) !== String(expectedSha).toLowerCase()) throw new PackError('the zip does not match its checksum in the index (damaged or changed)');
  let entries;
  try { entries = readZip(zipBuf); } catch (e) { if (e instanceof ZipError) throw new PackError(`refused: ${e.message}`); throw e; }
  const files = entries.filter((e) => !e.isDir);
  const seen = new Set();
  for (const f of files) {
    const bad = badName(f.name);
    if (bad) throw new PackError(`refused: entry "${f.name}": ${bad}`);
    const key = f.name.toLowerCase();
    if (seen.has(key)) throw new PackError(`refused: entry "${f.name}" appears twice`);
    seen.add(key);
  }
  const top = files.find((f) => /^[^/]+\.json$/.test(f.name));
  if (!top) throw new PackError('refused: the zip has no <id>.json at its top');
  const id = top.name.slice(0, -5);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new PackError(`refused: "${id}" is not a safe profile id`);
  for (const f of files) {
    if (f.name !== `${id}.json` && !f.name.startsWith(`${id}/`)) throw new PackError(`refused: entry "${f.name}" is outside ${id}.json and ${id}/`);
    const bad = badContent(f.name, f.data);
    if (bad) throw new PackError(`refused: entry "${f.name}": ${bad}`);
  }
  const mf = files.find((f) => f.name === `${id}/manifest.json`);
  if (!mf) throw new PackError('refused: the pack has no manifest.json');
  const manifest = JSON.parse(mf.data.toString('utf8'));
  if (manifest.id !== id) throw new PackError(`refused: manifest id "${manifest.id}" is not "${id}"`);
  const listed = new Map((manifest.files ?? []).map((f) => [f.path, f]));
  for (const f of files) {
    if (f === mf) continue;
    const m = listed.get(f.name);
    if (!m) throw new PackError(`refused: "${f.name}" is not listed in the manifest`);
    if (m.sha256 !== sha256(f.data)) throw new PackError(`refused: "${f.name}" does not match its checksum in the manifest`);
  }
  for (const name of listed.keys()) if (!files.some((f) => f.name === name)) throw new PackError(`refused: the manifest lists "${name}" but the zip does not have it`);
  const bad = badProfile(id, JSON.parse(top.data.toString('utf8')));
  if (bad) throw new PackError(`refused: ${bad}`);
  const gaps = incomplete(id, files);
  if (gaps.length) throw new PackError(`refused: the pack is not self-contained: ${gaps.join('; ')}`);
  return { id, files, manifest };
}
