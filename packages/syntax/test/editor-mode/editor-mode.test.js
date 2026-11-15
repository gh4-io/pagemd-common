/**
 * Phase C2: createDialect({ mode: 'editor' }) and applyDialect(), per item.
 * (The whole-corpus line-range test lives in pagemd, where the corpus is:
 * pagemd/tests/editor-mode/.)
 */

import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { createDialect, applyDialect, modeOf, listImageRefs } from '../../src/index.js';

const editor = (options = {}) => createDialect({ mode: 'editor', options });
const parse = (src, md = editor()) => md.parse(src, {});
const find = (tokens, type) => tokens.find((t) => t.type === type);
const children = (tokens) => tokens.flatMap((t) => t.children || []);

describe('modes', () => {
  it('records the mode on the instance', () => {
    expect(modeOf(createDialect())).toBe('render');
    expect(modeOf(editor())).toBe('editor');
  });

  it('editor mode: html on, typographer off (curly quotes would be written back)', () => {
    const md = createDialect({ mode: 'editor', options: { markdownIt: { typographer: true, html: false } } });
    expect(md.options.typographer).toBe(false);
    expect(md.options.html).toBe(true);
    const text = children(parse('"quoted" (c) -- dash', md)).map((c) => c.content).join('');
    expect(text).toBe('"quoted" (c) -- dash');
  });

  it('render mode registers none of the editor-only rules or renderers', () => {
    const render = createDialect();
    const names = (md) => [
      ...md.core.ruler.__rules__.map((r) => r.name),
      ...md.block.ruler.__rules__.map((r) => r.name)
    ];
    expect(names(render)).not.toContain('pagemd_include');
    expect(names(render)).not.toContain('pagemd_table_model');
    expect(Object.keys(render.renderer.rules)).not.toContain('pagemd_directive');
    expect(names(editor())).toContain('pagemd_include');
    expect(names(editor())).toContain('pagemd_table_model');
  });

  it('figure numbering stays on in editor mode', () => {
    const tokens = parse('<!-- ::FIGURE src="a.png" caption="A" -->\n\n<!-- ::FIGURE src="b.png" caption="B" -->\n');
    expect(tokens.filter((t) => t.type === 'figure_open').map((t) => t.meta.figureNumber)).toEqual([1, 2]);
  });
});

describe('applyDialect: the editor builds its own markdown-it', () => {
  it('pagemd tables read on a commonmark-preset instance (its table rule is off)', () => {
    const plain = new MarkdownIt('commonmark');
    expect(plain.block.ruler.__rules__.find((r) => r.name === 'table').enabled).toBe(false);
    const md = applyDialect(new MarkdownIt('commonmark'), { mode: 'editor' });
    const tokens = md.parse('| a | b |\n|---|---|\n| 1 | 2 |\n', {});
    expect(find(tokens, 'table_open')).toBeTruthy();
    expect(find(tokens, 'table_open').meta.table.columns).toHaveLength(2);
  });

  it('gives the same tokens as createDialect', () => {
    const src = '<!-- ::TOC levels="2" -->\n\n[[WARNING]] Hot [[/WARNING]]\n\n::: {.note}\nx\n:::\n';
    const types = (md) => md.parse(src, {}).map((t) => `${t.type}:${JSON.stringify(t.map)}`);
    expect(types(applyDialect(new MarkdownIt({ html: true }), { mode: 'editor' }))).toEqual(types(editor()));
  });

  it('checks its arguments like createDialect', () => {
    expect(() => applyDialect(new MarkdownIt(), { mode: 'x' })).toThrow(/unknown mode/);
  });
});

