/**
 * The style block: stylesheets in layer order turned into the CSS pagemd puts in its HTML (from
 * pagemd `renderer-web/src/styles.js`, phase C5). Reading the files stays with the caller; this
 * only arranges text, so it runs anywhere.
 *
 * Three forms (pagemd's `extractCSS` option):
 * - inline (default): `<style>` tags, one per layer, after `@layer base, primary, layout, syntax, profile;` (with `, structural`
 *   when the document has that layer: task lists, FIX-ADT) (frontmatter left undeclared, so it wins). `useCSSLayers: false` drops the @layer wrappers
 *   (Paged.js 0.4.3 has bugs with cascade layers).
 * - extract (`true`): one CSS text with every layer; the frontmatter CSS stays apart (inlined per page).
 * - split (`'split'`): shared layers (base, primary, syntax) and profile layers (layout, profile)
 *   apart, for bundles with several profiles.
 */

import { SHARED_LAYERS, PROFILE_LAYERS } from './layers.js';

const SILENT = { trace() {}, info() {} };

/** The declared layer order: the same text as before unless a `structural` sheet is present (documents without task lists are unchanged) */
export function layerOrderStatement(aggregated) {
  const late = aggregated.some((s) => s.layer === 'structural');
  return `@layer base, primary, layout, syntax, profile${late ? ', structural' : ''};`;
}

/**
 * @typedef {{ layer: string, content: string, source?: string, resolvedPath?: string, size?: number }} LayerSheet
 */

/**
 * Arrange stylesheets (already in layer order) into pagemd's style block.
 * @param {LayerSheet[]} aggregated - base, primary, layout?, syntax?, profile… (pagemd's aggregateStyles)
 * @param {object} [options]
 * @param {boolean} [options.minify=false]
 * @param {string} [options.frontmatterCSS] - the frontmatter layer's CSS
 * @param {boolean} [options.returnMetadata=false] - also return the files' metadata
 * @param {boolean|'split'} [options.extractCSS=false]
 * @param {boolean} [options.useCSSLayers=true]
 * @param {string} [options.profileId] - names the split output (`styles-<id>.css`)
 * @param {object} [options.log] - a logger (trace/info)
 * @returns {string|object} as pagemd's buildStyleBlock()
 */
export function formatStyleBlock(aggregated, options = {}) {
  const useCSSLayers = options.useCSSLayers !== false; // Default true
  const logger = options.log || SILENT;
  const profileId = options.profileId;

  logger.trace('styles', 'in-progress', 'Building style block', {
    profileId,
    minify: options.minify || false,
    hasFrontmatterCSS: !!options.frontmatterCSS,
    extractCSS: options.extractCSS || false,
    useCSSLayers
  });

  const resources = [];
  for (const { layer, source, resolvedPath, size } of aggregated) {
    if (resolvedPath) {
      resources.push({
        layer,
        source: source || resolvedPath,
        resolvedPath,
        size: size || 0
      });
    }
  }

  // === SPLIT CSS MODE (multi-profile bundle support) ===
  if (options.extractCSS === 'split') {
    const sharedLayerOrder = '@layer base, primary, syntax;\n\n';
    let sharedCSS = sharedLayerOrder;
    const profileLayerOrder = '@layer layout, profile;\n\n';
    let profileCSS = profileLayerOrder;

    for (const { layer, content } of aggregated) {
      const css = options.minify ? minifyCSS(content) : content;
      const wrappedCSS = `@layer ${layer} {\n${css}\n}\n\n`;
      if (SHARED_LAYERS.includes(layer)) {
        sharedCSS += wrappedCSS;
      } else if (PROFILE_LAYERS.includes(layer)) {
        profileCSS += wrappedCSS;
      }
      // frontmatter is handled separately below; `structural` is per document, so the caller puts it into the page (pagemd's renderer)
    }

    const frontmatterCSS = options.frontmatterCSS
      ? (options.minify ? minifyCSS(options.frontmatterCSS) : options.frontmatterCSS)
      : '';

    logger.info('styles', 'success', 'Extracted split CSS for multi-profile bundling', {
      profileId,
      sharedSize: sharedCSS.length,
      profileSize: profileCSS.length,
      frontmatterSize: frontmatterCSS.length
    });

    return {
      sharedCSS,             // styles-shared.css (base + primary + syntax)
      profileCSS,            // styles-{profileId}.css (layout + profile)
      frontmatterCSS,        // Per-document CSS (stays inlined)
      profileId: profileId || 'default',
      resources: options.returnMetadata ? resources : undefined
    };
  }

  // === EXTRACT CSS MODE (single profile) ===
  if (options.extractCSS === true) {
    const layerOrder = `${layerOrderStatement(aggregated)}\n\n`;
    let externalCSS = layerOrder;

    for (const { layer, content } of aggregated) {
      const css = options.minify ? minifyCSS(content) : content;
      externalCSS += `@layer ${layer} {\n${css}\n}\n\n`;
    }

    const frontmatterCSS = options.frontmatterCSS
      ? (options.minify ? minifyCSS(options.frontmatterCSS) : options.frontmatterCSS)
      : '';

    logger.info('styles', 'success', 'Extracted CSS for bundling', {
      profileId,
      layers: aggregated.length,
      externalSize: externalCSS.length,
      frontmatterSize: frontmatterCSS.length
    });

    return {
      inlineStyles: '',      // Future: critical CSS optimization
      externalCSS,           // Combined layers for styles.css
      frontmatterCSS,        // Per-document CSS (stays inlined)
      resources: options.returnMetadata ? resources : undefined
    };
  }

  // === INLINE STYLE MODE (default) ===
  // Declare the layer order first (frontmatter intentionally undeclared: highest priority)
  let styleBlock = useCSSLayers
    ? `<style>\n${layerOrderStatement(aggregated)}\n</style>\n`
    : '';

  for (const { layer, content } of aggregated) {
    const css = options.minify ? minifyCSS(content) : content;
    styleBlock += formatStyleTag(css, layer, useCSSLayers) + '\n';
  }

  if (options.frontmatterCSS) {
    const css = options.minify ? minifyCSS(options.frontmatterCSS) : options.frontmatterCSS;
    styleBlock += formatStyleTag(css, 'frontmatter', useCSSLayers) + '\n';
  }

  logger.info('styles', 'success', 'Built style block', {
    profileId,
    layers: aggregated.length + (options.frontmatterCSS ? 1 : 0),
    size: styleBlock.length
  });

  if (options.returnMetadata) {
    return { styleBlock, resources };
  }

  return styleBlock;
}

