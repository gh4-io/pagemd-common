/**
 * One check result (phase C8). The CLI prints them; the editor shows them in VS Code's Problems panel
 * and on the canvas (P14). Both get the same list for the same file.
 *
 * @typedef {'error'|'warning'|'info'} Severity
 *   error: the output can't be made as asked (a missing profile, template, stylesheet or included file)
 *   warning: a likely mistake (fails only with strict); info: a note, never fails
 *
 * @typedef {object} Where
 * @property {string} [file] - the file concerned when it isn't the document (a profile, template, layout, stylesheet)
 * @property {number} [line] - 0-based line in the document (the whole file, frontmatter included)
 * @property {string[]} [searched] - the folders looked in, for a file that wasn't found (R-184)
 *
 * @typedef {object} Diagnostic
 * @property {Severity} severity
 * @property {string} level - one of LEVELS (config.js)
 * @property {string} code - a stable id, e.g. 'missing-required-field'
 * @property {string} message - one line, for people
 * @property {Where} [where]
 */

export const SEVERITIES = Object.freeze(['error', 'warning', 'info']);

/** A Diagnostic; `where` is left out when it has nothing in it. */
export function diagnostic(severity, level, code, message, where) {
  const d = { severity, level, code, message };
  if (where) {
    const clean = Object.fromEntries(Object.entries(where).filter(([, v]) => v !== undefined && v !== null));
    if (Object.keys(clean).length > 0) d.where = clean;
  }
  return d;
}

/** Whether a list passes: no errors, and with `strict` no warnings either. Notes never fail. */
export function passes(diagnostics, strict = false) {
  return !diagnostics.some((d) => d.severity === 'error' || (strict && d.severity === 'warning'));
}

/**
 * Why a lookup failed, in one line (R-184): the resolver's own message is several lines (every folder it searched).
 * @param {Error & { searchedPaths?: string[], duplicates?: string[] }} error
 */
export function lookupReason(error) {
  if (Array.isArray(error?.duplicates) && error.duplicates.length > 0) {
    return `found in more than one place: ${error.duplicates.join(', ')}`;
  }
  if (Array.isArray(error?.searchedPaths)) {
    return `looked in ${error.searchedPaths.length} folder${error.searchedPaths.length === 1 ? '' : 's'}`;
  }
  const first = String(error?.message ?? error).split('\n')[0];
  const resolved = /\(resolved to:? (.+)\)$/.exec(first);
  if (resolved) return `resolved to ${resolved[1]}`;
  if (/^Absolute path not found:/.test(first)) return 'no such file';
  return first;
}
