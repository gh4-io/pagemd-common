/**
 * fillTemplate (moved from pagemd's renderer-web in pagemd-editor phase P18): the token rules pagemd's templates use.
 * pagemd's CLI snapshots prove the move changed no output; these pin the rules for both users (pagemd and the editor).
 */

import { describe, it, expect } from 'vitest';
import { fillTemplate, templateData, withColorScheme, PATH_TOKENS } from '../src/index.js';

const data = templateData({
  content: '<p>Body</p>',
  styles: '<style>x</style>',
  metadata: { title: 'Harvest', company_name: 'UOFO', count: 0, empty: '', nested: { deep: 'yes' } },
  profile: { id: 'p' }
});

describe('fillTemplate', () => {
  it('fills nested values, content and styles', () => {
    const { html, missing } = fillTemplate('<h1>{{metadata.title}}</h1>{{styles}}<main>{{content}}</main>{{metadata.nested.deep}}', data);
    expect(html).toBe('<h1>Harvest</h1><style>x</style><main><p>Body</p></main>yes');
    expect(missing).toEqual([]);
  });

  it('?? gives the default only for a missing (null/undefined) value, with either quote', () => {
    expect(fillTemplate(`{{metadata.missing ?? 'Uncertified'}}|{{metadata.title ?? "x"}}|{{metadata.count ?? "z"}}`, data).html).toBe('Uncertified|Harvest|0');
    expect(fillTemplate('{{metadata.missing ?? metadata.title}}', data).html).toBe('metadata.title');
  });

  it('a ternary chooses by truthiness', () => {
    expect(fillTemplate(`{{metadata.title ? "yes" : "no"}}{{metadata.empty ? 'a' : 'b'}}`, data).html).toBe('yesb');
  });

  it('#if blocks keep or drop their content, nested ones innermost first', () => {
    const t = '{{#if metadata.title}}A{{#if metadata.empty}}B{{/if}}C{{/if}}{{#if metadata.count}}D{{/if}}';
    expect(fillTemplate(t, data).html).toBe('AC');
  });

  it('reports each missing token once and writes nothing for it', () => {
    const { html, missing } = fillTemplate('[{{metadata.a}}][{{metadata.a}}][{{metadata.b}}]', data);
    expect(html).toBe('[][][]');
    expect(missing).toEqual(['metadata.a', 'metadata.b']);
  });

  it('keeps path tokens and unclosed block markers for the caller; expand runs last', () => {
    expect(PATH_TOKENS).toContain('PROJECT_ROOT');
    expect(fillTemplate('{{PROJECT_ROOT}}/x {{#if a}}', data).html).toBe('{{PROJECT_ROOT}}/x {{#if a}}');
    expect(fillTemplate('{{PROJECT_ROOT}}/x', data, { expand: (s) => s.replace('{{PROJECT_ROOT}}', '/root') }).html).toBe('/root/x');
  });

  it('logs the same conditional debug lines pagemd logged', () => {
    const lines = [];
    fillTemplate('{{#if metadata.title}}x{{/if}}', data, { log: { debug: (line) => lines.push(line) } });
    expect(lines).toEqual(['Block conditional: {{#if metadata.title}} = true']);
  });

  it('withColorScheme adds the attribute to <html>, with or without attributes', () => {
    expect(withColorScheme('<html lang="en"><body>', 'dark')).toBe('<html lang="en" data-color-scheme="dark"><body>');
    expect(withColorScheme('<HTML>', 'light')).toBe('<html data-color-scheme="light">');
    expect(withColorScheme('<html>', undefined)).toBe('<html>');
  });
});
