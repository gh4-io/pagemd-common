/**
 * What a pack's profile (`<id>.json`) may set (security fix after the session-56 review of phase L2/L3). pagemd's
 * profile has settings that name files anywhere (`layout.source`, `layout.css`, `styles.profile`), write files
 * anywhere (`outputs.directory`, `outputs.<format>.outputDir`/`filename`/`options`, `debugArtifacts`), run code
 * (`pagedjs.handlers`, `pagedjs.browser_options`) or pull in another file by path (`extends`). A pack is somebody
 * else's file, so its profile is read against an allowlist: the settings below, and nothing else. Every string in it
 * must also be plain text, because pagemd's template fills `{{metadata.…}}` and `{{profile.…}}` without escaping.
 */

/** Plain text: no markup, no quote that could end an attribute, no address. */
export function badText(value) {
  if (/[<>"`\0]/.test(value)) return 'holds < > " ` or NUL (pagemd puts profile text into the page as it is)';
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(value) || /(^|[\s('=])\/\//.test(value)) return 'holds a web address (a pack must be self-contained)';
  if (/(^|[^a-z])(javascript|vbscript|data|file)\s*:/i.test(value)) return 'holds a script, data or file address';
  return null;
}

const OUTPUT_FORMATS = new Set(['pdf', 'html', 'png', 'jpeg']);
const OUTPUT_MODES = new Set(['ACTIVE_ONLY', 'ALWAYS', 'DISABLED']);
const COLOR_SCHEMES = new Set(['light', 'dark', 'auto']);
const ANNOTATED_KEYS = new Set(['markerColor', 'markerBorder', 'markerSize', 'fontSize', 'legendColumns', 'legendBackground']);
const VALIDATION_LEVELS = new Set(['strict', 'required_fields', 'meta', 'profile', 'template', 'layout', 'styles', 'syntax', 'assets']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Every string anywhere in `value` must be plain text; `where` names the setting for the message. */
function plain(value, where, depth = 0) {
  if (depth > 8) return `${where} is nested too deeply`;
  if (typeof value === 'string') { const p = badText(value); return p ? `${where} ${p}` : null; }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return null;
  if (Array.isArray(value)) {
    for (let k = 0; k < value.length; k++) { const p = plain(value[k], `${where}[${k}]`, depth + 1); if (p) return p; }
    return null;
  }
  if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      const p = badText(k) ?? (k === '__proto__' || k === 'constructor' || k === 'prototype' ? 'is not a usable name' : null);
      if (p) return `${where} has the key "${k}", which ${p}`;
      const q = plain(v, `${where}.${k}`, depth + 1);
      if (q) return q;
    }
    return null;
  }
  return `${where} holds a value JSON cannot hold`;
}

/** A path the profile names: inside `./<id>/`, clean, and a file of the pack (checked later by `incomplete`). */
function badPath(id, value, where) {
  if (typeof value !== 'string') return `${where} is not a path`;
  if (!value.startsWith(`./${id}/`)) return `${where} names "${value}", which is not inside ./${id}/`;
  const rest = value.slice(2);
  if (rest.split('/').some((p) => p === '' || p === '.' || p === '..') || /[\\\0:{}$]/.test(rest)) return `${where} names "${value}", which is not a plain path inside the pack`;
  return null;
}

/**
 * Judge a pack's profile. A problem text, or null. `files` (the pack's paths) is used for nothing here: that every
 * named file exists is `incomplete`'s check.
 * @param {string} id
 * @param {unknown} p - the parsed `<id>.json`
 */
export function badProfile(id, p) {
  if (!isObject(p)) return `${id}.json is not an object`;
  for (const key of Object.keys(p)) {
    const v = p[key];
    switch (key) {
      case 'id':
        if (v !== id) return `${id}.json says its id is "${v}"`;
        break;
      case 'description':
        if (typeof v !== 'string') return `${id}.json: description is not text`;
        break;
      case 'extends':
        // a profile by name (pagemd's own standard_letter, …): never a path
        if (typeof v !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(v)) return `${id}.json: extends must be a profile name (letters, digits, - and _), not "${v}"`;
        if (v === id) return `${id}.json extends itself`;
        break;
      case 'resources': {
        if (!isObject(v)) return `${id}.json: resources is not an object`;
        for (const [rk, rv] of Object.entries(v)) {
          if (rk === 'template' || rk === 'layout') {
            const bad = badPath(id, rv, `resources.${rk}`);
            if (bad) return `${id}.json: ${bad}`;
          } else if (rk === 'css' || rk === 'fonts' || rk === 'assets') {
            if (!Array.isArray(rv)) return `${id}.json: resources.${rk} is not a list`;
            for (let k = 0; k < rv.length; k++) { const bad = badPath(id, rv[k], `resources.${rk}[${k}]`); if (bad) return `${id}.json: ${bad}`; }
          } else {
            return `${id}.json sets resources.${rk}, which a pack may not set`;
          }
        }
        break;
      }
      case 'outputs': {
        if (!isObject(v)) return `${id}.json: outputs is not an object`;
        for (const [fk, fv] of Object.entries(v)) {
          // where and how outputs are written belongs to the user, not to a pack (outputs.directory, outputDir, filename, options)
          if (!OUTPUT_FORMATS.has(fk)) return `${id}.json sets outputs.${fk}, which a pack may not set (where outputs go is the user's choice)`;
          if (!isObject(fv)) return `${id}.json: outputs.${fk} is not an object`;
          for (const [ok, ov] of Object.entries(fv)) {
            if (ok === 'enabled') { if (typeof ov !== 'boolean') return `${id}.json: outputs.${fk}.enabled is not true or false`; }
            else if (ok === 'mode') { if (!OUTPUT_MODES.has(ov)) return `${id}.json: outputs.${fk}.mode is not ACTIVE_ONLY, ALWAYS or DISABLED`; }
            else return `${id}.json sets outputs.${fk}.${ok}, which a pack may not set`;
          }
        }
        break;
      }
      case 'validation': {
        if (typeof v === 'boolean') break;
        if (!isObject(v)) return `${id}.json: validation is not true, false or an object`;
        for (const lk of Object.keys(v)) if (!VALIDATION_LEVELS.has(lk)) return `${id}.json sets validation.${lk}, which pagemd does not have`;
        const bad = plain(v, 'validation');
        if (bad) return `${id}.json: ${bad}`;
        break;
      }
      case 'metadata': {
        if (!isObject(v)) return `${id}.json: metadata is not an object`;
        for (const mk of Object.keys(v)) if (mk !== 'defaults') return `${id}.json sets metadata.${mk}, which a pack may not set`;
        if (v.defaults !== undefined && !isObject(v.defaults)) return `${id}.json: metadata.defaults is not an object`;
        const bad = plain(v.defaults ?? {}, 'metadata.defaults');
        if (bad) return `${id}.json: ${bad}`;
        break;
      }
      case 'rendering': {
        if (!isObject(v)) return `${id}.json: rendering is not an object`;
        for (const [rk, rv] of Object.entries(v)) {
          if (rk !== 'colorScheme' || !COLOR_SCHEMES.has(rv)) return `${id}.json sets rendering.${rk}${rk === 'colorScheme' ? ` to "${rv}"` : ''}, which a pack may not set`;
        }
        break;
      }
      case 'annotatedImage': {
        if (!isObject(v)) return `${id}.json: annotatedImage is not an object`;
        for (const [ak, av] of Object.entries(v)) {
          if (!ANNOTATED_KEYS.has(ak)) return `${id}.json sets annotatedImage.${ak}, which pagemd does not have`;
          if (ak === 'legendColumns') { if (!Number.isInteger(av) || av < 1 || av > 12) return `${id}.json: annotatedImage.legendColumns is not a whole number from 1 to 12`; continue; }
          // a CSS colour or length: put into the page's CSS, so nothing that could end a declaration or fetch a file
          if (typeof av !== 'string' || !/^[#A-Za-z0-9 .,%()+-]*$/.test(av) || /url|image|expression|attr/i.test(av)) return `${id}.json: annotatedImage.${ak} is not a plain CSS colour or length`;
        }
        break;
      }
      default:
        // layout (old template/CSS paths), styles, pagedjs (handler scripts, browser options), debugArtifacts, …
        return `${id}.json sets "${key}", which a pack may not set`;
    }
  }
  const bad = plain(p, `${id}.json`);
  return bad;
}
