/**
 * Reading a pack's stylesheets, templates and SVG pictures the way a browser does, so a check cannot be dodged by
 * spelling (security fix after the session-56 review of phase L2/L3). The text patterns this replaces could be passed
 * with `<svg/onload=…>`, `<img src="x"onerror=…>`, entity-escaped `javascript:`, `image-set(…)`, `URL("htt\70s://…")`
 * or `@\69mport`. Here:
 *   - CSS is split into tokens as the CSS Syntax spec does (comments, strings, escapes decoded, `url(…)`), and every
 *     address in it must be a file inside the pack (or a `data:` picture or font, or `#…`);
 *   - HTML (a template) and SVG are read by a strict tokenizer that accepts only well-formed markup: anything a
 *     browser would read differently from it (an attribute glued to the one before it, `<svg/onload>`, a comment with
 *     `--!>`, a bogus comment) is refused rather than guessed. Elements and attributes come from an allowlist; every
 *     address must stay inside the pack; character references are decoded before an address is judged;
 *   - in a template the `{{…}}` placeholders pagemd fills (theme-kit `fillTemplate`) are allowed only in the shapes
 *     and places where whatever they are filled with stays text (see `checkPlaceholder`).
 * Each check returns a problem text (the first one found) or null; the `refs` it collects are the pack files the text
 * names, which `incomplete` (rules.js) then requires. Node built-ins only; nothing here is a sanitiser: a pack that
 * does not pass is refused, never changed.
 */

import path from 'node:path';

// ---------------------------------------------------------------------------------------------------------------
// addresses

/** `data:` addresses a pack may use: pictures and fonts (shown as an image, never as a page). */
const SAFE_DATA = /^data:(image\/(png|jpeg|gif|webp|avif|svg\+xml)|font\/[a-z0-9.+-]+|application\/(font-woff2?|x-font-[a-z0-9]+|vnd\.ms-fontobject))[;,]/i;

/**
 * Judge one address found in a pack file. `from` is the pack path of that file (for relative addresses).
 * @returns {{ problem: string } | { ref: string } | { ok: true }}
 */
export function judgeAddress(raw, from) {
  // browsers drop ASCII tab and newline anywhere in an address and spaces/controls at both ends
  const value = String(raw).replace(/[\t\n\r]/g, '').replace(/^[\0- ]+|[\0- ]+$/g, '');
  if (value === '' || value.startsWith('#')) return { ok: true };
  if (/[\0-\x1f\x7f]/.test(value)) return { problem: `the address "${raw}" holds a control character` };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    if (SAFE_DATA.test(value)) return { ok: true };
    return { problem: `refers to "${short(value)}", an address outside the pack (a pack must be self-contained, and only data: pictures and fonts are allowed)` };
  }
  if (value.startsWith('/') || value.startsWith('\\')) return { problem: `refers to "${short(value)}", an address from the root of the computer (a pack names its own files relative to itself)` };
  if (value.includes('\\')) return { problem: `the address "${short(value)}" holds a backslash` };
  const file = value.split(/[?#]/)[0];
  let decoded;
  try { decoded = decodeURIComponent(file); } catch { return { problem: `the address "${short(value)}" is not a valid address` }; }
  if (decoded.includes('\\') || decoded.includes('\0') || /^[a-z][a-z0-9+.-]*:/i.test(decoded)) return { problem: `the address "${short(value)}" is not a plain file name` };
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), decoded));
  const top = from.split('/')[0];
  if (target.startsWith('../') || target === '..' || (from.includes('/') && !target.startsWith(`${top}/`))) {
    return { problem: `refers to "${short(value)}", which is outside the pack` };
  }
  return { ref: target };
}

const short = (s) => (s.length > 80 ? `${s.slice(0, 77)}…` : s);

// ---------------------------------------------------------------------------------------------------------------
// CSS

