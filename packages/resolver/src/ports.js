/**
 * Ports: what the caller fills in, so the resolver runs anywhere (phase C4).
 *
 * The lookup logic is written once, as generator functions that *ask* for file access
 * (`yield fsOp.exists(path)`) instead of doing it. Two small drivers answer those requests:
 * `runSync` with a synchronous `FileSystem` (pagemd's CLI, which has always been synchronous here) and
 * `runAsync` with an asynchronous one (the editor, where VS Code's file API only answers later).
 * The logic can't differ between the two, because there is only one copy of it.
 *
 * @typedef {object} FileSystem  Every method may return its value directly or as a Promise (async
 *   driver only). Paths are the caller's own (Node paths for pagemd).
 * @property {(path: string) => boolean} exists  true for files and folders (Node `existsSync`)
 * @property {(path: string) => string} readText  UTF-8 text; throws when it can't be read
 * @property {(path: string) => ({ isFile: boolean, isDirectory: boolean, size: number } | null)} stat
 *   null when the path can't be read
 * @property {(path: string) => string[]} list  entry names of a folder; throws when it can't be read
 *
 * @typedef {object} Environment
 * @property {string} [homePath]  the user's home folder (`~/.pagemd/{type}/`; tier 4, tier 5 for profiles)
 * @property {string} [sharedProfilesPath]  the shared profiles folder (profile packs; tier 4 for profiles only, L2);
 *   pagemd fills it with `sharedProfilesFolder()` (shared-folder.js); absent: no shared tier
 * @property {string} [defaultsPath]  bundled defaults (tier 5; tier 6 for profiles; pagemd's `cliPath`)
 * @property {string} [cwd]  the working folder, where Node would use `process.cwd()`
 * @property {object} [path]  path functions (pagemd passes `node:path`); POSIX when absent
 *
 * @typedef {object} Ports
 * @property {FileSystem} fs
 * @property {Environment} [env]
 * @property {(category: string) => object} [log]  logger factory, e.g. pagemd's `createLogger`;
 *   loggers have trace/debug/info/warn/error(section, status, message, data). Silent when absent.
 * @property {Map} [cache]  profile cache shared with the caller (pagemd's `clearConfigCache` clears it)
 */

/** The file requests a lookup generator can yield. */
export const fsOp = {
  exists: (path) => ({ op: 'exists', path }),
  readText: (path) => ({ op: 'readText', path }),
  stat: (path) => ({ op: 'stat', path }),
  list: (path) => ({ op: 'list', path })
};

const OPS = new Set(Object.keys(fsOp));

function call(fs, request) {
  if (!request || !OPS.has(request.op)) {
    throw new Error(`Unknown file request: ${request && request.op}`);
  }
  if (typeof fs?.[request.op] !== 'function') {
    throw new Error(`The FileSystem port has no ${request.op}()`);
  }
  return fs[request.op](request.path);
}

/**
 * Run a lookup with a synchronous FileSystem. Errors thrown by the FileSystem are thrown back into
 * the lookup (so its own try/catch sees them, as it would around `fs.readFileSync`).
 */
export function runSync(generator, fs) {
  let step = generator.next();
  while (!step.done) {
    let value;
    let failed = false;
    let error;
    try {
      value = call(fs, step.value);
      if (value && typeof value.then === 'function') {
        throw new Error(`The FileSystem port answered ${step.value.op}() with a Promise; use the async function`);
      }
    } catch (err) {
      failed = true;
      error = err;
    }
    step = failed ? generator.throw(error) : generator.next(value);
  }
  return step.value;
}

/** Run a lookup with a FileSystem whose methods may return Promises. */
export async function runAsync(generator, fs) {
  let step = generator.next();
  while (!step.done) {
    let value;
    let failed = false;
    let error;
    try {
      value = await call(fs, step.value);
    } catch (err) {
      failed = true;
      error = err;
    }
    step = failed ? generator.throw(error) : generator.next(value);
  }
  return step.value;
}

/** Run a lookup that needs no files at all (it throws if it asks for one). */
export function runPure(generator) {
  return runSync(generator, {});
}

/**
 * Make the async and sync public functions from one lookup generator. The ports are always the
 * last argument.
 * @returns {[Function, Function]} [async, sync]
 */
export function twins(generatorFn) {
  const portsOf = (args) => args[args.length - 1] || {};
  const asyncFn = (...args) => runAsync(generatorFn(...args), portsOf(args).fs);
  const syncFn = (...args) => runSync(generatorFn(...args), portsOf(args).fs);
  return [asyncFn, syncFn];
}

const SILENT = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };

/** A logger for one category, or a silent one when the caller passed no `log`. */
export function loggerOf(ports, category) {
  return ports?.log ? ports.log(category) : SILENT;
}
