/**
 * Phase C3: property tests. For each item, fast-check generates many random
 * items; each is written, read again (editor mode) and must give the same
 * data back: parse(write(x)) ≅ x.
 *
 * Generated values stay inside what each syntax can hold (see each write
 * rule's notes); the escaping tests (write-rules.test.js) cover the rest.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { itemOccurrences, CONTAINER_TYPES, sameData, listMarker } from '../../src/index.js';
import { editorDialect, roundTripOccurrence, comparable } from './harness.js';

const md = editorDialect();
const RUNS = { numRuns: 200 };

// ── generators ──
const word = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,7}$/);
const words = fc.array(word, { minLength: 1, maxLength: 4 }).map((w) => w.join(' '));
const key = fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/);
const safeValue = fc.stringMatching(/^[A-Za-z0-9._/-][A-Za-z0-9 ._/-]{0,10}[A-Za-z0-9._/-]$/);
const pathLike = fc.stringMatching(/^[a-z][a-z0-9_-]{0,6}(\/[a-z0-9_-]{1,6}){0,2}\.(png|md|jpg)$/);
const pct = fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true });
const anyText = fc.string({ unit: 'grapheme', maxLength: 20 });

/**
 * Write → read → compare, for one occurrence built by hand
 */
function roundTrips(item, data, content, token = { type: '', map: [0, 1], meta: {} }) {
  const o = { item, data, token, index: 0 };
  const result = roundTripOccurrence(o, content, md);
  if (!result.ok) throw new Error(`not the same after a round trip:\n${result.written}\n${JSON.stringify(result.before)}\n${JSON.stringify(result.after)}`);
  return true;
}

describe('directives', () => {
  const directives = [
    ['toc', 'TOC'], ['pagebreak', 'PAGEBREAK'], ['section', 'SECTION_START'], ['section', 'SECTION_END'],
    ['cover', 'COVER_START'], ['layout', 'LAYOUT'], ['include-directive', 'INCLUDE'], ['index', 'INDEX']
  ];
  it('any parameters (values, flags, parentheses) read back', () => {
    fc.assert(fc.property(
      fc.constantFrom(...directives),
      fc.dictionary(key.filter((k) => k !== 'term'), fc.oneof(safeValue, fc.constant(true)), { maxKeys: 4 }),
      fc.option(safeValue.filter((v) => !v.includes(')')), { nil: null }),
      ([item, name], attrs, paren) => roundTrips(item, { name, parenParams: paren, params: '', attrs })
    ), RUNS);
  });

  it('index markers (with a term) read back', () => {
    fc.assert(fc.property(safeValue, fc.option(safeValue, { nil: undefined }), (term, sort) =>
      roundTrips('index-marker', { name: 'INDEX', params: '', attrs: sort ? { term, sort } : { term } })), RUNS);
  });

  it('a changed value keeps every other parameter as written', () => {
    fc.assert(fc.property(fc.dictionary(key, safeValue, { minKeys: 2, maxKeys: 5 }), safeValue, (attrs, next) => {
      const params = Object.entries(attrs).map(([k, v]) => `${k}='${v}'`).join('  ');
      const [first, ...rest] = Object.keys(attrs);
      const written = itemOccurrences(md.parse(`<!-- ::TOC ${params} -->\n`, {}))[0];
      const out = roundTripOccurrence({ ...written, data: { ...written.data, attrs: { ...written.data.attrs, [first]: next } } }, undefined, md);
      for (const k of rest) expect(out.written).toContain(`${k}='${attrs[k]}'`);
      return out.ok;
    }), RUNS);
  });
});

describe('FIGURE', () => {
  const figKey = fc.constantFrom('src', 'caption', 'id', 'alt', 'width', 'height', 'crop-x', 'crop-y', 'pos-x', 'link', 'data-x');
  const figValue = fc.oneof(safeValue, safeValue.map((v) => `${v}"q`), safeValue.map((v) => `it's ${v}`));
  it('any parameters read back (either kind of quote)', () => {
    fc.assert(fc.property(fc.dictionary(figKey, figValue, { minKeys: 1, maxKeys: 6 }), (attrs) =>
      roundTrips('figure', { attrs, raw: '', legacy: false, image: '' })), RUNS);
  });

  it('the legacy two-line form reads back', () => {
    fc.assert(fc.property(safeValue, pathLike, (caption, src) =>
      roundTrips('figure', { attrs: { caption }, raw: '', legacy: true, image: `![img](${src})` })), RUNS);
  });
});