/** Functions that fetch something but that `url(…)` checks would not see (they take a plain string), or run code (old IE). */
const BAD_CSS_FUNCTION = /^(-[a-z]+-)?(image-set|image|cross-fade|expression|src)$/;
/** Properties that load code (old IE `behavior`, old Firefox `-moz-binding`). */
const BAD_CSS_PROPERTY = /^(-[a-z]+-)?(behavior|binding)$/;
/** At-rules a pack may not use: @import (a pack holds every stylesheet itself). */
const BAD_AT_RULE = new Set(['import']);

const isHex = (c) => /[0-9a-fA-F]/.test(c);
const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
const isNameStart = (c) => /[A-Za-z_]/.test(c) || c > '\x7f';
const isName = (c) => /[A-Za-z0-9_-]/.test(c) || c > '\x7f';

/**
 * Split CSS into the tokens that matter here: strings, url(…), function names, at-keywords and words, each with
 * escapes decoded (CSS Syntax §4). Comments are skipped exactly as a browser skips them (not inside a string or url).
 * @returns {{ tokens: {type: 'string'|'url'|'function'|'at'|'ident', value: string}[] } | { problem: string }}
 */
export function cssTokens(text) {
  const s = String(text).replace(/\r\n?|\f/g, '\n').replace(/\0/g, '\ufffd');
  const out = [];
  let i = 0;
  // one escape after the backslash at s[i]; returns [char, next index]
  const escape = (at) => {
    let j = at + 1;
    if (j >= s.length) return ['\ufffd', j];
    if (isHex(s[j])) {
      let hex = '';
      while (j < s.length && hex.length < 6 && isHex(s[j])) hex += s[j++];
      if (j < s.length && isWs(s[j])) j++;
      const cp = parseInt(hex, 16);
      return [cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '\ufffd' : String.fromCodePoint(cp), j];
    }
    const cp = s.codePointAt(j);
    return [String.fromCodePoint(cp), j + (cp > 0xffff ? 2 : 1)];
  };
  const validEscape = (at) => s[at] === '\\' && s[at + 1] !== '\n';
  const startsName = (at) => {
    if (isNameStart(s[at] ?? '') || validEscape(at)) return true;
    if (s[at] === '-') return isNameStart(s[at + 1] ?? '') || s[at + 1] === '-' || validEscape(at + 1);
    return false;
  };
  const readName = () => {
    let name = '';
    while (i < s.length) {
      if (isName(s[i])) name += s[i++];
      else if (validEscape(i)) { const [c, j] = escape(i); name += c; i = j; }
      else break;
    }
    return name;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      if (end < 0) return { problem: 'a comment is not closed' };
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let v = '';
      i++;
      for (;;) {
        if (i >= s.length) return { problem: 'a string is not closed' };
        const d = s[i];
        if (d === c) { i++; break; }
        if (d === '\n') return { problem: 'a string runs over a line end' };
        if (d === '\\') {
          if (s[i + 1] === '\n') { i += 2; continue; }
          const [ch, j] = escape(i); v += ch; i = j; continue;
        }
        v += d; i++;
      }
      out.push({ type: 'string', value: v });
      continue;
    }
    if (c === '@' && startsName(i + 1)) {
      i++;
      out.push({ type: 'at', value: readName().toLowerCase() });
      continue;
    }
    if (c === '#' && (isName(s[i + 1] ?? '') || validEscape(i + 1))) { i++; readName(); continue; }
    if (/[0-9]/.test(c) || ((c === '.' || c === '+' || c === '-') && /[0-9]/.test(s[i + 1] ?? ''))) {
      // a number and its unit: one token, never a function name
      i++;
      while (i < s.length && /[0-9.eE]/.test(s[i])) i++;
      if (startsName(i)) readName();
      continue;
    }
    if (startsName(i)) {
      const name = readName();
      if (s[i] === '(') {
        i++;
        const lower = name.toLowerCase();
        if (lower === 'url') {
          let j = i;
          while (j < s.length && isWs(s[j])) j++;
          if (s[j] === '"' || s[j] === "'") { out.push({ type: 'function', value: 'url' }); continue; } // url("…"): the string comes next
          i = j;
          let v = '';
          for (;;) {
            if (i >= s.length) return { problem: 'a url( is not closed' };
            const d = s[i];
            if (d === ')') { i++; break; }
            if (isWs(d)) {
              while (i < s.length && isWs(s[i])) i++;
              if (s[i] === ')') { i++; break; }
              return { problem: 'a url( holds a space' };
            }
            if (d === '"' || d === "'" || d === '(' || /[\0-\x08\x0b\x0e-\x1f\x7f]/.test(d)) return { problem: 'a url( holds a character a browser refuses there' };
            if (d === '\\') {
              if (!validEscape(i)) return { problem: 'a url( holds a bad escape' };
              const [ch, k] = escape(i); v += ch; i = k; continue;
            }
            v += d; i++;
          }
          out.push({ type: 'url', value: v });
          continue;
        }
        out.push({ type: 'function', value: lower });
        continue;
      }
      out.push({ type: 'ident', value: name.toLowerCase() });
      continue;
    }
    if (c === '\\') {
      if (!validEscape(i)) { i++; continue; }
      // an escape that starts a name was handled by startsName; anything else is a lone escaped character
      i = escape(i)[1];
      continue;
    }
    i++;
  }
  return { tokens: out };
}

