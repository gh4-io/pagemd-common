/**
 * Every pagemd item in a list of editor-mode tokens, with the data its write
 * rule takes (phase C3). This is the contract between reading and writing:
 *
 *   for (const o of itemOccurrences(tokens)) itemById(o.item).write(o.data, content)
 *
 * gives the item's markdown back (`content` = the inner markdown of wrappers:
 * callouts, containers, alerts). Plain markdown (paragraphs, lists, links, …)
 * is not listed: the editor writes that itself.
 *
 * | item               | token                          | data                                           |
 * |--------------------|--------------------------------|------------------------------------------------|
 * | directive items    | pagemd_directive(_inline)      | { name, parenParams, params, attrs }           |
 * | figure             | figure_open                    | { attrs, raw, legacy, image, form?, imageRead? } |
 * | annotated-image    | annotated_image                | { imagePath, content, data }                   |
 * | include            | pagemd_include                 | { path }                                       |
 * | callouts           | callout_open                   | { type, typeText, form }                       |
 * | attribute-container| div_open (markup ':::')        | { attributes, attrs }                          |
 * | containers         | container_<name>_open          | { name, title, markup, info }                  |
 * | github-alerts      | alert_open                     | { type, title }                                |
 * | multimd-table      | table_open                     | the table model (see tables/table-model.js)    |
 * | table-directive    | table_open (meta.tableDirective)| { name, parenParams, params, attrs }          |
 * | fancy-lists        | ordered_list_open with a type  | { type, start, delimiter }                     |
 * | attributes         | any token with {…} attributes  | { attrs } (only heading/paragraph listed here) |
 * | wikilinks          | link_open (meta.wikilink)      | { target, display }                            |
 * | embeds             | image (meta.embed)             | { path, alt }                                  |
 * | inline-callout     | inline_callout                 | { type, markup }                               |
 * | footnotes          | footnote_reference_open        | { form: 'definition', label }                  |
 * | footnotes          | footnote_ref (inline)          | { form: 'ref', label } / { form: 'inline', content } |
 * | task-lists         | list_item_open (meta.task)     | { checked, mark, gap }                         |
 */

import { readContainerInfo } from '../blocks/containers-write.js';

/**
 * @param {object[]} tokens - Editor-mode block tokens (markdown-it `parse` output)
 * @returns {{item: string, data: object, token: object, index: number, inline: boolean}[]}
 */
export function itemOccurrences(tokens) {
  const out = [];
  const add = (item, data, token, index, inline = false) => out.push({ item, data, token, index, inline });

  tokens.forEach((t, i) => {
    const m = t.meta || {};
    switch (t.type) {
      case 'pagemd_directive':
        add(m.item || 'unknown-directive', directiveData(m), t, i);
        break;
      case 'figure_open':
        add('figure', { attrs: m.attrs, raw: m.raw, legacy: m.legacy, image: m.image, form: m.form, imageRead: m.imageRead }, t, i);
        break;
      case 'annotated_image':
        add('annotated-image', { imagePath: m.imagePath, content: t.content, data: m.data }, t, i);
        break;
      case 'pagemd_include':
        add('include', { path: m.path }, t, i);
        break;
      case 'callout_open':
        add('callouts', { type: m.type, typeText: m.typeText, form: m.form }, t, i);
        break;
      case 'div_open':
        if (t.markup === ':::' && m.attributes !== undefined) {
          add('attribute-container', { attributes: m.attributes, attrs: t.attrs || [] }, t, i);
        }
        break;
      case 'footnote_reference_open':
        add('footnotes', { form: 'definition', label: m.label }, t, i);
        break;
      case 'list_item_open':
        if (m.task) add('task-lists', { ...m.task }, t, i);
        break;
      case 'alert_open':
        add('github-alerts', { type: m.type, title: m.title }, t, i);
        break;
      case 'table_open':
        if (m.table) add('multimd-table', m.table, t, i);
        // P19: the <!-- ::TABLE … --> comment folded into the table (table-directive.js)
        if (m.tableDirective) add('table-directive', m.tableDirective, t, i);
        break;
      case 'ordered_list_open':
        if (t.attrGet('type')) {
          // The plugin records " " as the markup after "A.  " (capital letter, two spaces): the delimiter is "." unless ")"
          add('fancy-lists', { type: t.attrGet('type'), start: Number(t.attrGet('start') || 1), delimiter: t.markup === ')' ? ')' : '.' }, t, i);
        }
        break;
      case 'heading_open':
      case 'paragraph_open':
        if (t.attrs && t.attrs.length) add('attributes', { attrs: t.attrs }, t, i);
        break;
      default:
        if (/^container_.+_open$/.test(t.type)) {
          const { name, title } = readContainerInfo(t.info);
          add('containers', { name, title, markup: t.markup, info: t.info }, t, i);
        }
    }
    for (const c of t.children || []) {
      const cm = c.meta || {};
      if (c.type === 'pagemd_directive_inline') add(cm.item || 'unknown-directive', directiveData(cm), c, i, true);
      else if (c.type === 'link_open' && cm.wikilink) add('wikilinks', { target: cm.target, display: cm.display }, c, i, true);
      else if (c.type === 'image' && cm.embed) add('embeds', { path: cm.path, alt: cm.alt }, c, i, true);
      else if (c.type === 'inline_callout') add('inline-callout', { type: c.content, markup: c.markup }, c, i, true);
      else if (c.type === 'footnote_ref') {
        add('footnotes', cm.inline || cm.label === undefined ? { form: 'inline', content: cm.content ?? '' } : { form: 'ref', label: cm.label }, c, i, true);
      }
    }
  });
  return out;
}

/**
 * The write data of a directive token
 * @param {object} m - Its meta
 * @returns {object}
 */
function directiveData(m) {
  return { name: m.name, parenParams: m.parenParams, params: m.params, attrs: m.attrs };
}
