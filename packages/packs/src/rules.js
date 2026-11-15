/**
 * What a profile pack may contain (phase L2-5), ported from pagemd-library `scripts/lib/packs.mjs` with the same rules
 * and limits: allowed file types, clean names, no scripts or remote references, real pictures and fonts, and every
 * file the profile or a stylesheet names inside the pack. Since the session-56 security review the text checks are
 * real readers (markup.js) and the profile is read against an allowlist (profile.js), stricter than the library's
 * reference copy. Node built-ins only.
 */

import path from 'node:path';
import crypto from 'node:crypto';
import { badCss, badMarkup, cssTokens, judgeAddress } from './markup.js';
import { badProfile } from './profile.js';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** File types a pack may hold (CSS, HTML, JSON, fonts, images, plain text). Nothing else. */
export const ALLOWED_EXT = new Set(['.json', '.css', '.html', '.woff2', '.woff', '.ttf', '.otf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.txt']);

const MAGIC = {
  '.png': (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  '.jpg': (b) => b[0] === 0xff && b[1] === 0xd8,
  '.jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  '.gif': (b) => b.subarray(0, 3).toString() === 'GIF',
  '.webp': (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
  '.woff2': (b) => b.subarray(0, 4).toString() === 'wOF2',
  '.woff': (b) => b.subarray(0, 4).toString() === 'wOFF',
  '.ttf': (b) => b.length >= 4 && (b.readUInt32BE(0) === 0x00010000 || b.subarray(0, 4).toString() === 'true'),
  '.otf': (b) => b.subarray(0, 4).toString() === 'OTTO'
};

/** The library's limits: 8 MB per file, 24 MB per pack (when building). */
export const MAX_FILE = 8 * 1024 * 1024;
export const MAX_PACK = 24 * 1024 * 1024;

/** Names Windows keeps for devices: a file called so can't be written there (any extension). */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\.|$)/i;

/** Judge one path inside a pack (forward slashes, relative to the pack root). A problem text, or null. */
export function badName(name) {
  if (!name || name.includes('\0')) return 'empty or NUL name';
  if (name.includes('\\')) return 'backslash in name';
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return 'absolute path';
  if (name.split('/').some((s) => s === '..' || s === '.' || s === '')) return 'path escapes or is not clean ("..", ".", empty part)';
  if (/[\x00-\x1f\x7f]/.test(name)) return 'control character in name';
  // Windows: ":" opens an alternate data stream or names a drive; <>"|?* can't be written; a trailing dot or space is dropped
  if (/[:<>"|?*]/.test(name)) return 'a character Windows cannot use in a file name (: < > " | ? *)';
  if (name.split('/').some((s) => / $|\.$/.test(s) || WINDOWS_RESERVED.test(s))) return 'a name Windows cannot use (a device name such as CON or NUL, or one ending in a dot or space)';
  if (!ALLOWED_EXT.has(path.posix.extname(name).toLowerCase())) return `file type "${path.posix.extname(name) || '(none)'}" is not allowed`;
  return null;
}

/**
 * Judge one file's bytes: right magic bytes; a stylesheet, template or SVG read the way a browser reads it, with no
 * script, no address outside the pack and nothing a browser would read differently (markup.js). A problem, or null.
 * `refs` (optional) receives the pack files a stylesheet, template or SVG names.
 */
export function badContent(name, data, refs = []) {
  const ext = path.posix.extname(name).toLowerCase();
  if (data.length > MAX_FILE) return `file is over ${MAX_FILE} bytes`;
  if (MAGIC[ext] && !MAGIC[ext](data)) return `contents are not a real ${ext} file`;
  if (['.html', '.css', '.svg', '.txt', '.json'].includes(ext)) {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { return 'is not UTF-8 text'; }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (ext === '.css') return badCss(text, name, refs);
    if (ext === '.html') return badMarkup(text, 'html', name, refs);
    if (ext === '.svg') return badMarkup(text, 'svg', name, refs);
    if (ext === '.json') { try { JSON.parse(text); } catch { return 'is not valid JSON'; } }
  }
  return null;
}

/** Local files a stylesheet names with url(...) (data:, #, and addresses with a scheme skipped), escapes decoded. */
export function cssRefs(text, from = 'x/x.css') {
  const refs = [];
  const t = cssTokens(text);
  if ('problem' in t) return refs;
  for (let k = 0; k < t.tokens.length; k++) {
    const { type, value } = t.tokens[k];
    if (type === 'url' || (type === 'string' && t.tokens[k - 1]?.type === 'function' && t.tokens[k - 1].value === 'url')) {
      const j = judgeAddress(value, from);
      if ('ref' in j) refs.push(j.ref);
    }
  }
  return refs;
}

/**
 * Is the pack self-contained? Its profile sets only what a pack may set (profile.js), every file the profile names is
 * inside the pack, and every local address in every stylesheet, template and SVG (url(...), src, href) is a file of the
 * pack. A list of problems. `files` are [{name, data}] relative to the pack root.
 */
export function incomplete(id, files) {
  const have = new Map(files.map((f) => [f.name, f.data]));
  const problems = [];
  const prof = have.get(`${id}.json`);
  if (!prof) return [`${id}.json is missing`];
  let p;
  try { p = JSON.parse(prof.toString('utf8')); } catch { return [`${id}.json is not valid JSON`]; }
  const bad = badProfile(id, p);
  if (bad) return [bad];
  const named = [p.resources?.template, p.resources?.layout, ...(p.resources?.css ?? []), ...(p.resources?.fonts ?? []), ...(p.resources?.assets ?? [])].filter(Boolean);
  for (const n of named) {
    const name = n.slice(2);
    if (!have.has(name)) problems.push(`${id}.json names ${name}, which the pack does not have`);
  }
  for (const f of files) {
    if (!/\.(css|html|svg)$/i.test(f.name)) continue;
    const refs = [];
    if (badContent(f.name, f.data, refs)) continue; // refused by verifyPack already
    for (const ref of refs) if (!have.has(ref)) problems.push(`${f.name} refers to ${ref}, which the pack does not have`);
  }
  return problems;
}