/**
 * Judge a stylesheet (a .css file, a template's <style> or a style="" attribute). `from` is the pack path of the file
 * it is in; local files it names are added to `refs`.
 * @returns {string|null}
 */
export function badCss(text, from, refs = []) {
  if (/<\/style[\s/>]/i.test(text) || /<\/style$/i.test(text)) return 'holds "</style", which would end the style block it is put in';
  const t = cssTokens(text);
  if ('problem' in t) return `cannot be read safely: ${t.problem}`;
  const toks = t.tokens;
  for (let k = 0; k < toks.length; k++) {
    const { type, value } = toks[k];
    if (type === 'at' && BAD_AT_RULE.has(value)) return `uses @${value} (a pack must hold every stylesheet itself)`;
    if (type === 'function' && BAD_CSS_FUNCTION.test(value)) return `uses ${value}(), which a pack may not use`;
    if (type === 'ident' && BAD_CSS_PROPERTY.test(value)) return `uses "${value}", which loads code`;
    if (type === 'url' || (type === 'string' && toks[k - 1]?.type === 'function' && toks[k - 1].value === 'url')) {
      const j = judgeAddress(value, from);
      if ('problem' in j) return j.problem;
      if ('ref' in j) refs.push(j.ref);
      continue;
    }
    if (type === 'string') {
      const v = value.trim();
      if (v.startsWith('//') || /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || /^(javascript|vbscript)\s*:/i.test(v)) {
        if (!SAFE_DATA.test(v)) return `holds the address "${short(v)}" (a pack must be self-contained)`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// HTML (templates) and SVG

const HTML_ELEMENTS = new Set(('html head body title meta style div span p br hr wbr h1 h2 h3 h4 h5 h6 header footer main section ' +
  'article aside nav figure figcaption img a strong em b i u s small sub sup code pre blockquote q cite abbr time mark ' +
  'address del ins kbd samp var ul ol li dl dt dd table thead tbody tfoot tr th td caption colgroup col details summary ' +
  'svg').split(' '));
const SVG_ELEMENTS = new Set(('svg g defs symbol use path rect circle ellipse line polyline polygon text tspan textPath title ' +
  'desc metadata linearGradient radialGradient stop pattern clipPath mask marker filter switch view style image a ' +
  'feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap ' +
  'feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feMerge feMergeNode feMorphology ' +
  'feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence').split(' ').map((n) => n.toLowerCase()));
/** Elements whose text is not markup in HTML: their end tag is the only thing that ends them. */
const RAW_TEXT = new Set(['style', 'title']);
const VOID = new Set(['meta', 'br', 'hr', 'wbr', 'img', 'col']);
/** Attributes that hold an address (local name, any prefix). */
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster', 'background', 'data', 'codebase', 'cite',
  'longdesc', 'usemap', 'manifest', 'ping', 'lowsrc', 'dynsrc', 'archive', 'classid', 'icon', 'profile']);
/** Attributes a pack may never use, whatever their value. */
const BAD_ATTRS = new Set(['srcset', 'imagesrcset', 'srcdoc', 'http-equiv', 'xml:base', 'formtarget', 'target', 'is']);
/** Namespaces a pack's SVG may declare: SVG itself as the default, xlink, and the inert metadata ones editors write. */
const SVG_NS = 'http://www.w3.org/2000/svg';
const ACTIVE_NS = new Set(['http://www.w3.org/1999/xhtml', 'http://www.w3.org/1998/math/mathml', SVG_NS]);
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** The few character references a pack may use in an attribute (decoded before the value is judged). */
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
function decodeRefs(value) {
  let problem = null;
  const out = value.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);?/g, (m, body) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) { problem = `the character reference "${m}" is not valid`; return ''; }
      return String.fromCodePoint(cp);
    }
    if (m.endsWith(';') && Object.hasOwn(NAMED, body)) return NAMED[body];
    problem = `the character reference "${m}" is not one a pack may use in an attribute (&amp; &lt; &gt; &quot; &apos; &nbsp; or a number)`;
    return '';
  });
  return problem ? { problem } : { value: out };
}

