/**
 * Footnotes (pagemd-editor P26, OQ-56 → R-245): `text[^label]`, `^[inline note]` and the note itself,
 * `[^label]: text` (more paragraphs indented by four spaces). Read by markdown-it-footnote 4.0.0 (the
 * markdown-it project's own plugin, the one GitHub-style footnotes in markdown-it use), with two shims:
 *
 * - Line ranges (C2's rule: every block token has a `map`, render mode included): the plugin makes the notes'
 *   tokens (`footnote_block_open`, `footnote_open`, `footnote_anchor`, an inline note's paragraph) without one.
 *   Each note gets the lines it was written on (an inline note: the lines of the block it sits in); the block of
 *   notes, the lines from its first note to its last. The HTML does not change.
 * - Editor mode: the notes stay where they are written (the plugin moves them to the end of the document, which an
 *   editor that writes back only changed blocks can't do): `footnote_reference_open` / `_close` with the note's
 *   lines and `meta.label`; a reference is `footnote_ref` (`meta.label`), an inline note `footnote_ref` with
 *   `meta.inline` and `meta.content` (the note's markdown as written).
 *
 * The HTML is the plugin's (GitHub's classes): `<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup>`
 * in the text and, at the end of the document, `<hr class="footnotes-sep"><section class="footnotes"><ol
 * class="footnotes-list"><li id="fn1" class="footnote-item">… <a href="#fnref1" class="footnote-backref">↩︎</a>`.
 * Notes are numbered in the order they are first referred to; a note nothing refers to is left out; a reference
 * with no note stays text; two notes with one label: the last one is printed (the plugin's rule).
 *
 * Write rule (data from itemOccurrences): { form: 'ref', label } → `[^label]`; { form: 'inline', content } →
 * `^[content]`; { form: 'definition', label } with the note's markdown → `[^label]: first line`, the other lines
 * indented by four spaces (blank lines stay blank).
 */

import markdownItFootnote from 'markdown-it-footnote';
import { isEditor } from '../shared/mode.js';

/**
 * The look footnotes need whatever the theme (pagemd adds it only to documents that have footnotes, so no other
 * document's output changes; the editor's canvas uses the same text). A profile's CSS can override every rule.
 */
export const FOOTNOTES_STRUCTURAL_CSS = [
  '.footnote-ref { font-size: 0.75em; line-height: 0; vertical-align: super; }',
  '.footnote-ref a { text-decoration: none; }',
  '.footnotes-sep { margin-top: 2em; }',
  '.footnotes { font-size: 0.9em; }',
  '.footnotes-list { padding-left: 1.5em; }',
  '.footnote-item p { margin: 0.25em 0; }',
  '.footnote-backref { text-decoration: none; }',
  '@media print { .footnote-backref { display: none; } }'
].join('\n');

/** The plugin's block rule, wrapped so the note's open and close tokens carry its lines */
function noteLines(md) {
  const rule = md.block.ruler.__rules__.find((r) => r.name === 'footnote_def');
  if (!rule) return;
  const original = rule.fn;
  md.block.ruler.at('footnote_def', (state, startLine, endLine, silent) => {
    const at = state.tokens.length;
    const found = original(state, startLine, endLine, silent);
    if (found && !silent) {
      const open = state.tokens[at];
      const close = state.tokens[state.tokens.length - 1];
      if (open && open.type === 'footnote_reference_open') open.map = [startLine, state.line];
      if (close && close.type === 'footnote_reference_close') close.map = [startLine, state.line];
    }
    return found;
  }, { alt: ['paragraph', 'reference'] });
}

/** Before the plugin moves the notes: where each was written (render mode) */
function noteWhere(state) {
  const fn = state.env.footnotes;
  if (!fn) return;
  const byLabel = {};
  const byInline = {};
  for (const t of state.tokens) {
    if (t.type === 'footnote_reference_open' && t.map) byLabel[`:${t.meta.label}`] = t.map;
    if (t.type === 'inline' && t.map) {
      for (const c of t.children || []) {
        if (c.type === 'footnote_ref' && c.meta && c.meta.label === undefined) byInline[c.meta.id] = t.map;
      }
    }
  }
  fn.pagemdLines = { byLabel, byInline };
}

