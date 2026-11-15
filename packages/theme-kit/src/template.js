/**
 * Filling a profile's HTML template (moved here from pagemd `renderer-web/src/template.js`, pagemd-editor phase P18, so
 * pagemd's PDF and the editor's Print Layout fill tokens with one piece of code). Finding and reading the template file
 * stays with the caller (@pagemd/resolver finds it). Runs anywhere: no file system, no logger of its own.
 *
 * Supported syntax:
 * - {{key}}: the value (nested access with dots: {{metadata.title}})
 * - {{key ?? "default"}}: the default when the value is null or undefined
 * - {{key ? "truthy" : "falsy"}}: a choice by truthiness
 * - {{#if key}}...{{/if}}: a block kept only when the value is truthy (innermost first, so blocks nest)
 * Path tokens ({{PROJECT_ROOT}}, …) are kept as written for the caller's `expand`.
 */

/** Tokens the caller expands as paths (pagemd's expandTokens); never treated as data. */
export const PATH_TOKENS = Object.freeze(['PROJECT_ROOT', 'MARKDOWN_DIR', 'CONFIG_DIR', 'MANIFEST_DIR', 'WORKSPACE_FOLDER']);

/**
 * @typedef {Object} TemplateOptions
 * @property {(text: string) => string} [expand] - expands path tokens in the result (pagemd: expandTokens with its path context)
 * @property {{ debug?: (...args: unknown[]) => void }} [log] - receives the same debug lines pagemd logged
 */

/**
 * Process nested object access for tokens like {{metadata.title}}
 * @param {object} obj - Object to traverse
 * @param {string} path - Dot-notation path
 * @returns {*} Value or undefined
 */
function getNestedValue(obj, path) {
  const parts = path.split('.');
  let value = obj;

  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      return undefined;
    }
  }

  return value;
}

/**
 * Evaluate truthiness of a key in data object
 * Handles both direct and nested key access
 * @param {object} data - Data object to search
 * @param {string} key - Key to evaluate (supports dot notation)
 * @returns {boolean} True if value is truthy, false otherwise
 */
function evaluateTruthiness(data, key) {
  const trimmedKey = key.trim();
  let value;

  if (trimmedKey.includes('.')) {
    value = getNestedValue(data, trimmedKey);
  } else if (trimmedKey in data) {
    value = data[trimmedKey];
  }

  // JavaScript's natural truthiness:
  // false, 0, "", null, undefined → falsy
  // everything else → truthy
  return !!value;
}

/**
 * Process block conditionals {{#if key}}...{{/if}}
 * Must be called before token replacement to handle conditional content
 * @param {string} template - Template string with block conditionals
 * @param {object} data - Data object for condition evaluation
 * @param {TemplateOptions['log']} [log]
 * @returns {string} Template with block conditionals resolved
 */
