/**
 * markdown-it plugin for Obsidian-style wiki links
 * Handles [[Page Name]] and [[Page Name|Display]] links
 * Handles ![[image.png]] embedded images
 */

import { writeWikilink } from './wikilinks-write.js';

/**
 * Convert text to URL-safe slug (GitHub-compatible)
 *
 * Produces heading IDs compatible with common markdown manual TOC patterns:
 * - Converts to lowercase
 * - Normalizes common separator patterns:
 *   - ` & ` (space-ampersand-space) → `--` (double hyphen, signals conjunction)
 *   - Other punctuation with adjacent spaces → single hyphen
 * - Replaces remaining non-alphanumeric with hyphens
 * - Trims leading/trailing hyphens
 * - Prefixes with 'section-' if result starts with digit (CSS selector compliance)
 *
 * The double-hyphen for ` & ` matches user expectations for manual TOC links
 * like `[System Access & Passwords](#system-access--passwords)`.
 *
 * CSS selectors cannot start with a digit (e.g., `#1-intro` is invalid).
 * Paged.js uses querySelector internally, so IDs must be CSS-compliant.
 *
 * @param {string} text - Text to slugify
 * @returns {string} URL-safe slug
 *
 * @example
 * slugify("Hello World")               // "hello-world"
 * slugify("System Access & Passwords") // "system-access--passwords"
 * slugify("1. Welcome & Onboarding")   // "section-1-welcome--onboarding"
 * slugify("What's New?")               // "whats-new"
 */
export function slugify(text) {
  if (!text) return '';
  let slug = text
    .toLowerCase()
    .normalize('NFD')                    // Decompose accented chars
    .replace(/[\u0300-\u036f]/g, '')     // Remove diacritics
    .replace(/\s+&\s+/g, '--')           // ` & ` → `--` (preserve ampersand as double hyphen)
    .replace(/[^a-z0-9-]+/g, '-')        // Replace runs of non-alphanumeric with single hyphen
    .replace(/^-+|-+$/g, '');            // Trim hyphens from start/end

  // CSS selectors can't start with a digit - prefix if needed
  if (/^[0-9]/.test(slug)) {
    slug = 'section-' + slug;
  }

  return slug;
}

/**
 * Check if URL is external (has protocol)
 * @param {string} url - URL to check
 * @returns {boolean} True if external
 */
function isExternalUrl(url) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
}

/** Default wikilink options (shared with the ![[embed]] item) */
const DEFAULT_OPTIONS = {
  baseUrl: '',
  imageBaseUrl: '',
  linkClass: 'wikilink',
  imageClass: 'embedded-image',
  generateSlugs: false
};

/**
 * Merge caller options over the defaults
 * @param {object} [options] - baseUrl, imageBaseUrl, linkClass, imageClass, generateSlugs
 * @returns {object} Effective options
 */
export function wikilinkOptions(options = {}) {
  return { ...DEFAULT_OPTIONS, ...options };
}

const LINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/;

/**
 * Register the [[Page]] / [[Page|Display]] inline rule
 * @param {MarkdownIt} md - markdown-it instance
 * @param {object} options - Wikilink options (see wikilinkOptions)
 */
export function wikilinkLinkPlugin(md, options = {}) {
  const opts = wikilinkOptions(options);

  /**
   * Parse wiki-link [[...]]
   */
  function parseWikilink(state, silent) {
    const start = state.pos;

    // Must start with [[
    if (state.src.charCodeAt(start) !== 0x5B /* [ */ ||
        state.src.charCodeAt(start + 1) !== 0x5B /* [ */) {
      return false;
    }

    const match = state.src.slice(start).match(LINK_PATTERN);
    if (!match) return false;

    if (!silent) {
      const target = match[1].trim();
      const display = match[2] ? match[2].trim() : target;

      // Build href based on target type
      let href;

      if (isExternalUrl(target)) {
        // External URL - use as-is (don't prepend baseUrl)
        href = target;
      } else if (opts.generateSlugs) {
        // Generate slug with .html extension
        // Handle fragments: [[Page#Section]] → page.html#section
        const [page, fragment] = target.split('#');
        const slug = slugify(page);
        href = fragment ? `${slug}.html#${fragment.toLowerCase()}` : `${slug}.html`;
      } else {
        // Standard wikilink handling
        href = opts.baseUrl ? `${opts.baseUrl}/${target}` : target;
      }

      // Create link token
      const token_o = state.push('link_open', 'a', 1);
      token_o.attrs = [
        ['href', href],
        ['class', opts.linkClass]
      ];
      // Marked as a wikilink, with what the author wrote (C2); display is null without "|"
      token_o.meta = { wikilink: true, target, display: match[2] ? display : null };

      // Create text token
      const token_t = state.push('text', '', 0);
      token_t.content = display;

      // Close link
      state.push('link_close', 'a', -1);
    }

    state.pos = start + match[0].length;
    return true;
  }

  md.inline.ruler.before('link', 'wikilink', parseWikilink);
}

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'wikilinks',
  group: 'text',
  read(md, mode, options = {}) {
    wikilinkLinkPlugin(md, options.wikilinks);
  },
  write: writeWikilink,
  htmlContract: ['<a href="{target}" class="wikilink">{display}</a>'],
  params: [
    { key: 'target', type: 'string', help: 'Page name, Page#Section, or an external URL' },
    { key: 'display', type: 'string', help: 'Text after | (defaults to the target)' }
  ]
};