describe('directives: kept as written, as their own tokens', () => {
  it('a block directive becomes pagemd_directive with its item, parameters and text', () => {
    const tokens = parse('<!-- ::TOC levels="3" section -->\n');
    const t = find(tokens, 'pagemd_directive');
    expect(t.content).toBe('<!-- ::TOC levels="3" section -->\n');
    expect(t.map).toEqual([0, 1]);
    expect(t.meta).toMatchObject({ name: 'TOC', item: 'toc', known: true, parenParams: null, params: 'levels="3" section' });
    expect(t.meta.attrs).toEqual({ levels: '3', section: true });
  });

  it('knows every directive item', () => {
    const cases = {
      '<!-- ::PAGEBREAK -->': 'pagebreak',
      '<!-- ::SECTION_START class="x" -->': 'section',
      '<!-- ::SECTION_END -->': 'section',
      '<!-- ::COVER_START -->': 'cover',
      '<!-- ::COVER_END -->': 'cover',
      '<!-- ::LAYOUT(wide) -->': 'layout',
      '<!-- ::INDEX -->': 'index',
      '<!-- ::INDEX term="Bolt" -->': 'index-marker',
      '<!-- ::INCLUDE path="a.md" -->': 'include-directive'
    };
    for (const [src, item] of Object.entries(cases)) {
      expect(find(parse(`${src}\n`), 'pagemd_directive').meta.item, src).toBe(item);
    }
    expect(find(parse('<!-- ::LAYOUT(wide) -->\n'), 'pagemd_directive').meta.parenParams).toBe('wide');
  });

  it('unknown directives (e.g. BREAK) are kept exactly as written', () => {
    const t = find(parse('<!-- ::BREAK -->\n'), 'pagemd_directive');
    expect(t.meta).toMatchObject({ name: 'BREAK', item: null, known: false });
    expect(t.content).toBe('<!-- ::BREAK -->\n');
  });

  it('an inline INDEX marker becomes pagemd_directive_inline', () => {
    const c = children(parse('Tighten the <!-- ::INDEX term="bolt" --> bolt.\n'));
    const t = c.find((x) => x.type === 'pagemd_directive_inline');
    expect(t.meta).toMatchObject({ name: 'INDEX', item: 'index-marker', attrs: { term: 'bolt' } });
    expect(t.content).toBe('<!-- ::INDEX term="bolt" -->');
  });

  it('comments that only embed a directive stay plain HTML (render-only rewriting is off)', () => {
    const t = find(parse('<!-- ::INDEX term="x" -->Text after\n'), 'html_block');
    expect(t.content).toBe('<!-- ::INDEX term="x" -->Text after\n');
  });

  it('render mode is unchanged: directives still become HTML', () => {
    expect(createDialect().render('<!-- ::PAGEBREAK -->\n')).toBe('<div class="break-page"></div>\n');
    expect(createDialect().render('<!-- ::BREAK -->\n')).toBe('<!-- Unknown directive: BREAK -->\n');
  });
});

describe('FIGURE: line range and parameters as written', () => {
  it('one-line form', () => {
    const tokens = parse('Intro\n\n<!-- ::FIGURE src="a.png" caption="A cap" width=half crop-x="33.3" -->\n');
    const open = find(tokens, 'figure_open');
    expect(open.map).toEqual([2, 3]);
    expect(open.meta).toMatchObject({
      raw: 'src="a.png" caption="A cap" width=half crop-x="33.3"',
      attrs: { src: 'a.png', caption: 'A cap', width: 'half', 'crop-x': '33.3' },
      legacy: false,
      image: ''
    });
    expect(tokens.filter((x) => x.nesting !== -1 && !x.map).map((x) => x.type)).toEqual([]);
    expect(find(tokens, 'figure_image').map).toEqual([2, 3]);
    expect(find(tokens, 'figcaption').map).toEqual([2, 3]);
  });

  it('legacy form: the image line belongs to the figure', () => {
    const tokens = parse('<!-- ::FIGURE caption="Old" -->\n![alt](old.png)\n\nNext\n');
    const open = find(tokens, 'figure_open');
    expect(open.map).toEqual([0, 2]);
    expect(open.meta).toMatchObject({ legacy: true, image: '![alt](old.png)' });
    expect(tokens.find((t) => t.type === 'paragraph_open').map).toEqual([3, 4]);
  });

  it('keeps an invalid value as written (validation happens only for the HTML)', () => {
    const open = find(parse('<!-- ::FIGURE src="a.png" height="tall" -->\n'), 'figure_open');
    expect(open.meta.attrs.height).toBe('tall');
    expect(open.meta.height).toBe('');
  });

  it('render mode has the line ranges too, so listImageRefs finds FIGURE lines', () => {
    const tokens = createDialect().parse('x\n\n<!-- ::FIGURE src="a.png" -->\n', {});
    expect(find(tokens, 'figure_open').map).toEqual([2, 3]);
    expect(listImageRefs(tokens)).toEqual([{ form: 'figure', src: 'a.png', line: 2 }]);
  });
});

describe('block callouts: line range and form', () => {
  it('one-line form', () => {
    const tokens = parse('[[WARNING]] Hot surface [[/WARNING]]\n');
    const open = find(tokens, 'callout_open');
    expect(open.map).toEqual([0, 1]);
    expect(open.meta).toEqual({ type: 'WARNING', typeText: 'WARNING', form: 'single', closed: true });
    expect(tokens.filter((t) => t.nesting !== -1).every((t) => Array.isArray(t.map))).toBe(true);
  });

  it('multi-line form, closed and unclosed', () => {
    const closed = find(parse('[[danger]]\nLine one\nLine two\n[[/danger]]\n\nAfter\n'), 'callout_open');
    expect(closed.map).toEqual([0, 4]);
    expect(closed.meta).toMatchObject({ type: 'DANGER', typeText: 'danger', form: 'multi', closed: true });
    const open = find(parse('[[WARNING]]\nNo end\n# Heading\n'), 'callout_open');
    expect(open.map).toEqual([0, 2]);
    expect(open.meta.closed).toBe(false);
  });
});