/**
 * The placeholders pagemd fills in a template: `{{content}}` and `{{styles}}` (markup pagemd made), `{{metadata.x}}` /
 * `{{profile.x}}` (text, optionally `?? 'default'` or `? 'a' : 'b'`), `{{#if path}}` … `{{/if}}`. Literals hold only
 * letters, digits, spaces and `_ . , · – — -`, so a placeholder can never write markup, a quote or an address.
 * Path tokens (`{{PROJECT_ROOT}}` …) are refused: a pack does not reach outside itself.
 * @returns {{ kind: 'markup'|'text'|'open'|'close' } | { problem: string }}
 */
export function checkPlaceholder(body) {
  const t = body.trim();
  if (t === 'content' || t === 'styles') return { kind: 'markup' };
  if (t === '/if') return { kind: 'close' };
  const p = '(?:metadata|profile)(?:\\.[A-Za-z0-9_-]+)+';
  if (new RegExp(`^#if\\s+${p}$`).test(t)) return { kind: 'open' };
  const lit = "(?:'[\\p{L}\\p{N} _.,·–—-]*'|\"[\\p{L}\\p{N} _.,·–—-]*\")";
  if (new RegExp(`^${p}(?:\\s*\\?\\?\\s*${lit}|\\s*\\?\\s*${lit}\\s*:\\s*${lit})?$`, 'u').test(t)) return { kind: 'text' };
  return { problem: `the placeholder "{{${short(t)}}}" is not one a pack template may use ({{content}}, {{styles}}, {{metadata.…}}, {{profile.…}} with an optional plain default, {{#if …}} … {{/if}})` };
}

/**
 * Judge an HTML template (`kind` 'html', placeholders allowed) or an SVG picture (`kind` 'svg'). `from` is its pack
 * path; local files it names are added to `refs`.
 * @returns {string|null}
 */
