/**
 * A template's and a stylesheet's relative paths start from that file's folder (pagemd-editor FIX-template-asset-paths,
 * R-259, OQ-80): every row of the plan's table, srcset, url() in every quoting, code and comments untouched, Windows paths
 * with spaces, another drive, the reversal switch.
 */

import { describe, it, expect } from 'vitest';
import nodePath from 'node:path';
import { createMemoryFileSystem, rebaseAssetPaths, rebaseAssetPathsSync, scanHtml, scanCss, relativeAssetPath } from '../src/index.js';

const DOC = '/p/01-SOP';
const TEMPLATES = '/p/Resources/r/templates';
const fs = createMemoryFileSystem({
  '/p/01-SOP/document.md': '# Doc',
  '/p/01-SOP/.pagemd/assets/old.png': 'png',
  '/p/Resources/r/templates/t.html': '',
  '/p/Resources/r/assets/images/dashboard.png': 'png',
  '/p/Resources/r/templates/assets/here.png': 'png',
  '/p/Resources/r/templates/both.png': 'png',
  '/p/01-SOP/both.png': 'png',
  '/p/Resources/r/fonts/Brand Font.woff2': 'font',
  '/p/Resources/r/styles/bg.png': 'png'
});
const ports = { fs };
const html = (text, extra = {}) => rebaseAssetPathsSync(text, { kind: 'html', fileDir: TEMPLATES, documentDir: DOC, ...extra }, ports);
const css = (text, fileDir = '/p/Resources/r/styles') => rebaseAssetPathsSync(text, { kind: 'css', fileDir, documentDir: DOC }, ports);

describe('the plan table (template)', () => {
  it('../assets/… is found from the template folder and written from the document', () => {
    const r = html('<img src="../assets/images/dashboard.png" alt="d">');
    expect(r.text).toBe('<img src="../Resources/r/assets/images/dashboard.png" alt="d">');
    expect(r.assets).toEqual([{ written: '../assets/images/dashboard.png', outcome: 'file', path: '/p/Resources/r/assets/images/dashboard.png', tried: ['/p/Resources/r/assets/images/dashboard.png', '/p/assets/images/dashboard.png'], rewritten: '../Resources/r/assets/images/dashboard.png', where: 'src' }]);
  });

  it('./assets/… and assets/… are rewritten when the file is next to the template', () => {
    expect(html('<img src="./assets/here.png">').text).toBe('<img src="../Resources/r/templates/assets/here.png">');
    expect(html("<img src='assets/here.png'>").text).toBe("<img src='../Resources/r/templates/assets/here.png'>");
    expect(html('<img src=assets/here.png>').text).toBe('<img src=../Resources/r/templates/assets/here.png>');
  });

  it('.pagemd/assets/… with nothing next to the template is left as written (read from the document, as before)', () => {
    const r = html('<img src=".pagemd/assets/old.png">');
    expect(r.text).toBe('<img src=".pagemd/assets/old.png">');
    expect(r.assets[0]).toMatchObject({ outcome: 'document', path: '/p/01-SOP/.pagemd/assets/old.png', rewritten: null });
  });

  it('a file in both places: the template-relative one wins (the plan\'s Risk row)', () => {
    expect(html('<img src="both.png">').text).toBe('<img src="../Resources/r/templates/both.png">');
  });

  it('neither place: left as written, reported missing with both places tried', () => {
    const r = html('<img src="./assets/images/dashboard.png">');
    expect(r.text).toBe('<img src="./assets/images/dashboard.png">');
    expect(r.assets[0]).toMatchObject({ outcome: 'missing', path: null, tried: ['/p/Resources/r/templates/assets/images/dashboard.png', '/p/01-SOP/assets/images/dashboard.png'] });
  });

  it.each([
    '/assets/x.png', 'http://e.com/x.png', 'https://e.com/x.png', 'data:image/png;base64,AAAA', 'file:///c/x.png', '//cdn.e.com/x.png',
    '#frag', '{{metadata.logo}}', '{{PROJECT_ROOT}}/x.png', '${projectRoot}/x.png', 'C:\\x\\y.png', 'C:/x/y.png', ''
  ])('%j is never changed nor reported', (src) => {
    const r = html(`<img src="${src}">`);
    expect(r.text).toBe(`<img src="${src}">`);
    expect(r.assets).toEqual([]);
  });

  it('keeps the ?query and #fragment', () => {
    expect(html('<link rel="icon" href="../assets/images/dashboard.png?v=2#x">').text).toBe('<link rel="icon" href="../Resources/r/assets/images/dashboard.png?v=2#x">');
  });

  it('the same folder as the document: nothing to rewrite', () => {
    const r = rebaseAssetPathsSync('<img src="both.png">', { fileDir: DOC, documentDir: DOC }, ports);
    expect(r.text).toBe('<img src="both.png">');
    expect(r.assets[0]).toMatchObject({ outcome: 'file', rewritten: null });
  });

  it('rewrite: false reports but changes nothing (the reversal switch)', () => {
    const r = html('<img src="../assets/images/dashboard.png">', { rewrite: false });
    expect(r.text).toBe('<img src="../assets/images/dashboard.png">');
    expect(r.assets[0]).toMatchObject({ outcome: 'file', rewritten: null });
  });

  it('no document folder: nothing rebased, nothing reported', () => {
    expect(rebaseAssetPathsSync('<img src="../assets/images/dashboard.png">', { fileDir: TEMPLATES, documentDir: null }, ports)).toEqual({ text: '<img src="../assets/images/dashboard.png">', assets: [] });
  });
});