describe('attribute containers ::: {…}', () => {
  it('line range includes the closing line; attributes as written', () => {
    const tokens = parse('::: {.note #n data-x="1"}\ninside\n:::\n\nafter\n');
    const open = find(tokens, 'div_open');
    expect(open.map).toEqual([0, 3]);
    expect(open.meta).toEqual({ attributes: '{.note #n data-x="1"}', closed: true });
    expect(open.attrs).toEqual([['class', 'note'], ['id', 'n'], ['data-x', '1']]);
  });

  it('an unclosed container runs to the end', () => {
    const open = find(parse('::: {.x}\na\nb\n'), 'div_open');
    expect(open.map).toEqual([0, 3]);
    expect(open.meta.closed).toBe(false);
  });
});

describe('annotated images (A1, done in C9; YAML error note, C2)', () => {
  it('carries its line range, raw YAML, parsed data and path', () => {
    const t = find(parse('::: annotated-image a.png\nmarkers:\n  - { id: 1, x: 1, y: 2, label: "L" }\n:::\n'), 'annotated_image');
    expect(t.map).toEqual([0, 4]);
    expect(t.content).toBe('markers:\n  - { id: 1, x: 1, y: 2, label: "L" }');
    expect(t.meta.imagePath).toBe('a.png');
    expect(t.meta.data.markers).toEqual([{ id: 1, x: 1, y: 2, label: 'L' }]);
    expect(t.meta.yamlError).toBeUndefined();
  });

  it('a YAML error leaves a note on the token (render mode too); the figure stays empty', () => {
    const src = '::: annotated-image a.png\nmarkers: [ { id: 1\n:::\n';
    const t = find(parse(src), 'annotated_image');
    expect(t.meta.yamlError).toMatch(/.+/);
    expect(t.meta.data.markers).toEqual([]);
    expect(find(createDialect().parse(src, {}), 'annotated_image').meta.yamlError).toMatch(/.+/);
  });
});

describe('!!!include(…)!!! as an atom (editor mode only)', () => {
  it('a line that is only an include is one atom token', () => {
    const tokens = parse('Intro\n\n!!!include(parts/a.md)!!!\n\nEnd\n');
    const t = find(tokens, 'pagemd_include');
    expect(t.map).toEqual([2, 3]);
    expect(t.meta).toEqual({ path: 'parts/a.md' });
    expect(t.content).toBe('!!!include(parts/a.md)!!!');
  });

  it('an include in the middle of text stays text', () => {
    const tokens = parse('See !!!include(a.md)!!! here\n');
    expect(find(tokens, 'pagemd_include')).toBeUndefined();
    expect(find(tokens, 'inline').content).toBe('See !!!include(a.md)!!! here');
  });

  it('without braces it is not an include (markdown-it-include would refuse it)', () => {
    expect(find(parse('!!!include a.md!!!\n'), 'pagemd_include')).toBeUndefined();
  });

  it('render mode reads it as text (pagemd adds the file-reading plugin itself)', () => {
    expect(find(createDialect().parse('!!!include(a.md)!!!\n', {}), 'pagemd_include')).toBeUndefined();
  });
});

describe('wikilinks and embeds are marked with what the author wrote', () => {
  it('wikilink: target and display (null without "|")', () => {
    const links = children(parse('[[Page|shown]] and [[Other]]\n')).filter((c) => c.type === 'link_open');
    expect(links.map((l) => l.meta)).toEqual([
      { wikilink: true, target: 'Page', display: 'shown' },
      { wikilink: true, target: 'Other', display: null }
    ]);
  });

  it('embed: alt as written, or null', () => {
    const imgs = children(parse('![[a.png|Alt]] ![[b.png]]\n')).filter((c) => c.type === 'image');
    expect(imgs.map((i) => i.meta)).toEqual([
      { embed: true, path: 'a.png', alt: 'Alt' },
      { embed: true, path: 'b.png', alt: null }
    ]);
  });

  it('ordinary links are not marked', () => {
    const link = children(parse('[x](y)\n')).find((c) => c.type === 'link_open');
    expect(link.meta).toBeNull();
  });
});

