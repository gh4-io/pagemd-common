/**
 * Reading the document once for every level (phase C8): the frontmatter as written, and the body parsed by
 * @pagemd/syntax in editor mode (directives kept as written, a line range on every block).
 *
 * The frontmatter is found as pagemd's renderer finds it (gray-matter): the file starts with `---` (not `----`), and
 * the first later line starting with `---` closes it; without a closing line the whole rest is frontmatter (so a
 * YAML error stops rendering, and is reported here too). It is read with the resolver's YAML reader (js-yaml 4's
 * rules). The CLI and the editor both give `validate` the text, so they read the same frontmatter the same way.
 * (pagemd-editor's own frontmatter card recognises only a block with a closing `---`; those edge cases differ.)
 *
 * The frontmatter's lines are blanked (not removed) before parsing, so every token's line is the line in the
 * whole file.
 */

import { loadYaml } from '@pagemd/resolver';
import { createDialect } from '@pagemd/syntax';
import { CATALOGUE } from '@pagemd/meta';

/**
 * @param {string} text
 * @returns {{ yaml: string, endLine: number } | null} the YAML and the first line after the block
 */
export function frontmatterBlock(text) {
  if (!text.startsWith('---') || text[3] === '-') return null;
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].startsWith('---')) return { yaml: lines.slice(1, i).join('\n'), endLine: i + 1 };
  }
  return { yaml: lines.slice(1).join('\n'), endLine: lines.length };
}

/**
 * The frontmatter as written ({} for none or a non-object). Throws "Frontmatter YAML error: …" on a YAML error.
 * @param {string} text
 */
export function readFrontmatter(text) {
  const block = frontmatterBlock(text);
  if (!block) return {};
  let data;
  try {
    data = loadYaml(block.yaml);
  } catch (error) {
    throw new Error(`Frontmatter YAML error: ${String(error?.message ?? error).split('\n')[0]}`);
  }
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

/** Every gate on (e.g. `fancy_lists: true`), so a gated item the document uses is seen even when its gate is off. */
const ALL_GATES_ON = Object.fromEntries(Object.values(CATALOGUE.gates).map((gate) => [gate.field, gate.value]));

/**
 * The body's block tokens, lines counted in the whole file.
 * @param {string} text
 * @returns {object[]} markdown-it block tokens (editor mode)
 */
export function parseBody(text) {
  const md = createDialect({ mode: 'editor', options: { fields: ALL_GATES_ON } });
  return md.parse(bodyText(text), {});
}

/**
 * The text with the frontmatter's lines blanked (not removed), so a line in it is the line in the whole file
 * @param {string} text
 * @returns {string}
 */
export function bodyText(text) {
  const block = frontmatterBlock(text);
  if (!block) return text;
  const lines = text.split('\n');
  return [...lines.slice(0, block.endLine).map(() => ''), ...lines.slice(block.endLine)].join('\n');
}