function processBlockConditionals(template, data, log) {
  // Match innermost {{#if key}}...{{/if}} blocks
  // The content must NOT contain another {{#if to ensure we process innermost first
  // Uses negative lookahead (?!{{#if) to exclude nested opening tags
  const blockPattern = /\{\{#if\s+([^}]+)\}\}((?:(?!\{\{#if|\{\{\/if\}\})[\s\S])*?)\{\{\/if\}\}/g;

  let result = template;
  let previousResult;

  // Loop until no more blocks found (handles all nesting levels)
  // Each iteration processes the innermost blocks, exposing outer blocks for next iteration
  do {
    previousResult = result;
    result = result.replace(blockPattern, (match, key, content) => {
      const isTruthy = evaluateTruthiness(data, key);
      log?.debug?.(`Block conditional: {{#if ${key.trim()}}} = ${isTruthy}`);
      return isTruthy ? content : '';
    });
  } while (result !== previousResult);

  return result;
}

/**
 * Process template tokens with data. Answers the filled text and the tokens that had no value and no default (pagemd
 * warns about those).
 * @param {string} template - Template string with {{tokens}}
 * @param {object} data - Data object for token replacement
 * @param {TemplateOptions} [options]
 * @returns {{ html: string, missing: string[] }}
 */
export function fillTemplate(template, data, options = {}) {
  // Process block conditionals first (before token replacement)
  let rendered = processBlockConditionals(template, data, options.log);

  // Track missing tokens
  const missingTokens = [];

  // Replace {{token}} patterns in the block-processed result
  // Skip block syntax ({{#if, {{/if}}) - these should remain unchanged if unclosed
  rendered = rendered.replace(/\{\{([^}]+)\}\}/g, (match, token) => {
    const trimmed = token.trim();

    // Skip block syntax markers - leave them unchanged
    if (trimmed.startsWith('#') || trimmed.startsWith('/')) {
      return match;
    }

    // Check for ternary syntax: key ? "truthy" : "falsy"
    // Regex captures: key, truthy value, falsy value
    const ternaryMatch = trimmed.match(/^([^?]+)\s*\?\s*["']([^"']*)["']\s*:\s*["']([^"']*)["']$/);
    if (ternaryMatch) {
      const [, ternaryKey, truthyValue, falsyValue] = ternaryMatch;
      const key = ternaryKey.trim();

      // Preserve path tokens
      if (PATH_TOKENS.includes(key)) {
        return match;
      }

      // Get the value
      let value;
      if (key.includes('.')) {
        value = getNestedValue(data, key);
      } else if (key in data) {
        value = data[key];
      }

      // Return truthy or falsy value based on truthiness
      // Treats: undefined, null, false, 0, "" as falsy
      return value ? truthyValue : falsyValue;
    }

    // Parse key and optional default value (key ?? "default")
    let key = trimmed;
    let defaultValue = null;

    if (trimmed.includes('??')) {
      const parts = trimmed.split('??');
      key = parts[0].trim();
      defaultValue = parts.slice(1).join('??').trim();

      // Strip quotes from default value
      if ((defaultValue.startsWith('"') && defaultValue.endsWith('"')) ||
          (defaultValue.startsWith("'") && defaultValue.endsWith("'"))) {
        defaultValue = defaultValue.slice(1, -1);
      }
    }

    // Preserve path tokens for later expansion by expandTokens
    if (PATH_TOKENS.includes(key)) {
      return match; // Keep original {{TOKEN}} format
    }

    let value;

    // Handle nested access (e.g., metadata.title, meta.document_id)
    if (key.includes('.')) {
      value = getNestedValue(data, key);
    } else if (key in data) {
      // Direct access
      value = data[key];
    }

    // Return value if found
    if (value !== undefined && value !== null) {
      return String(value);
    }

    // Fallback to default value if provided
    if (defaultValue !== null) {
      return defaultValue;
    }

    // Only track as missing if no default provided
    missingTokens.push(key);
    return '';
  });

  // Expand path tokens if the caller can
  if (options.expand) {
    rendered = options.expand(rendered);
  }

  return { html: rendered, missing: Array.from(new Set(missingTokens)) };
}

/**
 * The token data pagemd fills a template with: the rendered content, the style block, the document's properties and the
 * profile (pagemd's renderTemplate).
 * @param {{ content?: string, styles?: string, metadata?: object, profile?: object }} context
 */
export function templateData(context) {
  const { content = '', styles = '', metadata = {}, profile = {} } = context;
  return { content, styles, metadata, profile };
}

/**
 * Inject data-color-scheme attribute on the <html> tag (pagemd's renderTemplate, after the tokens).
 * @param {string} html
 * @param {string} [colorScheme]
 * @returns {string}
 */
export function withColorScheme(html, colorScheme) {
  if (!colorScheme) return html;
  return html.replace(/<html(\s+[^>]*)?>/i, (match, attrs) => {
    // If there are existing attributes, append to them
    if (attrs) {
      return `<html${attrs} data-color-scheme="${colorScheme}">`;
    }
    // No existing attributes
    return `<html data-color-scheme="${colorScheme}">`;
  });
}