describe('what the HTML reader touches', () => {
  it('srcset, poster, <link href>, SVG <image href>, but not <a href>', () => {
    const r = html('<img srcset="../assets/images/dashboard.png 1x, assets/here.png 2x"><video poster="assets/here.png"></video><link rel="stylesheet" href="assets/here.png"><svg><image href="assets/here.png"/><use xlink:href="assets/here.png#i"/></svg><a href="assets/here.png">x</a>');
    expect(r.text).toBe('<img srcset="../Resources/r/assets/images/dashboard.png 1x, ../Resources/r/templates/assets/here.png 2x"><video poster="../Resources/r/templates/assets/here.png"></video><link rel="stylesheet" href="../Resources/r/templates/assets/here.png"><svg><image href="../Resources/r/templates/assets/here.png"/><use xlink:href="../Resources/r/templates/assets/here.png#i"/></svg><a href="assets/here.png">x</a>');
  });

  it('style="…url()…" and <style> url() in every quoting', () => {
    const text = `<div style="background: url('assets/here.png')"></div><div style='background:url("assets/here.png")'></div><div style="background:url(&quot;assets/here.png&quot;)"></div><style>.a{background:url(assets/here.png)} .b{background:url( "assets/here.png" )}</style>`;
    const out = '../Resources/r/templates/assets/here.png';
    expect(html(text).text).toBe(`<div style="background: url('${out}')"></div><div style='background:url("${out}")'></div><div style="background:url(&quot;${out}&quot;)"></div><style>.a{background:url(${out})} .b{background:url( "${out}" )}</style>`);
  });

  it('comments, <pre>, <code>, <script>, <textarea> and {{content}} are left alone', () => {
    const text = [
      '<!-- <img src="assets/here.png"> -->',
      '<pre><img src="assets/here.png"></pre>',
      '<code>&lt;img src="assets/here.png"&gt; <img src="assets/here.png"></code>',
      '<script>const s = "<img src=\\"assets/here.png\\">";</script>',
      '<textarea><img src="assets/here.png"></textarea>',
      '<main>{{content}}</main>'
    ].join('\n');
    const r = html(text);
    expect(r.text).toBe(text);
    expect(r.assets).toEqual([]);
  });

  it('a tag after a <code> block is read again', () => {
    expect(html('<code>x</code><img src="assets/here.png">').text).toBe('<code>x</code><img src="../Resources/r/templates/assets/here.png">');
  });

  it('template conditionals around attributes do not confuse the reader', () => {
    expect(html('<img {{#if metadata.x}}class="a"{{/if}} src="assets/here.png">').text).toBe('<img {{#if metadata.x}}class="a"{{/if}} src="../Resources/r/templates/assets/here.png">');
  });

  it('scanHtml and scanCss find only the places listed', () => {
    expect(scanHtml('<img src="a.png" data-src="b.png" title="c.png">').map((r) => r.value)).toEqual(['a.png']);
    expect(scanCss('/* url(a.png) */ .x{content:"url(b.png)"; background:url(c.png)} .y{mask:URL(\'d.png\')}').map((r) => r.value)).toEqual(['c.png', 'd.png']);
  });

  it('relativeAssetPath decodes %20 and keeps the suffix', () => {
    expect(relativeAssetPath('my%20logo.png?x#y')).toEqual({ file: 'my logo.png', suffix: '?x#y' });
    expect(relativeAssetPath('..\\assets\\a.png')).toEqual({ file: '../assets/a.png', suffix: '' });
  });
});

