/**
 * The text rules of !!!include(path)!!! (phase C12, src/document/include-rules.js): frontmatter, image paths,
 * page type, which lines count. pagemd's expander (packages/parser/src/include.js) and pagemd-editor's canvas use them.
 */

import { describe, it, expect } from 'vitest';
import {
  splitLines, splitFrontmatter, isFixedRef, rebasePath, analyzeIncludes, rebaseImageRefs, pageTypeAt, pageTypeAtEnd,
  layoutRestore, includeErrorBlock
} from '../src/index.js';

describe('splitFrontmatter: the included file\'s settings are removed, never read', () => {
  it('removes the --- block (LF, CRLF, byte order mark)', () => {
    expect(splitFrontmatter('---\ntitle: x\n---\nBody\n')).toEqual({ body: 'Body\n', frontmatter: true });
    expect(splitFrontmatter('---\r\ntitle: x\r\n---\r\nBody\r\n')).toEqual({ body: 'Body\r\n', frontmatter: true });
    expect(splitFrontmatter('\ufeff---\ntitle: x\n---\n\nBody\n')).toEqual({ body: '\nBody\n', frontmatter: true });
  });

  it('broken YAML does not matter (it is not read)', () => {
    expect(splitFrontmatter('---\ntitle: [unclosed\n: : :\n---\nBody\n').body).toBe('Body\n');
  });

  it('gray-matter\'s delimiters: ---- is not frontmatter; without a closing line the whole rest is', () => {
    expect(splitFrontmatter('----\nText\n')).toEqual({ body: '----\nText\n', frontmatter: false });
    expect(splitFrontmatter('Text\n---\nmore\n')).toEqual({ body: 'Text\n---\nmore\n', frontmatter: false });
    expect(splitFrontmatter('---\nonly: yaml\n')).toEqual({ body: '', frontmatter: true });
  });

  it('a byte order mark alone is removed', () => {
    expect(splitFrontmatter('\ufeffText\n')).toEqual({ body: 'Text\n', frontmatter: false });
  });
});

describe('rebasePath', () => {
  it.each([
    ['pic.png', 'sub', 'sub/pic.png'],
    ['./pic.png', 'sub', 'sub/pic.png'],
    ['../pic.png', 'sub/deeper', 'sub/pic.png'],
    ['../../pic.png', 'sub', '../pic.png'],
    ['img/a b.png', 'my docs', 'my docs/img/a b.png'],
    ['pic.png', '../shared', '../shared/pic.png'],
    ['pic.png', '', 'pic.png']
  ])('%s from %s is %s', (src, dir, out) => {
    expect(rebasePath(src, dir)).toBe(out);
  });

  it.each(['https://example.com/a.png', '//cdn/a.png', 'data:image/png;base64,AA', '/root.png', 'C:\\x\\a.png', 'file:///a.png', '#anchor', '', '  '])(
    '%j is left alone', (src) => {
      expect(isFixedRef(src)).toBe(true);
      expect(rebasePath(src, 'sub')).toBe(src);
    }
  );
});

describe('rebaseImageRefs: the five image forms, never inside code', () => {
  const text = [
    '![a](pic.png) and `![c](code.png)` and ![s](<my pic.png>) ![e](a%20b.png "title")',
    '',
    '<!-- ::FIGURE src="fig.png" caption="A figure" -->',
    '',
    '<!-- ::FIGURE caption="legacy form" -->',
    '![l](legacy.png)',
    '',
    '::: annotated-image ann.png',
    '- { id: 1, x: 10, y: 10, label: "A" }',
    ':::',
    '',
    '![[emb.png|alt]] ![[ emb2.png ]]',
    '',
    '<img src="h.png"> <img src=\'h2.png\' alt=x> <img src=h3.png>',
    '',
    '```',
    '![f](fence.png) <img src="fence.png">',
    '```',
    '',
    '    ![i](indented-code.png)',
    '',
    '![u](https://x/y.png) ![d](data:image/png;base64,AA) ![r](/root.png) ![p](../up.png) ![dot](./d.png)',
    '',
    '| t | u |',
    '|---|---|',
    '| ![t](tab.png) | x |',
    ''
  ].join('\n');

  it('rewrites every reference relative to the main file, and nothing else', () => {
    expect(rebaseImageRefs(text, 'sub').split('\n')).toEqual([
      '![a](sub/pic.png) and `![c](code.png)` and ![s](<sub/my pic.png>) ![e](sub/a%20b.png "title")',
      '',
      '<!-- ::FIGURE src="sub/fig.png" caption="A figure" -->',
      '',
      '<!-- ::FIGURE caption="legacy form" -->',
      '![l](sub/legacy.png)',
      '',
      '::: annotated-image sub/ann.png',
      '- { id: 1, x: 10, y: 10, label: "A" }',
      ':::',
      '',
      '![[sub/emb.png|alt]] ![[ sub/emb2.png ]]',
      '',
      '<img src="sub/h.png"> <img src=\'sub/h2.png\' alt=x> <img src=sub/h3.png>',
      '',
      '```',
      '![f](fence.png) <img src="fence.png">',
      '```',
      '',
      '    ![i](indented-code.png)',
      '',
      '![u](https://x/y.png) ![d](data:image/png;base64,AA) ![r](/root.png) ![p](up.png) ![dot](sub/d.png)',
      '',
      '| t | u |',
      '|---|---|',
      '| ![t](sub/tab.png) | x |',
      ''
    ]);
  });

  it('a folder with a space: encoded in a link, quoted in a bare attribute', () => {
    const out = rebaseImageRefs('![a](pic.png) <img src=h.png> ![p](../up.png)\n', 'my docs/deep');
    expect(out).toBe('![a](my%20docs/deep/pic.png) <img src="my docs/deep/h.png"> ![p](my%20docs/up.png)\n');
  });

  it('keeps every line ending as it was (CRLF)', () => {
    expect(rebaseImageRefs('A ![a](p.png)\r\n\r\nB\r\n', 'sub')).toBe('A ![a](sub/p.png)\r\n\r\nB\r\n');
  });

  it('the same folder (\'\') changes nothing', () => {
    expect(rebaseImageRefs(text, '')).toBe(text);
  });
});

