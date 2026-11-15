/**
 * The shared profiles folder (phase L2, R-263, R-264): where profile packs are installed, and one more tier of the profile
 * search (after the project, before `~/.pagemd/profiles`). The rule is the library's `defaultTarget` (pagemd-library
 * `scripts/unpack.mjs`), ported to take everything it needs as arguments, so it stays browser-safe and testable:
 *
 *   PAGEMD_CONFIG_DIR set   `$PAGEMD_CONFIG_DIR/profiles` (replaces the folder below; also the install target)
 *   Windows                 `%LOCALAPPDATA%\pagemd\profiles` (Local, not Roaming: fonts and logos must not sync over a domain)
 *   WSL                     the Windows folder above, `/mnt/c/Users/<user>/AppData/Local/pagemd/profiles`, when that user's
 *                           `AppData/Local` exists: the Windows user named like the WSL user, else the only real Windows user
 *   macOS                   `~/Library/Application Support/pagemd/profiles`
 *   Linux (and WSL without a match)  `${XDG_DATA_HOME:-~/.local/share}/pagemd/profiles`
 *
 * The folder may not exist; the search skips a missing folder like any other.
 */

import { posix } from './path.js';

/** Windows profile folders that are not a person (skipped by the WSL single-user guess). */
const NOT_A_USER = /^(Default|Default User|Public|All Users|desktop\.ini|WsiAccount|defaultuser0)$/i;

/** A small join for Windows paths, so a caller on any system can ask for the Windows answer. */
const win32Join = (...parts) => parts.filter(Boolean).join('\\').replace(/[\\/]+/g, '\\');

/**
 * The shared profiles folder and why it was chosen.
 * @param {object} options
 * @param {string} options.platform - `process.platform` ('win32', 'darwin', 'linux', ...)
 * @param {Record<string, string|undefined>} [options.env] - the process environment (PAGEMD_CONFIG_DIR, LOCALAPPDATA,
 *   XDG_DATA_HOME, WSL_DISTRO_NAME, USER, LOGNAME)
 * @param {string} options.homePath - the user's home folder
 * @param {(path: string) => boolean} [options.exists] - for the WSL guess; without it WSL is treated as Linux
 * @param {(path: string) => string[]} [options.list] - folder entries, for the WSL single-user guess
 * @param {string} [options.osRelease] - `os.release()` (contains "microsoft" under WSL)
 * @param {object} [options.path] - path functions for this system (pagemd passes `node:path`); POSIX when absent
 * @returns {{ path: string, reason: 'PAGEMD_CONFIG_DIR' | 'windows' | 'wsl-user' | 'wsl-only-user' | 'macos' | 'xdg' }}
 */
export function sharedProfilesFolderInfo(options) {
  const { platform, env = {}, homePath, exists, list, osRelease = '' } = options;
  const P = options.path ?? posix;
  const configDir = env.PAGEMD_CONFIG_DIR;
  if (typeof configDir === 'string' && configDir.trim() !== '') {
    return { path: platform === 'win32' && !options.path ? win32Join(configDir, 'profiles') : P.join(configDir, 'profiles'), reason: 'PAGEMD_CONFIG_DIR' };
  }
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || (options.path ? P.join(homePath, 'AppData', 'Local') : win32Join(homePath, 'AppData', 'Local'));
    return { path: options.path ? P.join(local, 'pagemd', 'profiles') : win32Join(local, 'pagemd', 'profiles'), reason: 'windows' };
  }
  if (platform === 'darwin') {
    return { path: posix.join(homePath, 'Library', 'Application Support', 'pagemd', 'profiles'), reason: 'macos' };
  }
  const isWsl = Boolean(env.WSL_DISTRO_NAME) || /microsoft/i.test(osRelease);
  if (isWsl && typeof exists === 'function') {
    const users = '/mnt/c/Users';
    const local = (name) => posix.join(users, name, 'AppData', 'Local');
    for (const name of [env.USER, env.LOGNAME, posix.basename(homePath || '')].filter(Boolean)) {
      if (safe(() => exists(local(name)))) return { path: posix.join(local(name), 'pagemd', 'profiles'), reason: 'wsl-user' };
    }
    const real = (safe(() => (typeof list === 'function' ? list(users) : [])) || [])
      .filter((name) => !NOT_A_USER.test(name) && safe(() => exists(local(name))));
    if (real.length === 1) return { path: posix.join(local(real[0]), 'pagemd', 'profiles'), reason: 'wsl-only-user' };
  }
  return { path: posix.join(env.XDG_DATA_HOME || posix.join(homePath, '.local', 'share'), 'pagemd', 'profiles'), reason: 'xdg' };
}

/** The shared profiles folder (see `sharedProfilesFolderInfo`). */
export function sharedProfilesFolder(options) {
  return sharedProfilesFolderInfo(options).path;
}

/** The reasons in plain words (for `pagemd profiles where` and the editor's log). */
export const SHARED_FOLDER_REASONS = Object.freeze({
  PAGEMD_CONFIG_DIR: 'PAGEMD_CONFIG_DIR is set, so its profiles folder is used',
  windows: 'Windows: %LOCALAPPDATA%\\pagemd\\profiles',
  'wsl-user': 'WSL: the Windows user with your WSL user name',
  'wsl-only-user': 'WSL: the only Windows user on this computer',
  macos: 'macOS: ~/Library/Application Support/pagemd/profiles',
  xdg: 'Linux: ${XDG_DATA_HOME:-~/.local/share}/pagemd/profiles'
});

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}
