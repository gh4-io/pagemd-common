/**
 * Path helpers for the resolver.
 *
 * The resolver never imports `node:path`. The caller passes its own path functions as `env.path`
 * (pagemd passes Node's `path`, so results are exactly Node's, on Windows too). Without one, this
 * POSIX version is used (a browser, or an editor working on `/`-style paths). It follows Node's
 * `path.posix` for the functions the resolver needs; `test/path.test.js` compares the two.
 */

function normalizeSegments(path, allowAboveRoot) {
  const out = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (allowAboveRoot) out.push('..');
      continue;
    }
    out.push(segment);
  }
  return out.join('/');
}

function assertString(value, name = 'path') {
  if (typeof value !== 'string') {
    throw new TypeError(`The "${name}" argument must be of type string. Received ${value === null ? 'null' : typeof value}`);
  }
}

/** POSIX path functions (a subset of Node's `path.posix`). */
export const posix = {
  sep: '/',

  isAbsolute(path) {
    assertString(path);
    return path.startsWith('/');
  },

  normalize(path) {
    assertString(path);
    if (path === '') return '.';
    const absolute = path.startsWith('/');
    const trailing = path.endsWith('/');
    let result = normalizeSegments(path, !absolute);
    if (result === '' && !absolute) result = '.';
    if (result !== '' && trailing) result += '/';
    return (absolute ? '/' : '') + result;
  },

  join(...parts) {
    parts.forEach((p) => assertString(p));
    const joined = parts.filter((p) => p !== '').join('/');
    return joined === '' ? '.' : posix.normalize(joined);
  },

  resolve(...parts) {
    let resolved = '';
    let absolute = false;
    for (let i = parts.length - 1; i >= 0 && !absolute; i--) {
      const part = parts[i];
      assertString(part, `paths[${i}]`);
      if (part === '') continue;
      resolved = `${part}/${resolved}`;
      absolute = part.startsWith('/');
    }
    const normalized = normalizeSegments(resolved, !absolute);
    if (absolute) return `/${normalized}`;
    return normalized === '' ? '.' : normalized;
  },

  dirname(path) {
    assertString(path);
    if (path === '') return '.';
    const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
    const index = trimmed.lastIndexOf('/');
    if (index === -1) return '.';
    if (index === 0) return '/';
    return trimmed.slice(0, index).replace(/\/+$/, '') || '/';
  },

  basename(path, ext) {
    assertString(path);
    const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
    let base = trimmed.slice(trimmed.lastIndexOf('/') + 1);
    if (ext !== undefined && ext !== '' && base.endsWith(ext)) base = base.slice(0, -ext.length);
    return base;
  },

  extname(path) {
    const base = posix.basename(path);
    const index = base.lastIndexOf('.');
    if (index <= 0) return '';
    return base.slice(index);
  },

  parse(path) {
    assertString(path);
    return { root: path.startsWith('/') ? '/' : '' };
  },

  /** As Node's `path.posix.relative` for absolute paths (FIX-template-asset-paths: a template's picture written from the document). */
  relative(from, to) {
    assertString(from, 'from');
    assertString(to, 'to');
    const a = posix.resolve(from).split('/').filter(Boolean);
    const b = posix.resolve(to).split('/').filter(Boolean);
    let same = 0;
    while (same < a.length && same < b.length && a[same] === b[same]) same++;
    return [...a.slice(same).map(() => '..'), ...b.slice(same)].join('/');
  }
};

/** The path functions to use: the caller's (`env.path`) or the POSIX fallback. */
export function pathOf(env) {
  return env?.path ?? posix;
}

/**
 * `path.resolve` from the caller's working folder. Node's `path.resolve(x)` starts from
 * `process.cwd()`; the resolver can't read that, so the caller passes it as `env.cwd`
 * (same result in Node, and a defined one elsewhere).
 */
export function resolveFrom(env, ...parts) {
  const P = pathOf(env);
  return env?.cwd ? P.resolve(env.cwd, ...parts) : P.resolve(...parts);
}