/**
 * Wrap CSS in <style> tag with optional @layer declaration
 * @param {string} css - CSS content to wrap
 * @param {string} layer - Layer name (base, primary, layout, syntax, profile, frontmatter)
 * @param {boolean} [useCSSLayers=true] - Wrap in @layer declaration. False for Paged.js compatibility.
 * @returns {string} HTML <style> tag with optional @layer wrapper
 */
export function formatStyleTag(css, layer, useCSSLayers = true) {
  if (useCSSLayers) {
    return `<style data-layer="${layer}">
@layer ${layer} {
${css}
}
</style>`;
  }
  // No @layer wrapper - for Paged.js PDF compatibility
  return `<style data-layer="${layer}">
${css}
</style>`;
}

/**
 * Basic CSS minification for production
 * Removes comments, extra whitespace, and normalizes
 * @param {string} css - CSS to minify
 * @returns {string} Minified CSS
 */
export function minifyCSS(css) {
  if (!css) return '';

  return css
    // Remove CSS comments
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Remove leading/trailing whitespace per line
    .replace(/^\s+|\s+$/gm, '')
    // Collapse multiple spaces to single space
    .replace(/\s+/g, ' ')
    // Remove space around braces, colons, semicolons
    .replace(/\s*([{}:;,])\s*/g, '$1')
    // Remove trailing semicolons before closing brace
    .replace(/;}/g, '}')
    // Trim final result
    .trim();
}

/**
 * Inject styles into HTML by replacing {{css}} token
 * @param {string} html - HTML template containing {{css}} token
 * @param {string} styles - Style block to inject
 * @param {{ log?: object }} [options] - a logger (trace/debug/warn)
 * @returns {string} HTML with styles injected
 */
export function inlineStyles(html, styles, options = {}) {
  const logger = options.log || { trace() {}, debug() {}, warn() {} };
  logger.trace('styles', 'in-progress', 'Injecting styles into HTML', {
    htmlSize: html?.length,
    stylesSize: styles?.length
  });

  if (!html) {
    logger.warn('styles', 'failure', 'No HTML provided for style injection');
    return '';
  }

  if (!styles) {
    logger.warn('styles', 'failure', 'No styles provided, removing {{css}} token');
    return html.replace(/\{\{css\}\}/g, '<!-- No styles provided -->');
  }

  const result = html.replace(/\{\{css\}\}/g, styles);

  logger.debug('styles', 'success', 'Injected styles into HTML', {
    htmlSize: result.length,
    tokenReplaced: html.includes('{{css}}')
  });

  return result;
}
