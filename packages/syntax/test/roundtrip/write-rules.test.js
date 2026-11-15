/**
 * Phase C3: write rules. Hand-written canonical examples, the escaping rules
 * (A3), keeping the author's YAML (A2), and a round trip per item on examples.
 * Random-input (property) tests are in properties.test.js.
 */

import { describe, it, expect } from 'vitest';
import {
  items, writeDirective, writeFigure, writeAnnotatedImage, writeCallout, writeAttributeContainer,
  writeContainer, writeAlert, writeAttributes, writeWikilink, writeEmbed, listMarker, markerGap,
  writeTable, writeTableCaption, writeBracketCaption, escapeCell, writeInclude, updateYaml,
  figureValue, directiveValue, attrValue, yamlString, markdownAlt, markdownDestination, markdownTitle,
  formatNumber, itemOccurrences
} from '../../src/index.js';
import { editorDialect, roundTripDocument } from './harness.js';

const byId = (id) => items.find((i) => i.id === id);

describe('every item has a write rule (PD9)', () => {
  it('all but attrs-fix, which is a repair step, not something an author writes', () => {
    const without = items.filter((i) => typeof i.write !== 'function').map((i) => i.id);
    expect(without).toEqual(['attrs-fix']);
  });
});

describe('canonical examples (one per item, as documented in its source)', () => {
  it('directives', () => {
    expect(byId('toc').write({ name: 'TOC', attrs: { levels: 3, section: true } })).toBe('<!-- ::TOC levels="3" section -->');
    expect(byId('pagebreak').write({ name: 'PAGEBREAK' })).toBe('<!-- ::PAGEBREAK -->');
    expect(byId('section').write({ name: 'SECTION_START', attrs: { class: 'a', id: 'b' } })).toBe('<!-- ::SECTION_START id="b" class="a" -->');
    expect(byId('section').write({ name: 'SECTION_END' })).toBe('<!-- ::SECTION_END -->');
    expect(byId('cover').write({ name: 'COVER_START' })).toBe('<!-- ::COVER_START -->');
    expect(byId('layout').write({ name: 'LAYOUT', parenParams: 'wide' })).toBe('<!-- ::LAYOUT(wide) -->');
    expect(byId('index').write({ name: 'INDEX' })).toBe('<!-- ::INDEX -->');
    expect(byId('index-marker').write({ name: 'INDEX', attrs: { sort: 'b', term: 'Bolt' } })).toBe('<!-- ::INDEX term="Bolt" sort="b" -->');
    expect(byId('include-directive').write({ name: 'INCLUDE', attrs: { path: 'a.md' } })).toBe('<!-- ::INCLUDE path="a.md" -->');
    expect(writeDirective({ name: 'BREAK', params: '' })).toBe('<!-- ::BREAK -->');
  });

  it('FIGURE', () => {
    expect(writeFigure({ attrs: { src: 'shots/login.png', caption: 'The login page', width: 'half' } }))
      .toBe('<!-- ::FIGURE src="shots/login.png" caption="The login page" width="half" -->');
    expect(byId('figure').write).toBe(writeFigure);
  });

  it('annotated image (new block: canonical YAML)', () => {
    expect(writeAnnotatedImage({
      imagePath: 'shots/app.png',
      data: { options: { caption: 'The main window' }, markers: [{ id: 1, x: 10, y: 20, label: 'Menu' }] }
    })).toBe([
      '::: annotated-image shots/app.png',
      'options:',
      '  caption: "The main window"',
      'markers:',
      '  - { id: 1, x: 10, y: 20, label: "Menu" }',
      ':::'
    ].join('\n'));
  });

  it('include', () => {
    expect(writeInclude({ path: 'parts/intro.md' })).toBe('!!!include(parts/intro.md)!!!');
  });

  it('block callouts', () => {
    expect(writeCallout({ type: 'WARNING', form: 'single' }, 'Hot surface')).toBe('[[WARNING]] Hot surface [[/WARNING]]');
    expect(writeCallout({ type: 'DANGER' }, 'Line one\nLine two')).toBe('[[DANGER]]\nLine one\nLine two\n[[/DANGER]]');
    expect(writeCallout({ type: 'WARNING', form: 'single' }, 'Two\nlines')).toBe('[[WARNING]]\nTwo\nlines\n[[/WARNING]]');
    expect(writeCallout({ type: 'WARNING', typeText: 'warning', form: 'single' }, 'x')).toBe('[[warning]] x [[/warning]]');
  });

  it('containers, attribute containers and alerts', () => {
    expect(writeContainer({ name: 'tip', title: 'Shortcut' }, 'Press **F5**.')).toBe('::: tip Shortcut\nPress **F5**.\n:::');
    expect(writeContainer({ name: 'tip', title: 'Shortcut', markup: ':::', info: 'tip   Shortcut' }, 'x')).toBe(':::tip   Shortcut\nx\n:::');
    expect(writeAttributeContainer({ attrs: [['class', 'note wide'], ['id', 'x']] }, 'Text')).toBe('::: {.note .wide #x}\nText\n:::');
    expect(writeAttributeContainer({ attributes: '{ #x .note }', attrs: [['class', 'note'], ['id', 'x']] }, 'T')).toBe('::: { #x .note }\nT\n:::');
    expect(writeAlert({ type: 'tip' }, 'Save often.')).toBe('> [!TIP]\n> Save often.');
    expect(writeAlert({ type: 'note', title: 'Heads up' }, 'a\n\nb')).toBe('> [!NOTE] Heads up\n> a\n>\n> b');
    expect(writeAlert({ type: 'note', title: 'Note' }, 'a')).toBe('> [!NOTE]\n> a');
  });

  it('tables', () => {
    expect(writeTable({
      columns: [{ align: '' }, { align: 'center' }],
      header: [{ cells: [{ text: 'Name' }, { text: 'Qty' }] }],
      bodies: [[{ cells: [{ text: 'Bolt', colspan: 2 }] }]]
    })).toBe('| Name | Qty |\n| --- | :---: |\n| Bolt ||');
    expect(writeTableCaption({ text: 'Parts', form: 'table' })).toBe('Table: Parts');
    expect(writeBracketCaption({ text: 'Parts', label: 'tbl' })).toBe('[Parts][tbl]');
  });

  it('fancy-list markers', () => {
    expect(listMarker({ type: 'a', start: 3, delimiter: ')' }, 1)).toBe('d)');
    expect(listMarker({ type: 'I', start: 4 }, 0)).toBe('IV.');
    expect(listMarker({}, 2)).toBe('3.');
    expect(markerGap('B.')).toBe('  ');
    expect(markerGap('b.')).toBe(' ');
  });

  it('attributes, wikilinks, embeds, inline callouts', () => {
    expect(writeAttributes([['id', 'intro'], ['class', 'lead wide'], ['data-x', '1']])).toBe('{#intro .lead .wide data-x="1"}');
    expect(writeAttributes([])).toBe('');
    expect(writeWikilink({ target: 'Setup#Install', display: 'installing' })).toBe('[[Setup#Install|installing]]');
    expect(writeWikilink({ target: 'Setup', display: null })).toBe('[[Setup]]');
    expect(writeEmbed({ path: 'img/a.png', alt: 'Chart' })).toBe('![[img/a.png|Chart]]');
    expect(writeEmbed({ path: 'img/a.png', alt: null })).toBe('![[img/a.png]]');
    expect(byId('inline-callout').write({ type: 'DANGER' })).toBe('[!DANGER]');
    expect(byId('inline-callout').write({ type: 'WARNING', markup: '[!warning]' })).toBe('[!warning]');
  });
});