describe('analyzeIncludes: which include lines count (the editor\'s rule)', () => {
  const text = [
    '!!!include(a.md)!!!',
    'A paragraph !!!include(mid.md)!!! line.',
    '',
    '```',
    '!!!include(fenced.md)!!!',
    '```',
    '',
    'Inline `!!!include(code.md)!!!` code.',
    '',
    '  !!!include(indented.md)!!!  ',
    '',
    '- item',
    '',
    '  !!!include(in-list.md)!!!',
    ''
  ].join('\n');

  it('only a line that is just the include, outside code', () => {
    const a = analyzeIncludes(text);
    expect(a.includes.map((i) => [i.line, i.path])).toEqual([[0, 'a.md'], [9, 'indented.md'], [13, 'in-list.md']]);
    expect(a.includes[1]).toMatchObject({ start: 2, end: 28 });
    expect(a.notAlone.map((n) => [n.line, n.text])).toEqual([
      [1, '!!!include(mid.md)!!!'], [4, '!!!include(fenced.md)!!!'], [7, '!!!include(code.md)!!!']
    ]);
  });

  it('a line straight after a paragraph line is part of the paragraph (as in the editor)', () => {
    const a = analyzeIncludes('Text\n!!!include(a.md)!!!\n');
    expect(a.includes).toEqual([]);
    expect(a.notAlone.map((n) => n.line)).toEqual([1]);
  });
});

describe('page type at a point (LAYOUT), code ignored', () => {
  const text = [
    'Plain.',
    '',
    '<!-- ::LAYOUT(wide) -->',
    '',
    '```',
    '<!-- ::LAYOUT(legal) -->',
    '```',
    '',
    '!!!include(x.md)!!!',
    '',
    '<!-- ::LAYOUT name="tall" -->',
    ''
  ].join('\n');

  it('reads the LAYOUT in force before a line and at the end', () => {
    const a = analyzeIncludes(text);
    expect(a.layouts).toEqual([{ line: 2, name: 'wide' }, { line: 10, name: 'tall' }]);
    expect(pageTypeAt(a, 0)).toBe(null);
    expect(pageTypeAt(a, 8)).toBe('wide');
    expect(pageTypeAtEnd(a)).toBe('tall');
    expect(pageTypeAtEnd(analyzeIncludes('No layout.\n'), 'wide')).toBe('wide');
    expect(pageTypeAtEnd(analyzeIncludes('<!-- ::LAYOUT -->\n'))).toBe('default');
  });

  it('layoutRestore: nothing when the page type is the same (none = default), else the LAYOUT to go back', () => {
    expect(layoutRestore(null, null)).toBe('');
    expect(layoutRestore(null, 'default')).toBe('');
    expect(layoutRestore('wide', 'wide')).toBe('');
    expect(layoutRestore(null, 'wide')).toBe('<!-- ::LAYOUT(default) -->');
    expect(layoutRestore('wide', 'default')).toBe('<!-- ::LAYOUT(wide) -->');
  });
});

describe('includeErrorBlock', () => {
  it('a visible block with inline styles and the path as written (escaped)', () => {
    expect(includeErrorBlock('not-found', 'sub/<x>.md')).toBe('<div class="include-error" role="note" style="border:1px dashed #b00;color:#b00;padding:.4em">Include not found: sub/&lt;x&gt;.md</div>');
    expect(includeErrorBlock('circular', 'a.md')).toContain('Include goes round in a circle: a.md');
  });
});

describe('splitLines', () => {
  it('keeps each line\'s own ending', () => {
    expect(splitLines('a\r\nb\nc\rd')).toEqual(['a\r\n', 'b\n', 'c\r', 'd']);
    expect(splitLines('')).toEqual([]);
  });
});