/** After the plugin moved the notes to the end: every block token it made gets its note's lines */
function giveLines(state) {
  const lines = state.env.footnotes && state.env.footnotes.pagemdLines;
  if (!lines) return;
  let block = null;
  let current = null;
  let first = null;
  let last = null;
  for (const t of state.tokens) {
    if (t.type === 'footnote_block_open') block = t;
    else if (t.type === 'footnote_open') {
      const m = t.meta.label !== undefined ? lines.byLabel[`:${t.meta.label}`] : lines.byInline[t.meta.id];
      current = m ? [m[0], m[1]] : null;
      if (current) {
        if (first === null || current[0] < first) first = current[0];
        if (last === null || current[1] > last) last = current[1];
      }
    } else if (t.type === 'footnote_close') current = null;
    if (current && !t.map && (t.block || t.type.startsWith('footnote_')) && t.type !== 'footnote_block_open') t.map = [current[0], current[1]];
    else if (current && !t.map && t.type === 'inline') t.map = [current[0], current[1]];
  }
  if (block && first !== null) block.map = [first, last];
}

/** Editor mode: the notes stay where they are written; an inline note keeps its markdown */
function editorNotes(state) {
  const list = state.env.footnotes && state.env.footnotes.list;
  for (const t of state.tokens) {
    if (t.type !== 'inline' || !t.children) continue;
    for (const c of t.children) {
      if (c.type !== 'footnote_ref' || !c.meta) continue;
      if (c.meta.label === undefined) {
        c.meta.inline = true;
        c.meta.content = list && list[c.meta.id] ? list[c.meta.id].content : '';
      }
    }
  }
}

/**
 * Footnote write rule
 * @param {object} data - { form: 'ref' | 'inline' | 'definition', label?, content? }
 * @param {string} [content] - A definition's already-written markdown
 * @returns {string}
 */
export function writeFootnote(data, content = '') {
  const label = String(data.label ?? '').replace(/[\s\]]/g, '');
  if (data.form === 'inline') return `^[${String(data.content ?? '').replace(/\n+/g, ' ')}]`;
  if (data.form === 'definition') {
    const body = String(content).replace(/\n+$/, '');
    const [head, ...rest] = body.split('\n');
    return [`[^${label}]: ${head ?? ''}`.replace(/ $/, ''), ...rest.map((l) => (l ? `    ${l}` : ''))].join('\n');
  }
  return `[^${label}]`;
}

/** @type {import('../index.js').SyntaxItemDef} */
export default {
  id: 'footnotes',
  group: 'text',
  read(md) {
    md.use(markdownItFootnote);
    noteLines(md);
    if (isEditor(md)) {
      md.core.ruler.disable('footnote_tail');
      md.core.ruler.after('footnote_tail', 'pagemd_footnote_editor', editorNotes);
    } else {
      md.core.ruler.before('footnote_tail', 'pagemd_footnote_where', noteWhere);
      md.core.ruler.after('footnote_tail', 'pagemd_footnote_lines', giveLines);
    }
  },
  write: writeFootnote,
  structuralCss: FOOTNOTES_STRUCTURAL_CSS,
  htmlContract: [
    '<sup class="footnote-ref"><a href="#fn{n}" id="fnref{n}">[{n}]</a></sup>',
    '<hr class="footnotes-sep"><section class="footnotes"><ol class="footnotes-list"><li id="fn{n}" class="footnote-item">… <a href="#fnref{n}" class="footnote-backref">↩︎</a></li></ol></section>'
  ],
  params: [
    { key: 'label', type: 'string', label: 'Label', help: 'The name between [^ and ]; the number printed comes from the order of the references' },
    { key: 'content', type: 'string', label: 'Note', help: 'An inline note\'s text (^[…])' }
  ]
};
