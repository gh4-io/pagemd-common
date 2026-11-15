/**
 * Tests for createDialect(): order, slots, groups, gates, options
 */

import { describe, it, expect } from 'vitest';
import { createDialect, items, GROUPS, SLOTS } from '../src/index.js';

const names = (ruler) => ruler.__rules__.map((r) => r.name);

/** A slot step that leaves a marker core rule, so its position is visible */
const marker = (name) => (md) => md.core.ruler.push(`slot:${name}`, () => {});

describe('items', () => {
  it('every item has the SyntaxItemDef shape and a known group', () => {
    for (const item of items) {
      expect(typeof item.id).toBe('string');
      expect(GROUPS).toContain(item.group);
      expect(typeof item.read).toBe('function');
      expect(Array.isArray(item.htmlContract)).toBe(true);
      expect(Array.isArray(item.params)).toBe(true);
    }
  });

  it('ids are unique', () => {
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every group has at least one item', () => {
    for (const group of GROUPS) {
      expect(items.some((i) => i.group === group)).toBe(true);
    }
  });
});

describe('slot order', () => {
  it('runs each slot at its named position among the core rules', () => {
    const md = createDialect({
      slots: Object.fromEntries(SLOTS.map((s) => [s, marker(s)]))
    });
    const core = names(md.core.ruler);
    // afterTables runs after table-captions, before attrs; afterAttrs after
    // the attrs fix; beforeContainers before the directive rule.
    expect(core.indexOf('slot:afterTables')).toBeLessThan(core.indexOf('table_attrs_restore'));
    expect(core.indexOf('table_attrs_restore')).toBeLessThan(core.indexOf('slot:afterAttrs'));
    expect(core.indexOf('slot:afterAttrs')).toBeLessThan(core.indexOf('slot:beforeContainers'));
    expect(core.indexOf('slot:beforeContainers')).toBeLessThan(core.indexOf('pagemd_directives'));
  });

  it('matches the pagemd order for the dialect alone', () => {
    const md = createDialect();
    expect(names(md.core.ruler)).toEqual([
      'normalize', 'block', 'github-alerts', 'table_captions', 'strip_references', 'inline',
      'pagemd_task_lists', // editor P26: task boxes, right after inline (before {…} attributes, as markdown-it-task-lists)
      'pagemd_footnote_where', 'footnote_tail', 'pagemd_footnote_lines', // editor P26: notes to the end, with their lines
      'table_attrs_save', 'curly_attributes', 'linkify', 'replacements',
      'smartquotes', 'text_join', 'table_attrs_restore',
      'table_column_widths', // editor P19: a table's widths from its {…} line, after the restore
      'pagemd_figure_numbers', // C9: one figure numbering, after every block token exists
      'pagemd_directives'
    ]);
    expect(names(md.block.ruler).slice(0, 20)).toEqual([
      'table', 'code', 'attribute_container',
      'container_details', 'container_summary', 'container_aside', 'container_columns',
      'container_spoiler', 'container_warning', 'container_caution', 'container_note',
      'container_important', 'container_tip', 'container_document-header',
      'container_title-block', 'container_applicability-box', 'container_approval-block',
      'container_footer-notice', 'block_callout', 'annotated_image'
    ]);
    expect(names(md.inline.ruler)).toEqual([
      'text', 'linkify', 'newline', 'escape', 'backticks', 'strikethrough',
      'inline_callout', 'emphasis', 'wikilink_embed', 'wikilink', 'link',
      'image', 'footnote_inline', 'footnote_ref', // editor P26: ^[…] and [^label] (markdown-it-footnote)
      'autolink', 'html_inline', 'entity'
    ]);
    // editor P26: a note `[^label]: …` is read just before link reference definitions
    const block = names(md.block.ruler);
    expect(block.indexOf('footnote_def')).toBe(block.indexOf('reference') - 1);
  });

  it('accepts an array of steps for one slot, run in order', () => {
    const md = createDialect({ slots: { afterAttrs: [marker('a'), marker('b')] } });
    const core = names(md.core.ruler);
    expect(core.indexOf('slot:a')).toBeLessThan(core.indexOf('slot:b'));
  });
});

describe('options', () => {
  it('rejects unknown modes, groups and slots', () => {
    expect(() => createDialect({ mode: 'preview' })).toThrow(/unknown mode/);
    expect(() => createDialect({ mode: 'editor' })).not.toThrow();
    expect(() => createDialect({ groups: ['nope'] })).toThrow(/unknown group/);
    expect(() => createDialect({ slots: { nope: () => {} } })).toThrow(/unknown slot/);
  });

  it('defaults to html and linkify on', () => {
    const md = createDialect();
    expect(md.options.html).toBe(true);
    expect(md.options.linkify).toBe(true);
    expect(md.options.typographer).toBe(false);
  });

  it('passes markdownIt options through', () => {
    const md = createDialect({ options: { markdownIt: { html: false, typographer: true } } });
    expect(md.options.html).toBe(false);
    expect(md.options.typographer).toBe(true);
  });

  it('only registers gated fancy lists when the field is on', () => {
    const off = createDialect();
    const on = createDialect({ options: { fields: { fancy_lists: true } } });
    expect(off.render('a. one\nb. two')).not.toContain('<ol');
    expect(on.render('a. one\nb. two')).toContain('<ol type="a" class="list-lower-alpha">');
  });

  it('passes wikilink options to both links and embeds', () => {
    const md = createDialect({
      options: { wikilinks: { baseUrl: '/wiki', imageBaseUrl: '/img', generateSlugs: false } }
    });
    const html = md.render('[[Page]] ![[a.png]]');
    expect(html).toContain('href="/wiki/Page"');
    expect(html).toContain('src="/img/a.png"');
  });
});

describe('groups', () => {
  it('registers only the chosen groups', () => {
    const md = createDialect({ groups: ['page'] });
    expect(md.render('<!-- ::PAGEBREAK -->')).toContain('break-page');
    expect(md.render('[[WARNING]] x')).not.toContain('callout');
    expect(names(md.block.ruler)).not.toContain('attribute_container');
  });

  it('an INDEX term without the text group is an unknown directive', () => {
    const md = createDialect({ groups: ['page'] });
    expect(md.render('<!-- ::INDEX -->')).toContain('index-placeholder');
    expect(md.render('<!-- ::INDEX term="x" -->')).toContain('Unknown directive: INDEX');
  });
});

describe('per-render state', () => {
  it('resets LAYOUT and figure numbering between renders', () => {
    const md = createDialect();
    const doc = '<!-- ::LAYOUT(wide) -->\n\n<!-- ::FIGURE src="a.png" caption="A" -->\n';
    expect(md.render(doc)).toBe(md.render(doc));
    expect(md.render(doc)).not.toContain('</div>\n<div class="page-wide">');
  });
});