describe('keep the author\'s style (C3 amendment 3)', () => {
  it('directive: untouched parameters keep their text and order; changed ones in place; new ones appended', () => {
    const data = { name: 'TOC', params: "min=2   levels='3' section", attrs: { min: '2', levels: '4', section: true, pages: 'false' } };
    expect(writeDirective(data, ['levels', 'min', 'pages'])).toBe('<!-- ::TOC min=2 levels="4" section pages="false" -->');
  });

  it('directive: removed parameters are dropped', () => {
    expect(writeDirective({ name: 'TOC', params: 'levels="3" min="2"', attrs: { levels: '3' } })).toBe('<!-- ::TOC levels="3" -->');
  });

  it('FIGURE: only the changed parameter is rewritten', () => {
    const raw = "caption='It\"s here' src=img.png   width=half";
    const out = writeFigure({ raw, attrs: { caption: 'It"s here', src: 'img.png', width: 'full' } });
    expect(out).toBe("<!-- ::FIGURE caption='It\"s here' src=img.png width=\"full\" -->");
  });

  it('FIGURE legacy form stays two lines (A9)', () => {
    expect(writeFigure({ raw: 'caption="Old"', attrs: { caption: 'New' }, legacy: true, image: '![alt](old.png)' }))
      .toBe('<!-- ::FIGURE caption="New" -->\n![alt](old.png)');
    // Adding a src makes it the one-line form
    expect(writeFigure({ raw: 'caption="Old"', attrs: { caption: 'Old', src: 'n.png' }, legacy: true, image: '![a](o.png)' }))
      .toBe('<!-- ::FIGURE caption="Old" src="n.png" -->');
  });

  it('FIGURE crop values are written as given (A8), decimals included', () => {
    expect(writeFigure({ attrs: { src: 'a.png', 'crop-x': 33.333, 'crop-y': 50, 'pos-x': '-12px' } }))
      .toBe('<!-- ::FIGURE src="a.png" crop-x="33.333" crop-y="50" pos-x="-12px" -->');
  });
});