describe('stylesheets (layout and profile CSS)', () => {
  it('url() starts from the stylesheet\'s own folder; spaces are encoded', () => {
    const r = css("@font-face{font-family:B;src:url('../fonts/Brand Font.woff2') format('woff2')} body{background:url(bg.png)} /* url(bg.png) */");
    expect(r.text).toBe("@font-face{font-family:B;src:url('../Resources/r/fonts/Brand%20Font.woff2') format('woff2')} body{background:url(../Resources/r/styles/bg.png)} /* url(bg.png) */");
    expect(r.assets.map((a) => a.outcome)).toEqual(['file', 'file']);
  });

  it('a missing url() is left as written and reported', () => {
    const r = css('body{background:url(nope.png)}');
    expect(r.text).toBe('body{background:url(nope.png)}');
    expect(r.assets[0]).toMatchObject({ outcome: 'missing', tried: ['/p/Resources/r/styles/nope.png', '/p/01-SOP/nope.png'] });
  });
});

describe('Windows paths (node:path.win32) with spaces', () => {
  const W = nodePath.win32;
  const files = new Set([
    'C:\\Users\\J\\Docs\\std-how-to\\assets\\img\\UOFO logo.png',
    'C:\\Users\\J\\Docs\\Delay Reporter\\.pagemd\\assets\\img\\old.png',
    'D:\\Shared\\assets\\logo.png'
  ]);
  const winPorts = { fs: { stat: (p) => (files.has(p) ? { isFile: true, isDirectory: false, size: 1 } : null), exists: (p) => files.has(p) }, env: { path: W } };
  const opts = { kind: 'html', fileDir: 'C:\\Users\\J\\Docs\\std-how-to\\templates', documentDir: 'C:\\Users\\J\\Docs\\Delay Reporter' };

  it('the user\'s shape: ../assets/img/… from the template, written from "Delay Reporter" with %20', () => {
    const r = rebaseAssetPathsSync('<img src="../assets/img/UOFO logo.png">', opts, winPorts);
    expect(r.text).toBe('<img src="../std-how-to/assets/img/UOFO%20logo.png">');
    expect(r.assets[0].path).toBe('C:\\Users\\J\\Docs\\std-how-to\\assets\\img\\UOFO logo.png');
  });

  it('backslashes and %20 as written are read too', () => {
    expect(rebaseAssetPathsSync('<img src="..\\assets\\img\\UOFO%20logo.png">', opts, winPorts).text).toBe('<img src="../std-how-to/assets/img/UOFO%20logo.png">');
  });

  it('the old .pagemd/assets/… shape still reads from the document folder', () => {
    const r = rebaseAssetPathsSync('<img src=".pagemd/assets/img/old.png">', opts, winPorts);
    expect(r.text).toBe('<img src=".pagemd/assets/img/old.png">');
    expect(r.assets[0].outcome).toBe('document');
  });

  it('another drive: a file:/// URL (there is no relative path)', () => {
    const r = rebaseAssetPathsSync('<img src="../assets/logo.png">', { ...opts, fileDir: 'D:\\Shared\\templates' }, winPorts);
    expect(r.text).toBe('<img src="file:///D:/Shared/assets/logo.png">');
  });
});

describe('the async twin gives the same answer', () => {
  it('rebaseAssetPaths over an async file system', async () => {
    const text = '<img src="../assets/images/dashboard.png"><img src="nope.png">';
    const sync = html(text);
    const async = await rebaseAssetPaths(text, { kind: 'html', fileDir: TEMPLATES, documentDir: DOC }, { fs: fs.async() });
    expect(async).toEqual(sync);
  });
});
