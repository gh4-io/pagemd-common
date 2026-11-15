/**
 * An in-memory FileSystem (phase C4): for tests here, in pagemd, and in the editor (P5, C8).
 * Paths are POSIX (`/project/doc.md`). Folders exist implicitly for every file under them, and can
 * be added empty with `dirs`.
 */

import { posix } from './path.js';

/**
 * @param {Record<string, string>} files - absolute path → text
 * @param {{ dirs?: string[] }} [options]
 * @returns {import('./ports.js').FileSystem & { async: () => object, reads: string[] }}
 *   `async()` gives the same files behind Promise-returning methods; `reads` records every
 *   path passed to readText (to check what a lookup touched)
 */
export function createMemoryFileSystem(files = {}, options = {}) {
  const fileMap = new Map();
  const dirSet = new Set(['/']);
  const addDirs = (path) => {
    for (let dir = posix.dirname(path); !dirSet.has(dir); dir = posix.dirname(dir)) {
      dirSet.add(dir);
    }
  };
  for (const [path, text] of Object.entries(files)) {
    const normalized = posix.normalize(path);
    fileMap.set(normalized, String(text));
    addDirs(normalized);
  }
  for (const dir of options.dirs || []) {
    const normalized = posix.normalize(dir).replace(/\/$/, '') || '/';
    dirSet.add(normalized);
    addDirs(normalized);
  }

  const norm = (path) => {
    const normalized = posix.normalize(path);
    return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
  };
  const reads = [];

  const fs = {
    reads,
    exists(path) {
      const p = norm(path);
      return fileMap.has(p) || dirSet.has(p);
    },
    readText(path) {
      const p = norm(path);
      reads.push(p);
      if (!fileMap.has(p)) {
        const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
        error.code = 'ENOENT';
        throw error;
      }
      return fileMap.get(p);
    },
    stat(path) {
      const p = norm(path);
      if (fileMap.has(p)) return { isFile: true, isDirectory: false, size: new TextEncoder().encode(fileMap.get(p)).length };
      if (dirSet.has(p)) return { isFile: false, isDirectory: true, size: 0 };
      return null;
    },
    list(path) {
      const p = norm(path);
      if (!dirSet.has(p)) {
        const error = new Error(`ENOENT: no such file or directory, scandir '${path}'`);
        error.code = 'ENOENT';
        throw error;
      }
      const prefix = p === '/' ? '/' : `${p}/`;
      const names = new Set();
      for (const entry of [...fileMap.keys(), ...dirSet]) {
        if (entry !== p && entry.startsWith(prefix)) {
          names.add(entry.slice(prefix.length).split('/')[0]);
        }
      }
      return [...names].sort();
    },
    async() {
      return {
        reads,
        exists: async (path) => fs.exists(path),
        readText: async (path) => fs.readText(path),
        stat: async (path) => fs.stat(path),
        list: async (path) => fs.list(path)
      };
    }
  };
  return fs;
}
