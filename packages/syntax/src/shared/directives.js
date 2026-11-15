/**
 * Shared runner for HTML comment directives: <!-- ::KEYWORD(paren) params -->
 *
 * Every directive item (PAGEBREAK, TOC, SECTION, LAYOUT, COVER, INCLUDE,
 * INDEX) registers a handler here. The runner installs ONE core rule
 * (`pagemd_directives`) the first time a handler is registered, so all
 * directives are transformed in a single pass after inline parsing, exactly
 * as pagemd's original directives plugin did.
 *
 * Editor mode (phase C2): nothing is rewritten to HTML. A whole-directive
 * `html_block` becomes a `pagemd_directive` token and an `html_inline` one a
 * `pagemd_directive_inline` token. Both keep the author's text in `content`
 * and carry `meta = { name, item, known, parenParams, params, attrs }`:
 * `params` is the parameter text as written, `attrs` the same parsed, and
 * `item` the id of the item that owns the keyword (null when unknown, e.g.
 * BREAK: unknown directives are kept exactly as written). Comments that only
 * embed a directive (e.g. an INDEX marker followed by text) stay plain HTML.
 */

import { isEditor } from './mode.js';
import { writeParams, directiveValue, parenValue } from './write.js';

/** One written parameter: key="v", key='v', key=v or a bare flag */
const PARAM_SEGMENT = /(\w+)(?:=["'][^"']+["']|=\S+)?/;

/** The whole-directive pattern (keyword, optional (paren), parameters) */
const DIRECTIVE_RE = /^<!--\s*::([A-Z_]+)(?:\(([^)]*)\))?\s*(.*?)\s*-->$/;

/** @type {WeakMap<object, {handlers: Map<string, {handler: Function, item: string|null, accepts: Function|null}[]>, fallbacks: Function[], state: object}>} */
const runners = new WeakMap();

/**
 * Parse attribute string into key-value object
 * Handles: key="value" key='value' key=value (flag)
 * @param {string} attrString - The attribute string to parse
 * @returns {Object} Parsed attributes
 */
export function parseDirectiveAttributes(attrString) {
  const attrs = {};
  if (!attrString) return attrs;

  // Match key="value", key='value', or key=value, or standalone (flag)
  const attrRegex = /(\w+)(?:=["']([^"']+)["']|=(\S+))?/g;
  let match;

  while ((match = attrRegex.exec(attrString)) !== null) {
    const key = match[1];
    const value = match[2] || match[3] || true; // true for flags without value
    attrs[key] = value;
  }

  return attrs;
}

/**
 * Get (and on first use install) the directive runner for a markdown-it instance
 * @param {MarkdownIt} md - markdown-it instance
 * @returns {{handlers: Map<string, Function[]>, fallbacks: Function[], state: object}} Runner
 */
function ensureRunner(md) {
  let runner = runners.get(md);
  if (runner) return runner;

  runner = { handlers: new Map(), fallbacks: [], state: {} };
  runners.set(md, runner);

  // Reset per-document state (section nesting, open LAYOUT) on each render
  const originalRender = md.render.bind(md);
  md.render = function (...args) {
    runner.state = {};
    return originalRender(...args);
  };

  /**
   * Try to match and process a directive from token content
   * @param {Object} token - Token to process
   * @returns {boolean} True if directive was found and processed
   */
  function tryProcessDirective(token) {
    const content = token.content.trim();
    // Match directive pattern: <!-- ::KEYWORD params -->
    // This regex requires the directive to be the ENTIRE content
    const directiveMatch = content.match(DIRECTIVE_RE);
    if (!directiveMatch) return false;

    const command = directiveMatch[1];
    const ctx = {
      md,
      state: runner.state,
      parenParams: directiveMatch[2],
      attrs: parseDirectiveAttributes(directiveMatch[3])
    };
    if (isEditor(md)) {
      markDirective(token, command, directiveMatch, ctx);
      return true;
    }
    for (const { handler } of runner.handlers.get(command) || []) {
      if (handler(token, ctx)) return true;
    }
    token.content = `<!-- Unknown directive: ${command} -->\n`;
    return true;
  }

  /**
   * Editor mode: keep the directive as written, as its own token type
   * @param {Object} token - html_block or html_inline token
   * @param {string} command - Keyword
   * @param {string[]} match - DIRECTIVE_RE match
   * @param {Object} ctx - parenParams and parsed attrs
   */
  function markDirective(token, command, match, ctx) {
    const owner = (runner.handlers.get(command) || []).find((h) => !h.accepts || h.accepts(ctx));
    token.type = token.type === 'html_inline' ? 'pagemd_directive_inline' : 'pagemd_directive';
    token.meta = {
      ...token.meta,
      name: command,
      item: owner ? owner.item : null,
      known: !!owner,
      parenParams: match[2] === undefined ? null : match[2],
      params: match[3],
      attrs: ctx.attrs
    };
  }

  /**
   * Content that is not a whole directive (e.g. "<!-- ::INDEX term="x" -->Text after")
   * @param {Object} token - Token to process
   */
  function runFallbacks(token) {
    for (const fallback of runner.fallbacks) {
      if (fallback(token, md)) return;
    }
  }

  // Core rule to process directive comments
  // Use ruler.push() to run AFTER inline parsing (when children are populated)
  md.core.ruler.push('pagemd_directives', (state) => {
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      // Process block-level HTML tokens
      if (token.type === 'html_block') {
        if (!tryProcessDirective(token) && !isEditor(md)) {
          runFallbacks(token);
        }
      }

      // Process inline tokens (paragraphs, headings, etc.) for inline directives
      if (token.children && token.children.length > 0) {
        for (const child of token.children) {
          if (child.type === 'html_inline') {
            if (!tryProcessDirective(child) && !isEditor(md)) {
              runFallbacks(child);
            }
          }
        }
      }
    }

    return true;
  });

  // Editor-mode directive tokens render as the comment they are (registered
  // only in editor mode, so render mode's renderer list is unchanged)
  if (isEditor(md)) {
    const asWritten = (tokens, idx) => tokens[idx].content;
    md.renderer.rules.pagemd_directive = asWritten;
    md.renderer.rules.pagemd_directive_inline = asWritten;
  }

  return runner;
}

