/**
 * Every image a document refers to, read from parsed tokens (phase C9, A12).
 *
 * One list for every image form, so the CLI's archive, the asset checks (C8)
 * and the editor's image renaming (P15) all agree on what counts as an image:
 *
 *   form        written as
 *   'image'     ![alt](path)  (also the legacy FIGURE form, image on the next line)
 *   'figure'    <!-- ::FIGURE src="path" … -->
 *   'annotated' ::: annotated-image path
 *   'embed'     ![[path]] / ![[path|alt]]
 *   'html'      <img src="path"> in raw HTML
 *
 * Every reference is listed, web links and data: URIs included; the caller
 * decides which to skip. Code blocks and inline code are not searched (they
 * are text, not images).
 */

const HTML_IMG_SRC = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/**
 * markdown-it percent-encodes link paths (a space becomes %20); give the
 * author's path back.
 * @param {string} src - Encoded path
 * @returns {string}
 */
function decodePath(src) {
  try {
    return decodeURI(src);
  } catch {
    return src;
  }
}

/**
 * @typedef {object} ImageRef
 * @property {'image'|'figure'|'annotated'|'embed'|'html'} form
 * @property {string} src - The path or URL as the author wrote it
 * @property {number|null} line - 0-based source line of the block it is in
 */

/**
 * List every image reference in a token stream (from md.parse()).
 * @param {object[]} tokens - markdown-it block tokens
 * @returns {ImageRef[]} In document order
 */
export function listImageRefs(tokens) {
  const refs = [];
  const add = (form, src, line) => {
    if (typeof src === 'string' && src.trim()) refs.push({ form, src: src.trim(), line });
  };
  const addHtml = (html, line) => {
    for (const m of html.matchAll(HTML_IMG_SRC)) add('html', m[1] ?? m[2] ?? m[3], line);
  };

  for (const token of tokens) {
    const line = token.map ? token.map[0] : null;
    switch (token.type) {
      case 'figure_image':
        add('figure', token.meta && token.meta.src, line);
        break;
      case 'annotated_image':
        add('annotated', token.meta && token.meta.imagePath, line);
        break;
      case 'html_block':
        addHtml(token.content, line);
        break;
      case 'inline':
        for (const child of token.children || []) {
          if (child.type === 'image') {
            if (child.meta && child.meta.embed) add('embed', child.meta.path, line);
            else add('image', decodePath(child.attrGet('src') || ''), line);
          } else if (child.type === 'html_inline') {
            addHtml(child.content, line);
          }
        }
        break;
      default:
        break;
    }
  }
  return refs;
}