describe('annotated images', () => {
  const marker = fc.record({ id: fc.integer({ min: 1, max: 99 }), x: pct, y: pct, label: anyText });
  const box = fc.record({ x: pct, y: pct, width: pct, height: pct, color: fc.constantFrom('#f00', 'red'), label: anyText }, { requiredKeys: ['x', 'y', 'width', 'height'] });
  const note = fc.record({ x: pct, y: pct, text: anyText });
  const data = fc.record({
    options: fc.record({ caption: anyText, markerColor: fc.constant('#123456'), legendColumns: fc.integer({ min: 1, max: 12 }) }, { requiredKeys: [] }),
    markers: fc.array(marker, { maxLength: 4 }),
    boxes: fc.array(box, { maxLength: 3 }),
    text: fc.array(note, { maxLength: 2 })
  });

  it('new blocks (canonical YAML) read back', () => {
    fc.assert(fc.property(pathLike, data, (imagePath, d) =>
      roundTrips('annotated-image', { imagePath, data: d })), RUNS);
  });

  it('edits to an author\'s block read back and keep every untouched line', () => {
    const author = [
      '# notes kept',
      'options: { caption: "Start" }',
      'markers:',
      '  - { id: 1, x: 10, y: 20, label: "One" }   # first',
      '  - id: 2',
      '    x: 30',
      '    y: 40',
      '    label: Two',
      'boxes: []'
    ].join('\n');
    const base = itemOccurrences(md.parse(`::: annotated-image a.png\n${author}\n:::\n`, {}))[0];
    fc.assert(fc.property(data, (d) => {
      const o = { ...base, data: { ...base.data, data: d } };
      const result = roundTripOccurrence(o, undefined, md);
      return result.ok && sameData(comparable(o), result.after);
    }), RUNS);
  });
});

describe('blocks', () => {
  const inlineText = words;
  it('callouts', () => {
    fc.assert(fc.property(fc.constantFrom('WARNING', 'DANGER'), fc.constantFrom('single', 'multi'),
      fc.array(inlineText, { minLength: 1, maxLength: 3 }), (type, form, lines) => {
        const text = form === 'single' ? lines[0] : lines.join('\n');
        const token = { type: 'callout_open', map: [0, 1], meta: {} };
        return roundTrips('callouts', { type, typeText: type, form }, text, token);
      }), RUNS);
  });

  it('named containers', () => {
    fc.assert(fc.property(fc.constantFrom(...CONTAINER_TYPES), fc.option(words, { nil: '' }), inlineText, (name, title, body) => {
      const lines = [`::: ${name}${title ? ` ${title}` : ''}`, body, ':::'];
      const o = itemOccurrences(md.parse(`${lines.join('\n')}\n`, {}))[0];
      return roundTrips('containers', { name, title, markup: ':::' }, body, o.token);
    }), RUNS);
  });

  it('attribute containers', () => {
    const cls = fc.array(fc.stringMatching(/^[a-z][a-z0-9_-]{0,6}$/), { maxLength: 3 });
    const kv = fc.dictionary(fc.stringMatching(/^[a-z][a-z0-9-]{0,6}$/).filter((k) => k !== 'class' && k !== 'id'),
      fc.stringMatching(/^[A-Za-z0-9 _/:-]{0,10}$/), { maxKeys: 3 });
    fc.assert(fc.property(cls, fc.option(fc.stringMatching(/^[a-z][a-z0-9_-]{0,6}$/), { nil: null }), kv, inlineText, (classes, id, pairs, body) => {
      const attrs = [];
      if (classes.length) attrs.push(['class', classes.join(' ')]);
      if (id) attrs.push(['id', id]);
      for (const [k, v] of Object.entries(pairs)) attrs.push([k, v]);
      const token = { type: 'div_open', map: [0, 3], meta: { closed: true } };
      return roundTrips('attribute-container', { attrs }, body, token);
    }), RUNS);
  });

  it('GitHub alerts', () => {
    fc.assert(fc.property(fc.constantFrom('note', 'tip', 'important', 'warning', 'caution'), fc.option(words, { nil: undefined }), inlineText, (type, title, body) => {
      const token = { type: 'alert_open', map: [0, 2], meta: {} };
      const expectedTitle = title || type.charAt(0).toUpperCase() + type.slice(1);
      return roundTrips('github-alerts', { type, title: expectedTitle }, body, token);
    }), RUNS);
  });
});