/**
 * Register a directive handler.
 * A handler returns true when it transformed the token; if no handler for the
 * keyword does, the token becomes "<!-- Unknown directive: KEYWORD -->".
 * @param {MarkdownIt} md - markdown-it instance
 * @param {string} command - Directive keyword, e.g. 'PAGEBREAK'
 * @param {(token: object, ctx: {md: object, state: object, parenParams: string|undefined, attrs: object}) => boolean} handler
 * @param {object} [owner] - Who owns the keyword, for editor mode
 * @param {string} [owner.item] - The item's id
 * @param {(ctx: {parenParams: string|undefined, attrs: object}) => boolean} [owner.accepts] - When two items share
 *   a keyword (INDEX), which directives this one owns; the render-mode handler must agree
 */
export function registerDirective(md, command, handler, owner = {}) {
  const runner = ensureRunner(md);
  if (!runner.handlers.has(command)) runner.handlers.set(command, []);
  runner.handlers.get(command).push({ handler, item: owner.item || null, accepts: owner.accepts || null });
}

/**
 * Write a directive back to markdown (phase C3). Parameters whose value did not
 * change keep the author's text and order; new ones follow `order`.
 * @param {object} data - What a pagemd_directive token carries in `meta`
 * @param {string} data.name - Keyword, e.g. 'TOC'
 * @param {string|null} [data.parenParams] - Text in parentheses, e.g. LAYOUT(wide)
 * @param {string} [data.params] - The parameters as written
 * @param {Object<string, *>} [data.attrs] - The parameters to write (true = a bare flag)
 * @param {string[]} [order] - Canonical order for new parameters
 * @returns {string} e.g. '<!-- ::TOC levels="3" -->'
 */
export function writeDirective(data, order = []) {
  const name = String(data.name || '').toUpperCase().replace(/[^A-Z_]/g, '');
  const paren = data.parenParams === null || data.parenParams === undefined ? '' : `(${parenValue(data.parenParams)})`;
  const params = writeParams({
    attrs: data.attrs || {},
    raw: data.params || '',
    parse: parseDirectiveAttributes,
    segment: PARAM_SEGMENT,
    quote: directiveValue,
    order,
    flags: true
  });
  return `<!-- ::${name}${paren}${params ? ` ${params}` : ''} -->`;
}

/**
 * The write rule shared by the directive items
 * @param {string[]} order - The item's parameter keys, in canonical order
 * @returns {(data: object) => string}
 */
export function directiveWriter(order) {
  return (data) => writeDirective(data, order);
}

/**
 * Register a fallback for HTML content that is not a whole directive
 * @param {MarkdownIt} md - markdown-it instance
 * @param {(token: object, md: object) => boolean} fallback - Returns true when it changed the token
 */
export function registerDirectiveFallback(md, fallback) {
  ensureRunner(md).fallbacks.push(fallback);
}