describe('tables: a model on table_open; captions inside the line range', () => {
  it('reads colspan, rowspan, alignment and the bracket caption', () => {
    const tokens = parse('[Parts][tbl-parts]\n| a || b |\n|---|:-:|--:|\n| 1 | 2 | 3 |\n| ^^ | x | y |\n');
    const model = find(tokens, 'table_open').meta.table;
    expect(model.columns.map((c) => c.align)).toEqual(['', 'center', 'right']);
    expect(model.header[0].cells).toEqual([{ text: 'a', colspan: 2, rowspan: 1 }, { text: 'b', colspan: 1, rowspan: 1 }]);
    expect(model.bodies[0][0].cells[0]).toEqual({ text: '1', colspan: 1, rowspan: 2 });
    expect(model.bodies[0][1].cells.map((c) => c.text)).toEqual(['x', 'y']);
    expect(model.caption).toEqual({ text: 'Parts', position: 'top', label: 'tbl-parts' });
  });

  it('a "Table:" paragraph moved into the table widens its line range', () => {
    const tokens = parse('| h |\n|---|\n| v |\n\nTable: Caption\n\nNext\n');
    const open = find(tokens, 'table_open');
    expect(open.map).toEqual([0, 5]);
    expect(open.meta.table.tableCaption).toEqual({ text: 'Caption', form: 'table', position: 'bottom' });
  });

  it('multi-line rows keep their lines; headerless tables have no header', () => {
    const model = find(parse('|---|---|\n| a | b \\\n| c | d |\n'), 'table_open').meta.table;
    expect(model.header).toEqual([]);
    expect(model.bodies[0][0]).toEqual({ multiline: true, cells: [{ text: 'a\nc', colspan: 1, rowspan: 1 }, { text: 'b\nd', colspan: 1, rowspan: 1 }] });
  });

  it('render mode gets no model', () => {
    expect(find(createDialect().parse('| a |\n|---|\n', {}), 'table_open').meta.table).toBeUndefined();
  });
});

describe('P4: every line belongs to a block (closing ::: and a table\'s {…} line)', () => {
  const top = (src, md = editor()) => parse(src, md).filter((t) => t.level === 0 && t.nesting !== -1).map((t) => [t.type, t.map]);

  it('a named container\'s range includes its closing :::', () => {
    expect(top(':::details Title\nBody\n:::\n\nAfter\n')).toEqual([['container_details_open', [0, 3]], ['paragraph_open', [4, 5]]]);
    expect(top('::: warning\nBody\n:::\n', createDialect())).toEqual([['container_warning_open', [0, 3]]]);
  });

  it('an unclosed container (end of document or of its parent) keeps its range', () => {
    expect(top(':::note\nBody\n')).toEqual([['container_note_open', [0, 2]]]);
    const inner = parse(':::details\n::::note\nInner\n:::\n').find((t) => t.type === 'container_note_open');
    expect(top(':::details\n::::note\nInner\n:::\n')).toEqual([['container_details_open', [0, 4]]]);
    expect(inner.map).toEqual([1, 3]);
  });

  it('meta.closed says whether the container had its own closing line', () => {
    const tokens = parse(':::details\n:::aside\nNested.\n:::\n\nText.\n:::\n');
    const opens = tokens.filter((t) => /^container_.*_open$/.test(t.type)).map((t) => [t.type, t.meta.closed]);
    expect(opens).toEqual([['container_details_open', true], ['container_aside_open', false]]);
    expect(find(parse(':::note\nBody\n'), 'container_note_open').meta.closed).toBe(false);
  });

  it('a table\'s range includes the {…} line markdown-it-attrs moved onto it', () => {
    const src = '| a |\n|---|\n| 1 |\n{.procedure}\n\nAfter\n';
    const table = find(parse(src), 'table_open');
    expect(table.attrs).toEqual([['class', 'procedure']]);
    expect(table.map).toEqual([0, 4]);
    expect(top(src).map(([type]) => type)).toEqual(['table_open', 'paragraph_open']);
  });

  it('a paragraph after a table that is not only attributes stays its own block', () => {
    const src = '| a |\n|---|\n| 1 |\n\nText {.x}\n';
    expect(top(src)).toEqual([['table_open', [0, 3]], ['paragraph_open', [4, 5]]]);
  });

  it('render mode registers no table-attribute rule', () => {
    const names = (md) => md.core.ruler.__rules__.map((r) => r.name);
    expect(names(createDialect())).not.toContain('pagemd_table_attrs_range');
    expect(names(editor())).toContain('pagemd_table_attrs_range');
  });
});

describe('P4 (D18): structural CSS with the HTML contract', () => {
  it('the annotated-image item carries the CSS that places markers, shapes and notes on the image', async () => {
    const { items, ANNOTATED_IMAGE_STRUCTURAL_CSS } = await import('../../src/index.js');
    const item = items.find((i) => i.id === 'annotated-image');
    expect(item.structuralCss).toBe(ANNOTATED_IMAGE_STRUCTURAL_CSS);
    for (const selector of ['.image-wrapper {', '.marker {', '.annotation-shapes {', '.annotation-text {']) {
      expect(ANNOTATED_IMAGE_STRUCTURAL_CSS).toContain(selector);
    }
    expect(ANNOTATED_IMAGE_STRUCTURAL_CSS).toMatch(/\.image-wrapper \{\n  position: relative;/);
  });
});
