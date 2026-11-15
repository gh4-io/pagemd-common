/**
 * Footnotes and task lists (pagemd-editor P26): markdown-it-footnote 4.0.0 with its line-range and editor-mode
 * shims, and our own task-list rule (markdown-it-task-lists 2.1.1's HTML, recorded in fixtures/). Each block of
 * checks has a control that shows it can fail.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createDialect, itemOccurrences, items, writeFootnote, writeTaskMarker, structuralCssFor, lateStructuralCssFor,
  FOOTNOTES_STRUCTURAL_CSS, TASK_LISTS_STRUCTURAL_CSS
} from '../src/index.js';
import { roundTripDocument, editorDialect } from './roundtrip/harness.js';

const render = (src, fields = {}) => createDialect({ options: { fields } }).render(src);
const editor = (fields = {}) => createDialect({ mode: 'editor', options: { fields } });
const unmapped = (md, src) => md.parse(src, {}).filter((t) => t.nesting !== -1 && !Array.isArray(t.map)).map((t) => t.type);

const SHOWCASE = [
  'Footnote 1 link[^first].',
  '',
  'Footnote 2 link[^second].',
  '',
  'Inline footnote^[Text of inline footnote] definition.',
  '',
  'Duplicated footnote reference[^second].',
  '',
  '[^first]: Footnote **can have markup**',
  '',
  '    and multiple paragraphs.',
  '',
  '[^second]: Footnote text.',
  ''
].join('\n');

describe('footnotes: the HTML (markdown-it-footnote 4.0.0, GitHub\'s classes)', () => {
  it('the showcase section (the user\'s example.md): numbered by first reference, notes at the end with back-links', () => {
    expect(render(SHOWCASE)).toBe([
      '<p>Footnote 1 link<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup>.</p>',
      '<p>Footnote 2 link<sup class="footnote-ref"><a href="#fn2" id="fnref2">[2]</a></sup>.</p>',
      '<p>Inline footnote<sup class="footnote-ref"><a href="#fn3" id="fnref3">[3]</a></sup> definition.</p>',
      '<p>Duplicated footnote reference<sup class="footnote-ref"><a href="#fn2" id="fnref2:1">[2:1]</a></sup>.</p>',
      '<hr class="footnotes-sep">',
      '<section class="footnotes">',
      '<ol class="footnotes-list">',
      '<li id="fn1" class="footnote-item"><p>Footnote <strong>can have markup</strong></p>',
      '<p>and multiple paragraphs. <a href="#fnref1" class="footnote-backref">↩︎</a></p>',
      '</li>',
      '<li id="fn2" class="footnote-item"><p>Footnote text. <a href="#fnref2" class="footnote-backref">↩︎</a> <a href="#fnref2:1" class="footnote-backref">↩︎</a></p>',
      '</li>',
      '<li id="fn3" class="footnote-item"><p>Text of inline footnote <a href="#fnref3" class="footnote-backref">↩︎</a></p>',
      '</li>',
      '</ol>',
      '</section>',
      ''
    ].join('\n'));
  });

  it('a reference with no note stays text; a note nothing refers to is left out', () => {
    expect(render('Text[^missing].\n')).toBe('<p>Text[^missing].</p>\n');
    expect(render('Text.\n\n[^lonely]: Nobody points here.\n')).toBe('<p>Text.</p>\n');
  });

  it('two notes with one label: the last one is printed (the plugin\'s rule)', () => {
    expect(render('A[^d].\n\n[^d]: first\n\n[^d]: second\n')).toContain('<p>second <a href="#fnref1"');
  });

  it('references in lists, quotes, table cells, after directives, with {…} attributes and fancy lists', () => {
    const notes = '\n\n[^1]: Note.\n';
    expect(render(`- item[^1]${notes}`)).toContain('<li>item<sup class="footnote-ref">');
    expect(render(`> quoted[^1]${notes}`)).toContain('<p>quoted<sup class="footnote-ref">');
    expect(render(`| a |\n|---|\n| x[^1] |${notes}`)).toContain('<td>x<sup class="footnote-ref">');
    expect(render(`<!-- ::PAGEBREAK -->\n\nAfter[^1].${notes}`)).toContain('<div class="break-page"></div>\n<p>After<sup');
    expect(render(`Para[^1] {.lead}${notes}`)).toContain('<p class="lead">Para<sup');
    expect(render(`a. item[^1]\nb. two${notes}`, { fancy_lists: true })).toContain('<ol type="a" class="list-lower-alpha">\n<li>item<sup');
    expect(render('> text[^q]\n>\n> [^q]: a note written in the quote\n')).toContain('<li id="fn1" class="footnote-item"><p>a note written in the quote');
  });

  it('control: a label with a space is not a footnote (it stays a link reference)', () => {
    expect(render('Text[^a b].\n\n[^a b]: x\n')).toBe('<p>Text<a href="x">^a b</a>.</p>\n');
  });
});

describe('footnotes: every block token has a line range (C2), render mode included', () => {
  const SRC = 'A[^1] and ^[inline].\n\n- [x] task[^1]\n\n[^1]: Note\n\n    second paragraph.\n';

  for (const mode of ['render', 'editor']) {
    it(`${mode} mode`, () => {
      expect(unmapped(createDialect({ mode }), SRC)).toEqual([]);
      expect(unmapped(createDialect({ mode }), SHOWCASE)).toEqual([]);
    });
  }

  it('the notes keep the lines they were written on; an inline note, its paragraph\'s', () => {
    const tokens = createDialect().parse(SRC, {});
    const notes = tokens.filter((t) => t.type === 'footnote_open').map((t) => t.map);
    expect(notes).toEqual([[4, 7], [0, 1]]);
    expect(tokens.find((t) => t.type === 'footnote_block_open').map).toEqual([0, 7]);
  });

  it('control: without the shim the plugin\'s tokens have none', () => {
    const md = createDialect();
    md.core.ruler.disable('pagemd_footnote_lines');
    expect(new Set(unmapped(md, SRC))).toEqual(new Set(['footnote_block_open', 'footnote_open', 'footnote_anchor', 'paragraph_open', 'inline']));
  });
});

describe('footnotes: editor mode keeps each note where it is written', () => {
  it('a note is footnote_reference_open/close with its lines and label; references carry their data', () => {
    const md = editor();
    const tokens = md.parse(SHOWCASE, {});
    expect(tokens.some((t) => t.type === 'footnote_block_open')).toBe(false);
    const found = itemOccurrences(tokens).filter((o) => o.item === 'footnotes').map((o) => [o.data, o.token.map ?? null]);
    expect(found).toEqual([
      [{ form: 'ref', label: 'first' }, null],
      [{ form: 'ref', label: 'second' }, null],
      [{ form: 'inline', content: 'Text of inline footnote' }, null],
      [{ form: 'ref', label: 'second' }, null],
      [{ form: 'definition', label: 'first' }, [8, 12]], // the blank line after it too, as a list's (the editor trims it)
      [{ form: 'definition', label: 'second' }, [12, 13]]
    ]);
  });

  it('every non-blank line belongs to a top-level block (P4)', () => {
    const lines = SHOWCASE.split('\n');
    const covered = new Array(lines.length).fill(false);
    for (const t of editor().parse(SHOWCASE, {})) if (t.level === 0 && t.nesting !== -1 && t.map) for (let l = t.map[0]; l < t.map[1]; l++) covered[l] = true;
    expect(lines.filter((text, i) => !covered[i] && text.trim() !== '')).toEqual([]);
  });

  it('control: render mode moves the notes to the end', () => {
    const types = createDialect().parse(SHOWCASE, {}).map((t) => t.type);
    expect(types.includes('footnote_reference_open')).toBe(false);
    // The four paragraphs of text come first, then the block of notes with the notes' own paragraphs
    expect(types.slice(0, types.indexOf('footnote_block_open')).filter((t) => t === 'paragraph_open')).toHaveLength(4);
  });
});

describe('footnotes: write rule and round trip', () => {
  it('writes references, inline notes and notes (more lines indented by four spaces)', () => {
    expect(writeFootnote({ form: 'ref', label: 'first' })).toBe('[^first]');
    expect(writeFootnote({ form: 'inline', content: 'a *note*' })).toBe('^[a *note*]');
    expect(writeFootnote({ form: 'definition', label: '1' }, 'Footnote **b**\n\nand more.')).toBe('[^1]: Footnote **b**\n\n    and more.');
    expect(writeFootnote({ form: 'definition', label: '2' }, '')).toBe('[^2]:');
  });

  it('reads back the same (C3 harness), the showcase included', () => {
    const r = roundTripDocument(SHOWCASE, editorDialect());
    expect(r.failures).toEqual([]);
    expect(r.checked).toBe(6);
  });

  it('control: a write rule that drops the indentation fails the round trip', () => {
    const item = items.find((i) => i.id === 'footnotes');
    const original = item.write;
    item.write = (data, content) => (data.form === 'definition' ? `[^${data.label}]: ${content}` : original(data, content));
    try {
      expect(roundTripDocument(SHOWCASE, editorDialect()).failures.length).toBeGreaterThan(0);
    } finally {
      item.write = original;
    }
  });
});

describe('task lists: markdown-it-task-lists 2.1.1\'s HTML, byte for byte (recorded)', () => {
  const recorded = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/task-lists-2.1.1.json', import.meta.url)), 'utf8'));

  for (const [name, c] of Object.entries(recorded)) {
    it(name, () => {
      expect(render(c.markdown, { fancy_lists: c.fancyLists })).toBe(c.html);
    });
  }

  it('control: without the rule the HTML differs', () => {
    const md = createDialect();
    md.core.ruler.disable('pagemd_task_lists');
    const c = recorded['unchecked, checked, capital X'];
    expect(md.render(c.markdown)).not.toBe(c.html);
  });

  it('one instance\'s settings never reach another (the plugin kept its options module-wide)', () => {
    expect(render('- [ ] x\n')).toBe(render('- [ ] x\n'));
    expect(render('- [ ] x\n')).toContain('disabled=""');
  });
});

describe('task lists: editor mode and the write rule', () => {
  it('the item carries { checked, mark, gap }; its text starts after the gap', () => {
    const tokens = editor({ fancy_lists: true }).parse('- [ ] todo\n- [X]  done\n\na. [x] lettered\n', {});
    const found = itemOccurrences(tokens).filter((o) => o.item === 'task-lists').map((o) => o.data);
    expect(found).toEqual([
      { checked: false, mark: ' ', gap: ' ' },
      { checked: true, mark: 'X', gap: '  ' },
      { checked: true, mark: 'x', gap: ' ' }
    ]);
    expect(tokens.filter((t) => t.type === 'inline').map((t) => t.content)).toEqual(['todo', 'done', 'lettered']);
    expect(tokens.some((t) => t.type === 'html_inline' || (t.children || []).some((c) => c.type === 'html_inline'))).toBe(false);
  });

  it('writes the box back as written; a toggle keeps the gap and an X', () => {
    expect(writeTaskMarker({ checked: false, mark: ' ', gap: ' ' })).toBe('[ ] ');
    expect(writeTaskMarker({ checked: true, mark: ' ', gap: ' ' })).toBe('[x] ');
    expect(writeTaskMarker({ checked: true, mark: 'X', gap: '  ' })).toBe('[X]  ');
    expect(writeTaskMarker({ checked: false, mark: 'X', gap: '  ' })).toBe('[ ]  ');
    expect(writeTaskMarker({ checked: true })).toBe('[x] ');
  });

  it('reads back the same (C3 harness)', () => {
    const r = roundTripDocument('- [ ] todo\n- [X]  done\n  - [x] nested\n', editorDialect());
    expect(r.failures).toEqual([]);
    expect(r.checked).toBe(3);
  });

  it('control: not a task (later in the line, nothing after it, a tab, a link)', () => {
    const md = editor();
    for (const src of ['- some [ ] text\n', '- [ ]\n', '- [ ]\ttab\n', '- [x](u) link\n', 'Not a list [ ] x\n']) {
      expect(itemOccurrences(md.parse(src, {})).filter((o) => o.item === 'task-lists')).toEqual([]);
    }
  });
});

describe('structural CSS, only for documents that use the items', () => {
  it('footnotes, task lists, both, none', () => {
    expect(structuralCssFor(render(SHOWCASE))).toBe(`/* pagemd: footnotes */\n${FOOTNOTES_STRUCTURAL_CSS}\n`);
    // FIX-ADT: task lists are in the `structural` layer (after the profile's), footnotes stay in `base`
    // (AD-FIX-ADT-09: no rule in `base` any more, nothing is `!important`; the bundled profiles state the 2em themselves)
    expect(structuralCssFor(render('- [ ] x\n'))).toBe('');
    expect(lateStructuralCssFor(render('- [ ] x\n'))).toBe(`/* pagemd: task-lists */\n${TASK_LISTS_STRUCTURAL_CSS}\n`);
    expect(lateStructuralCssFor(render(SHOWCASE))).toBe('');
    expect(structuralCssFor(render(`- [ ] x${'\n'}${SHOWCASE}`))).toBe(`/* pagemd: footnotes */\n${FOOTNOTES_STRUCTURAL_CSS}\n`);
    expect(lateStructuralCssFor(render(`- [ ] x${'\n'}${SHOWCASE}`))).toContain('task-lists');
    expect(structuralCssFor(render('# Plain\n\n- item\n\n| a |\n|---|\n| b |\n'))).toBe('');
    expect(lateStructuralCssFor(render('# Plain\n\n- item\n\n| a |\n|---|\n| b |\n'))).toBe('');
  });

  it("the checkbox has no bullet and GitHub's layout (2em indent, the box pulled back 1.4em); nothing hides it in print", () => {
    expect(TASK_LISTS_STRUCTURAL_CSS).toMatch(/\.contains-task-list \{ list-style: none; padding-left: 2em; \}/);
    expect(TASK_LISTS_STRUCTURAL_CSS).toContain('margin: 0 .2em .25em -1.4em;');
    expect(TASK_LISTS_STRUCTURAL_CSS).not.toMatch(/display:\s*none/);
    // AD-FIX-ADT-09: nothing is !important, so a profile's or a document's own rule can still change the indent
    expect(TASK_LISTS_STRUCTURAL_CSS).not.toMatch(/!important/);
  });
});