describe('text and media', () => {
  it('include', () => {
    fc.assert(fc.property(pathLike, (path) => roundTrips('include', { path })), RUNS);
  });

  it('wikilinks', () => {
    fc.assert(fc.property(words, fc.option(words, { nil: null }), (target, display) =>
      roundTrips('wikilinks', { target, display })), RUNS);
  });

  it('embeds', () => {
    fc.assert(fc.property(pathLike, fc.option(words, { nil: null }), (path, alt) =>
      roundTrips('embeds', { path, alt })), RUNS);
  });

  it('inline callouts', () => {
    fc.assert(fc.property(fc.constantFrom('WARNING', 'DANGER'), (type) => roundTrips('inline-callout', { type })), RUNS);
  });

  it('attributes on paragraphs and headings', () => {
    const val = fc.stringMatching(/^[A-Za-z0-9 /:-]{1,10}$/).filter((v) => v.trim() === v);
    fc.assert(fc.property(
      // no "_": a pair like _0_ reads as emphasis before the attributes (a reader limit, see text/attributes.js)
      fc.option(fc.stringMatching(/^[a-z][a-z0-9-]{0,6}$/), { nil: null }),
      fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{0,6}$/), { maxLength: 3 }),
      fc.dictionary(fc.stringMatching(/^data-[a-z]{1,5}$/), val, { maxKeys: 2 }),
      fc.boolean(),
      (id, classes, kv, heading) => {
        const attrs = [];
        if (id) attrs.push(['id', id]);
        if (classes.length) attrs.push(['class', [...new Set(classes)].join(' ')]);
        attrs.push(...Object.entries(kv));
        fc.pre(attrs.length > 0);
        const token = heading ? { type: 'heading_open', markup: '##', map: [0, 1] } : { type: 'paragraph_open', map: [0, 1] };
        return roundTrips('attributes', { attrs }, undefined, token);
      }), RUNS);
  });

  it('fancy-list markers', () => {
    const alpha = fc.integer({ min: 1, max: 26 }).filter((n) => n !== 9); // "i." / "I." read as Roman
    fc.assert(fc.property(
      fc.oneof(
        fc.tuple(fc.constantFrom('a', 'A'), alpha),
        // The reader looks at 10 characters: Roman markers of up to 9 letters (see fancy-lists-write.js)
        fc.tuple(fc.constantFrom('i', 'I'), fc.integer({ min: 1, max: 3999 }).filter((n) => {
          const m = listMarker({ type: 'i', start: n });
          return m.length <= 10 && (n === 1 || m.length > 2); // one letter other than i reads as a letter
        }))
      ),
      fc.constantFrom('.', ')'),
      ([type, start], delimiter) => roundTrips('fancy-lists', { type, start, delimiter })
    ), RUNS);
  });
});

describe('tables', () => {
  /** Build a valid table model from random choices */
  const table = fc.record({
    ncols: fc.integer({ min: 1, max: 4 }),
    headerRows: fc.integer({ min: 0, max: 2 }),
    groups: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 1, maxLength: 2 }),
    picks: fc.array(fc.nat(), { minLength: 80, maxLength: 80 }),
    texts: fc.array(fc.oneof(words, words.map((w) => `${w} \\| pipe`), words.map((w) => `\`a|b\` ${w}`), fc.constant('\\^^')), { minLength: 80, maxLength: 80 }),
    aligns: fc.array(fc.constantFrom('', 'left', 'right', 'center'), { minLength: 4, maxLength: 4 }),
    wraps: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
    multiline: fc.boolean(),
    caption: fc.option(fc.record({ text: words, position: fc.constantFrom('top', 'bottom'), label: fc.option(fc.stringMatching(/^[a-z]{1,6}$/), { nil: null }) }), { nil: null }),
    tableCaption: fc.option(fc.record({ text: words, form: fc.constantFrom('table', 'colon'), position: fc.constantFrom('top', 'bottom') }), { nil: null })
  }).map((r) => {
    let p = 0;
    let t = 0;
    const pick = (n) => r.picks[p++ % r.picks.length] % n;
    const text = () => r.texts[t++ % r.texts.length];
    const group = (rows, allowMultiline) => {
      const covered = new Array(r.ncols).fill(0);
      const out = [];
      for (let i = 0; i < rows; i++) {
        const cells = [];
        const multiline = allowMultiline && r.multiline && i === 0;
        for (let c = 0; c < r.ncols;) {
          if (covered[c] > 0) { covered[c]--; c++; continue; }
          let colspan = 1;
          while (c + colspan < r.ncols && covered[c + colspan] === 0 && pick(3) === 0) colspan++;
          const rowspan = i + 1 < rows && colspan === 1 && pick(3) === 0 ? 2 : 1;
          if (rowspan > 1) covered[c] = 1;
          const first = text();
          cells.push({ text: multiline ? `${first}\n${text()}`.replace(/^\^\^$/m, 'x') : first, colspan, rowspan });
          c += colspan;
        }
        out.push({ cells, multiline });
      }
      return out;
    };
    const cap = r.caption;
    return {
      columns: Array.from({ length: r.ncols }, (_, k) => ({ align: r.aligns[k], wrap: r.wraps[k] })),
      header: group(r.headerRows, false),
      bodies: r.groups.map((n) => group(n, true)),
      caption: cap,
      tableCaption: r.tableCaption
    };
  });

  it('colspan, rowspan, alignment, headerless, multi-line rows, several bodies and captions read back', () => {
    fc.assert(fc.property(table, (model) => {
      const written = roundTripOccurrence({ item: 'multimd-table', data: model, token: { type: 'table_open', map: [0, 1] }, index: 0 }, undefined, md);
      if (!written.ok) throw new Error(`${written.written}\n${JSON.stringify(written.before)}\n${JSON.stringify(written.after)}`);
      return true;
    }), { numRuns: 300 });
  });
});

describe('control: a broken write rule is caught', () => {
  it('a figure writer that loses the caption fails its round trip', () => {
    const o = itemOccurrences(md.parse('<!-- ::FIGURE src="a.png" caption="C" -->\n', {}))[0];
    const broken = { ...o, data: { ...o.data, raw: '', attrs: { src: 'a.png' } } };
    const result = roundTripOccurrence(broken, undefined, md);
    expect(sameData(comparable(o), result.after)).toBe(false);
  });
});