describe('escaping (A3)', () => {
  it('FIGURE values: " then \' then ”; --> cut; one line', () => {
    expect(figureValue('plain')).toBe('"plain"');
    expect(figureValue('say "hi"')).toBe('\'say "hi"\'');
    expect(figureValue('it\'s "x"')).toBe('"it\'s ”x”"');
    expect(figureValue('a --> b\nc')).toBe('"a -> b c"');
  });

  it('directive values can hold neither quote', () => {
    expect(directiveValue('it\'s "x"')).toBe('"it’s ”x”"');
  });

  it('attribute values: always "…", " to \', no braces, \\ to /', () => {
    expect(attrValue('a "b" {c} d\\e')).toBe('"a \'b\' c d/e"');
  });

  it('YAML strings keep line breaks as \\n', () => {
    expect(yamlString('a "b" \\ c\nd\tx\u0001')).toBe('"a \\"b\\" \\\\ c\\nd\\tx\\x01"');
  });

  it('markdown alt, destination and title (the image tool\'s rules)', () => {
    expect(markdownAlt('a [[b]] c\\d')).toBe('a [b] c/d');
    expect(markdownAlt('a ] b [')).toBe('a ) b (');
    expect(markdownDestination('my file (1).png')).toBe('<my file (1).png>');
    expect(markdownDestination('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
    expect(markdownTitle('a "b"')).toBe('"a \\"b\\""');
  });

  it('numbers are written exactly (no rounding)', () => {
    expect(formatNumber(33.3333)).toBe('33.3333');
    expect(formatNumber(Infinity)).toBe('0');
  });

  it('table cells: | outside code gets a backslash; a lone ^^ is escaped', () => {
    expect(escapeCell('a | b `c | d` e\\|f')).toBe('a \\| b `c | d` e\\|f');
    expect(escapeCell('^^')).toBe('\\^^');
    expect(escapeCell('^^', false)).toBe('^^');
    // A pipe typed into a cell stays in that cell
    const typed = { columns: [{ align: '' }, { align: '' }], header: [], bodies: [[{ cells: [{ text: 'a | b' }, { text: 'c' }] }]] };
    const back = itemOccurrences(editorDialect().parse(`${writeTable(typed)}\n`, {}))[0].data;
    expect(back.bodies[0][0].cells.map((c) => c.text)).toEqual(['a \\| b', 'c']);
    // "^^" as text in a first row stays as written (no cell above makes it a rowspan)
    const model = { columns: [{ align: '' }], header: [], bodies: [[{ cells: [{ text: '^^' }] }, { cells: [{ text: '\\^^' }] }]] };
    expect(writeTable(model)).toBe('| --- |\n| ^^ |\n| \\^^ |');
  });

  it('a cell spanning columns AND rows: one || per extra column, and the rows below write ^^ then || (pagemd-editor fix run undo-bg-table-split)', () => {
    // Before: the cell's columns were counted twice in its own row (`| x ||| 6 |`, read back as three columns) and the row
    // below lost its || (`| ^^ | 9 |`); the editor's merge of a block of cells wrote that, and the table read back broken.
    const cell = (text, colspan = 1, rowspan = 1) => ({ text, colspan, rowspan });
    const square = {
      columns: [{ align: '' }, { align: '' }, { align: '' }],
      header: [{ cells: [cell('A'), cell('B'), cell('C')] }],
      bodies: [[{ cells: [cell('1'), cell('2'), cell('3')] }, { cells: [cell('x', 2, 2), cell('6')] }, { cells: [cell('9')] }]]
    };
    const text = writeTable(square);
    expect(text).toBe('| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| x || 6 |\n| ^^ || 9 |');
    const back = itemOccurrences(editorDialect().parse(`${text}\n`, {}))[0].data;
    expect(back.bodies[0].map((row) => row.cells.map((c) => [c.text, c.colspan, c.rowspan]))).toEqual([
      [['1', 1, 1], ['2', 1, 1], ['3', 1, 1]],
      [['x', 2, 2], ['6', 1, 1]],
      [['9', 1, 1]]
    ]);
    // Three rows and three columns, in the middle and at the right edge
    const wide = {
      columns: [{ align: '' }, { align: '' }, { align: '' }, { align: '' }],
      header: [],
      bodies: [[{ cells: [cell('a'), cell('big', 3, 3)] }, { cells: [cell('b')] }, { cells: [cell('c')] }, { cells: [cell('d'), cell('e'), cell('f'), cell('g')] }]]
    };
    expect(writeTable(wide)).toBe('| --- | --- | --- | --- |\n| a | big |||\n| b | ^^ |||\n| c | ^^ |||\n| d | e | f | g |');
    const wideBack = itemOccurrences(editorDialect().parse(`${writeTable(wide)}\n`, {}))[0].data;
    expect(wideBack.bodies[0].map((row) => row.cells.map((c) => [c.text, c.colspan, c.rowspan]))).toEqual([
      [['a', 1, 1], ['big', 3, 3]],
      [['b', 1, 1]],
      [['c', 1, 1]],
      [['d', 1, 1], ['e', 1, 1], ['f', 1, 1], ['g', 1, 1]]
    ]);
  });
});

describe('annotated image: the author\'s YAML is kept (A2)', () => {
  const content = [
    '# Screenshot of the login page',
    'options:',
    '  caption: "Login"   # shown under the image',
    'markers:',
    '  - { id: 1, x: 10, y: 20, label: "User" }',
    "  - { id: 2, x: 10, y: 40, label: 'Password' }",
    'boxes:',
    '  - id: 3',
    '    x: 5',
    '    y: 5',
    '    width: 30',
    '    height: 10'
  ].join('\n');
  const tokenFor = (text) => itemOccurrences(editorDialect().parse(`::: annotated-image a.png\n${text}\n:::\n`, {}))[0];
  const original = tokenFor(content);
  const edit = (change) => {
    const data = structuredClone(original.data.data);
    change(data);
    return writeAnnotatedImage({ ...original.data, data });
  };
  const changedLines = (out) => {
    const a = `::: annotated-image a.png\n${content}\n:::`.split('\n');
    const b = out.split('\n');
    return { removed: a.filter((l) => !b.includes(l)), added: b.filter((l) => !a.includes(l)) };
  };

  it('no change: the block is written back byte for byte', () => {
    expect(writeAnnotatedImage(original.data)).toBe(`::: annotated-image a.png\n${content}\n:::`);
  });

  it('moving one marker changes only that value, in its flow map', () => {
    const out = edit((d) => { d.markers[0].x = 12.5; });
    expect(changedLines(out)).toEqual({
      removed: ['  - { id: 1, x: 10, y: 20, label: "User" }'],
      added: ['  - { id: 1, x: 12.5, y: 20, label: "User" }']
    });
  });

  it('a changed string keeps its quote style; comments stay', () => {
    const out = edit((d) => { d.markers[1].label = 'Pass word'; d.options.caption = 'Sign in'; });
    expect(changedLines(out)).toEqual({
      removed: ['  caption: "Login"   # shown under the image', "  - { id: 2, x: 10, y: 40, label: 'Password' }"],
      added: ['  caption: "Sign in"   # shown under the image', "  - { id: 2, x: 10, y: 40, label: 'Pass word' }"]
    });
  });

  it('adding and removing entries touches only those lines', () => {
    expect(changedLines(edit((d) => { d.markers.push({ id: 4, x: 1, y: 2, label: 'New' }); }))).toEqual({
      removed: [], added: ['  - { id: 4, x: 1, y: 2, label: "New" }']
    });
    expect(changedLines(edit((d) => { d.markers.splice(0, 1); }))).toEqual({
      removed: ['  - { id: 1, x: 10, y: 20, label: "User" }'], added: []
    });
    expect(changedLines(edit((d) => { d.markers.splice(1, 0, { id: 9, x: 0, y: 0, label: 'Mid' }); }))).toEqual({
      removed: [], added: ['  - { id: 9, x: 0, y: 0, label: "Mid" }']
    });
  });

  it('a block-style entry changes one line; a new shape list is appended', () => {
    expect(changedLines(edit((d) => { d.boxes[0].width = 31; }))).toEqual({ removed: ['    width: 30'], added: ['    width: 31'] });
    const out = edit((d) => { d.lines = [{ x1: 0, y1: 0, x2: 10, y2: 10 }]; });
    expect(changedLines(out)).toEqual({ removed: [], added: ['lines:', '  - { x1: 0, y1: 0, x2: 10, y2: 10 }'] });
  });

  it('adding and removing a key inside a flow map', () => {
    expect(changedLines(edit((d) => { d.markers[0].color = '#fff'; }))).toEqual({
      removed: ['  - { id: 1, x: 10, y: 20, label: "User" }'],
      added: ['  - { id: 1, x: 10, y: 20, label: "User", color: "#fff" }']
    });
    expect(changedLines(edit((d) => { delete d.markers[0].label; }))).toEqual({
      removed: ['  - { id: 1, x: 10, y: 20, label: "User" }'],
      added: ['  - { id: 1, x: 10, y: 20 }']
    });
  });

  it('removing the last entry of a list removes the key', () => {
    const out = edit((d) => { d.boxes = []; });
    expect(out).not.toMatch(/boxes/);
    expect(out).toMatch(/# Screenshot/);
  });

  it('YAML that could not be read is written fresh in the canonical form', () => {
    const broken = tokenFor('markers: [ { id: 1');
    const out = writeAnnotatedImage({ ...broken.data, data: { markers: [{ id: 1, x: 1, y: 1, label: 'A' }] } });
    expect(out).toBe('::: annotated-image a.png\nmarkers:\n  - { id: 1, x: 1, y: 1, label: "A" }\n:::');
  });

  it('the legacy form (a list of markers at the top) stays a list', () => {
    const legacy = tokenFor('- { id: 1, x: 1, y: 1, label: "A" }  # first');
    const out = writeAnnotatedImage({ ...legacy.data, data: { ...legacy.data.data, markers: [{ id: 1, x: 2, y: 1, label: 'A' }] } });
    expect(out).toBe('::: annotated-image a.png\n- { id: 1, x: 2, y: 1, label: "A" }  # first\n:::');
  });

  it('text notes keep line breaks, and no YAML line can end the block', () => {
    const out = writeAnnotatedImage({ imagePath: 'a.png', data: { text: [{ x: 1, y: 1, text: 'one\n:::\ntwo' }] } });
    expect(out.split('\n').filter((l) => l.trim() === ':::')).toHaveLength(1);
    const back = itemOccurrences(editorDialect().parse(`${out}\n`, {}))[0];
    expect(back.data.data.text[0].text).toBe('one\n:::\ntwo');
  });

  it('updateYaml returns null when a change can\'t be made in place', () => {
    expect(updateYaml('a: [', { a: 1 }, { a: 2 })).toBeNull();
    expect(updateYaml('a: 1', { a: 1 }, { a: { b: 2 } })).toBeNull();
  });
});

describe('round trip on hand-written documents (every item)', () => {
  const doc = [
    '<!-- ::TOC levels="3" section -->',
    '',
    '<!-- ::BREAK -->',
    '',
    '<!-- ::SECTION_START class="x" id="y" -->',
    '',
    '<!-- ::PAGEBREAK -->',
    '',
    '<!-- ::COVER_START -->',
    '',
    '<!-- ::LAYOUT(wide) -->',
    '',
    'Text <!-- ::INDEX term="Bolt" sort="bolt" --> and [[Page|shown]] and ![[img.png|Alt]] [!WARNING] here.',
    '',
    '<!-- ::INDEX -->',
    '',
    '<!-- ::INCLUDE path="x.md" -->',
    '',
    '!!!include(parts/a.md)!!!',
    '',
    '[[WARNING]] Hot [[/WARNING]]',
    '',
    '[[DANGER]]',
    'Two',
    'lines',
    '[[/DANGER]]',
    '',
    '::: {.note #n data-x="1"}',
    'inside',
    ':::',
    '',
    '::: tip Shortcut',
    'Press',
    ':::',
    '',
    '> [!NOTE] Custom',
    '> body',
    '',
    '<!-- ::FIGURE src="a.png" caption="Cap" width=half -->',
    '',
    '<!-- ::FIGURE caption="Legacy" -->',
    '![l](l.png)',
    '',
    '::: annotated-image a.png',
    'markers:',
    '  - { id: 1, x: 10, y: 20, label: "M" }',
    ':::',
    '',
    '# Title {#t .big}',
    '',
    'c. one',
    'd. two',
    '',
    '[Parts][lbl]',
    '| a || b |',
    '|---|:-:|---:+|',
    '| 1 | 2 | 3 |',
    '| ^^ | x | y |',
    '<!-- ::TABLE widths="20% 30% 50%" -->',
    '',
    '| z | w \\',
    '| more | text |',
    '',
    'Table: Second',
    '',
    '|---|',
    '| headerless |',
    '',
    'A note[^n1] and an inline one^[short *note*].',
    '',
    '- [ ] to do',
    '- [x] done',
    '',
    '[^n1]: The note.',
    '',
    '    Its second paragraph.'
  ].join('\n');

  it('every item reads back the same', () => {
    const result = roundTripDocument(doc);
    expect(result.failures).toEqual([]);
    const seen = new Set(itemOccurrences(editorDialect().parse(doc, {})).map((o) => o.item));
    const expected = items.map((i) => i.id).filter((id) => id !== 'attrs-fix' && id !== 'table-captions');
    expect([...expected].filter((id) => !seen.has(id))).toEqual([]);
    expect(result.checked).toBeGreaterThanOrEqual(expected.length);
  });
});