export function badMarkup(text, kind, from, refs = []) {
  const html = kind === 'html';
  const s = String(text);
  if (s.includes('\0')) return 'holds a NUL character';
  let i = 0;
  const open = []; // element stack (lower-case names): to know when we are inside <svg> in a template
  const blocks = []; // {{#if}} stack: the context each was opened in
  let declared = false; // an <?xml …?> or doctype seen (each at most once, before anything else)
  let seenElement = false;
  const prefixes = new Map(); // SVG: prefix → namespace

  /** Placeholders in a stretch of text (`where` = 'text' | 'raw' | 'attr:<n>' | 'url' | 'style'). */
  const placeholders = (chunk, where) => {
    if (!chunk.includes('{{') && !chunk.includes('}}')) return null;
    if (!html) return 'holds "{{" or "}}" (an SVG picture is not a template)';
    const re = /\{\{([^{}]*)\}\}/g;
    const rest = chunk.replace(re, '');
    if (rest.includes('{{') || rest.includes('}}')) return `holds a placeholder pagemd cannot read ("${short(chunk.trim())}")`;
    for (const m of chunk.matchAll(re)) {
      const ph = checkPlaceholder(m[1]);
      if ('problem' in ph) return ph.problem;
      if (ph.kind === 'markup' && where !== 'text') return `{{${m[1].trim()}}} may only stand between elements, not inside a tag, a comment, <style> or <title>`;
      if (where === 'style' || where === 'comment') return `a placeholder may not be used inside ${where === 'style' ? 'a style' : 'a comment'}`;
      if (where === 'url' && (ph.kind !== 'text' || chunk.trim() !== m[0])) return 'an address attribute may hold one placeholder and nothing else';
      if (where === 'raw' && ph.kind !== 'text') return 'a {{#if}} block may not start or end inside <title>';
      if (ph.kind === 'open') blocks.push(where);
      if (ph.kind === 'close') {
        if (blocks.length === 0) return 'holds {{/if}} without its {{#if …}}';
        if (blocks.pop() !== where) return 'a {{#if}} block starts and ends in different places (both must be in the same text or the same attribute)';
      }
    }
    return null;
  };

  const textUntil = (end) => {
    const chunk = s.slice(i, end);
    i = end;
    return placeholders(chunk, 'text');
  };

  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { const p = textUntil(s.length); if (p) return p; break; }
    { const p = textUntil(lt); if (p) return p; }
    const next = s[i + 1] ?? '';
    // comments
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      if (end < 0) return 'a comment is not closed';
      const body = s.slice(i + 4, end);
      if (body.startsWith('>') || body.startsWith('->') || body.includes('--!>') || body.endsWith('-')) return 'a comment a browser would end early (<!-->, <!--->, --!> or --->)';
      { const p = placeholders(body, 'comment'); if (p) return p; }
      i = end + 3;
      continue;
    }
    if (/^<!doctype[\s>]/i.test(s.slice(i, i + 10))) {
      const m = /^<!doctype\s+[a-z]+(\s+public\s+"[^"<>[\]]*"(\s+"[^"<>[\]]*")?)?\s*>/i.exec(s.slice(i));
      if (!m || declared || seenElement) return 'a doctype a pack may not use (only <!DOCTYPE name>, with an optional public id, once, at the top)';
      declared = true;
      i += m[0].length;
      continue;
    }
    if (s.startsWith('<![CDATA[', i)) {
      if (html || !open.includes('style')) return 'a CDATA section outside an SVG <style>';
      const end = s.indexOf(']]>', i + 9);
      if (end < 0) return 'a CDATA section is not closed';
      const p = badCss(s.slice(i + 9, end), from, refs);
      if (p) return `its <style> ${p}`;
      i = end + 3;
      continue;
    }
    if (s.startsWith('<?', i)) {
      const m = /^<\?xml\s[^<>?]*\?>/.exec(s.slice(i));
      if (html || !m || declared || seenElement || /stylesheet/i.test(m[0])) return 'a processing instruction a pack may not use (only the <?xml …?> declaration of an SVG, once, at the top)';
      declared = true;
      i += m[0].length;
      continue;
    }
    if (next === '!') return 'a "<!" that is not a comment or doctype (a browser reads it as a hidden comment)';
    // end tag
    if (next === '/') {
      const m = /^<\/([A-Za-z][A-Za-z0-9:-]*)\s*>/.exec(s.slice(i));
      if (!m) return 'an end tag a browser would read differently (only </name>)';
      const name = html ? m[1].toLowerCase() : m[1];
      const key = name.toLowerCase();
      const at = open.lastIndexOf(key);
      if (at < 0) return `the end tag </${name}> has no start tag`;
      open.length = at;
      i += m[0].length;
      continue;
    }
    if (!/[A-Za-z]/.test(next)) {
      // a lone "<" in text: fine in a browser, but a {{…}} or a removed {{#if}} block next to it could make a tag
      if (html && !/[\s0-9=]/.test(next)) return 'a "<" that is not followed by a space, digit or "=" outside a tag';
      if (!html) return 'a "<" in text (an SVG picture must be well-formed XML)';
      i++;
      continue;
    }
    // start tag
    const m = /^<([A-Za-z][A-Za-z0-9:-]*)/.exec(s.slice(i));
    const rawName = m[1];
    const name = rawName.toLowerCase();
    i += m[0].length;
    const inSvg = !html || open.includes('svg') || name === 'svg';
    if (rawName.includes(':')) {
      if (html) return `the element <${rawName}> is not one a pack template may use`;
      const prefix = rawName.split(':')[0];
      if (!prefixes.has(prefix)) return `the element <${rawName}> uses a prefix it did not declare`;
    } else if (!(inSvg ? SVG_ELEMENTS.has(name) || (html && name === 'svg') : HTML_ELEMENTS.has(name))) {
      return `the element <${rawName}> is not one a pack may use`;
    }
    seenElement = true;
    // attributes
    const seenAttr = new Set();
    let selfClosing = false;
    for (;;) {
      const ws = /^[ \t\n\r\f]*/.exec(s.slice(i))[0];
      i += ws.length;
      if (s[i] === '>') { i++; break; }
      if (s.startsWith('/>', i)) { selfClosing = true; i += 2; break; }
      if (i >= s.length) return `the tag <${rawName}> is not closed`;
      if (!ws) return `the tag <${rawName}> has an attribute glued to what comes before it (a browser would read it differently)`;
      const a = /^([A-Za-z_][A-Za-z0-9_.:-]*)/.exec(s.slice(i));
      if (!a) return `the tag <${rawName}> holds "${short(s.slice(i, i + 12))}", which is not an attribute`;
      const attr = a[1];
      const lower = attr.toLowerCase();
      i += attr.length;
      let value = null;
      let quote = null;
      const eq = /^[ \t\n\r\f]*=[ \t\n\r\f]*/.exec(s.slice(i));
      if (eq) {
        i += eq[0].length;
        if (s[i] === '"' || s[i] === "'") {
          quote = s[i];
          const end = s.indexOf(quote, i + 1);
          if (end < 0) return `the value of ${attr} is not closed`;
          value = s.slice(i + 1, end);
          i = end + 1;
        } else {
          const u = /^[A-Za-z0-9_.:#%-]+/.exec(s.slice(i));
          if (!u) return `the value of ${attr} is not quoted and holds characters that need quotes`;
          value = u[0];
          i += value.length;
        }
      }
      if (seenAttr.has(lower)) return `the attribute ${attr} appears twice on <${rawName}>`;
      seenAttr.add(lower);
      const local = lower.includes(':') ? lower.split(':').pop() : lower;
      if (/^on/.test(local)) return `the tag <${rawName}> has an event attribute (${attr})`;
      if (BAD_ATTRS.has(lower) || BAD_ATTRS.has(local)) return `the attribute ${attr} is not one a pack may use`;
      // namespaces (SVG)
      if (lower === 'xmlns' || lower.startsWith('xmlns:')) {
        const ns = (value ?? '').trim();
        if (lower === 'xmlns') {
          if (ns !== SVG_NS && !(html && ns === 'http://www.w3.org/1999/xhtml' && name === 'html')) return `the namespace "${short(ns)}" is not one a pack may use as the default`;
        } else if (ns === XLINK_NS) {
          prefixes.set(lower.slice(6), ns);
        } else if (ACTIVE_NS.has(ns) || !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(ns)) {
          return `the namespace "${short(ns)}" is not one a pack may declare`;
        } else {
          prefixes.set(lower.slice(6), ns);
        }
        continue;
      }
      if (attr.includes(':') && !html && !prefixes.has(attr.split(':')[0]) && !lower.startsWith('xml:')) return `the attribute ${attr} uses a prefix it did not declare`;
      if (value === null) continue;
      const isUrl = URL_ATTRS.has(local);
      const isStyle = lower === 'style';
      if (value.includes('{{') || value.includes('}}')) {
        if (!html) return 'holds "{{" (an SVG picture is not a template)';
        if (quote !== '"') return `the placeholder in ${attr} must be inside double quotes`;
        const p = placeholders(value, isUrl ? 'url' : isStyle ? 'style' : `attr:${i}`);
        if (p) return p;
        if (isUrl) continue; // the whole value is one {{metadata.…}}: the document's own text (or the pack's, checked as text)
      }
      const d = decodeRefs(value);
      if ('problem' in d) return `${attr}: ${d.problem}`;
      if (isUrl) {
        const j = judgeAddress(d.value, from);
        if ('problem' in j) return `${attr} ${j.problem}`;
        if ('ref' in j) refs.push(j.ref);
        continue;
      }
      if (isStyle || /url\s*\(|image-set|expression\s*\(/i.test(d.value) || d.value.includes('\\')) {
        const p = badCss(d.value, from, refs);
        if (p) return `the ${attr} attribute ${p}`;
      }
      if (/^\s*(javascript|vbscript)\s*:/i.test(d.value.replace(/[\t\n\r]/g, ''))) return `the attribute ${attr} holds a script address`;
    }
    if (selfClosing && html && !VOID.has(name) && !inSvg) return `<${rawName}/> is not an empty element (a browser would not close it)`;
    if (selfClosing || (html && !inSvg && VOID.has(name))) continue;
    // raw text (HTML <style>, <title>): ends only at its own end tag
    if (html && !inSvg && RAW_TEXT.has(name)) {
      const re = new RegExp(`</${name}[\\s/>]`, 'i');
      const rest = s.slice(i);
      const m2 = re.exec(rest);
      if (!m2) return `<${name}> is not closed`;
      const body = rest.slice(0, m2.index);
      if (/<[A-Za-z/!?]/.test(body)) return `<${name}> holds markup ("<" followed by a letter, / ! or ?)`;
      if (name === 'style') {
        { const p = placeholders(body, 'style'); if (p) return p; }
        if (body.includes('&')) return '<style> holds "&" (in an SVG inside a template it would be read as a character reference)';
        const p = badCss(body, from, refs);
        if (p) return `its <style> ${p}`;
      } else {
        const p = placeholders(body, 'raw');
        if (p) return p;
      }
      const close = /^<\/[A-Za-z]+\s*>/.exec(rest.slice(m2.index));
      if (!close) return `the end tag of <${name}> is not plain`;
      i += m2.index + close[0].length;
      continue;
    }
    // SVG <style>: its text is CSS (XML: markup inside it would be elements, refused)
    if (inSvg && name === 'style') {
      const rest = s.slice(i);
      const end = /<\/style\s*>/i.exec(rest);
      if (!end) return '<style> is not closed';
      let body = rest.slice(0, end.index);
      const cdata = /^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/.exec(body);
      if (cdata) body = cdata[1];
      else if (body.includes('<')) return '<style> in an SVG holds markup';
      if (body.includes('&') || body.includes('{{')) return '<style> in an SVG holds "&" or "{{"';
      const p = badCss(body, from, refs);
      if (p) return `its <style> ${p}`;
      i += end.index + end[0].length;
      continue;
    }
    open.push(name);
  }
  if (blocks.length) return 'a {{#if …}} block is not closed';
  return null;
}
