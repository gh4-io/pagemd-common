/**
 * Hostile packs (security fix after the session-56 review of L2/L3). Each case is a real library pack (fixture
 * pml-sop-ink) with one hostile change and a manifest that agrees with it, so only the content rules can stop it.
 * Every case was accepted by the text patterns this fix replaced (the first group lists the review's own findings).
 * The last group proves the readers still accept what the library makes: every pack in the fixtures, and the
 * things real stylesheets do (escapes like "\2002", data: pictures, comments holding "<kbd>").
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, PackError, badCss, badMarkup, badName, badProfile, readZip, sha256, verifyPack, writeZip } from '../src/index.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ink = fs.readFileSync(path.join(FIXTURES, 'library', 'pml-sop-ink-0.1.0.zip'));
const id = 'pml-sop-ink';
const good = () => readZip(ink).filter((e) => !e.isDir).map(({ name, data }) => ({ name, data }));
const tplName = good().find((f) => f.name.endsWith('.html')).name;
const tpl = () => good().find((f) => f.name === tplName).data.toString('utf8');
const profile = () => JSON.parse(good().find((f) => f.name === `${id}.json`).data.toString('utf8'));

/** A zip of `list` with a manifest that agrees with it. */
const withManifest = (list) => {
  const body = list.filter((f) => f.name !== `${id}/manifest.json`);
  const m = JSON.parse(good().find((f) => f.name === `${id}/manifest.json`).data.toString());
  m.files = body.map((f) => ({ path: f.name, size: f.data.length, sha256: sha256(f.data) }));
  return writeZip([...body, { name: `${id}/manifest.json`, data: Buffer.from(JSON.stringify(m, null, 2)) }]);
};
const replace = (name, text) => withManifest(good().map((f) => (f.name === name ? { ...f, data: Buffer.from(text) } : f)));
const add = (name, text) => withManifest([...good(), { name, data: Buffer.from(text) }]);
const withTemplate = (fn) => replace(tplName, fn(tpl()));
const withCss = (css) => replace(`${id}/core/tokens.css`, `${good().find((f) => f.name === `${id}/core/tokens.css`).data}\n${css}\n`);
const withProfile = (fn) => { const p = profile(); fn(p); return replace(`${id}.json`, JSON.stringify(p, null, 2)); };
const refusal = (buf) => {
  try { verifyPack(buf, sha256(buf)); } catch (e) { expect(e).toBeInstanceOf(PackError); return e; }
  return null;
};
const body = (html) => withTemplate((t) => t.replace('</body>', `${html}\n</body>`));

describe("the review's findings: each is refused now", () => {
  const cases = [
    ['<svg/onload=…> in the template', () => body('<svg/onload=fetch("//evil.example")>'), /glued|attribute/],
    ['<img src="x"onerror=…> (no space before the handler)', () => body('<img src="x"onerror="fetch(1)">'), /glued/],
    ['an entity-escaped javascript: link', () => body('<a href="&#106;avascript:alert(1)">x</a>'), /outside the pack|script/],
    ['a hex-entity javascript: address with a tab', () => body('<a href="java&#x09;script&#x3a;alert(1)">x</a>'), /outside the pack/],
    ['a remote https:// picture in the template', () => body('<img src="https://evil.example/p.png">'), /outside the pack/],
    ['a protocol-relative //host picture', () => body('<img src="//evil.example/p.png">'), /root of the computer/],
    ['a remote address in an SVG', () => add(`${id}/a.svg`, '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>'), /outside the pack/],
    ['CSS image-set("https://…")', () => withCss('a{background:image-set("https://evil.example/x.png" 1x)}'), /image-set/],
    ['CSS -webkit-image-set', () => withCss('a{background:-webkit-image-set("x.png" 1x)}'), /image-set/],
    ['CSS URL("htt\\70s://…") (escaped scheme, any case)', () => withCss('a{background:URL("htt\\70s://evil.example/x.png")}'), /outside the pack/],
    ['CSS @\\69mport', () => withCss('@\\69mport "https://evil.example/x.css";'), /@import/],
    ['CSS u\\72l(…) (escaped function name)', () => withCss('a{background:u\\72l(https://evil.example/x.png)}'), /outside the pack/]
  ];
  for (const [what, make, re] of cases) {
    it(what, () => {
      const e = refusal(make());
      expect(e, 'it was not refused').not.toBeNull();
      expect(e.message).toMatch(re);
      expect(e.code).toBe(EXIT.refused);
    });
  }
});

describe('templates and SVG: what a browser would read differently, or that reaches outside, is refused', () => {
  const cases = [
    ['an unknown element (<iframe>)', () => body('<iframe src="a.html"></iframe>'), /not one a pack may use/],
    ['<object> / <embed>', () => body('<object data="x.svg"></object>'), /not one a pack may use/],
    ['<base href> (would move every relative address)', () => body('<base href="https://evil.example/">'), /not one a pack may use/],
    ['<meta http-equiv="refresh">', () => body('<meta http-equiv="refresh" content="0;url=https://evil.example">'), /http-equiv/],
    ['<link rel=stylesheet>', () => body('<link rel="stylesheet" href="x.css">'), /not one a pack may use/],
    ['an uppercase ONLOAD handler', () => body('<div ONLOAD="x()"></div>'), /event attribute/],
    ['srcset', () => body('<img src="a.png" srcset="https://evil.example/x.png 2x">'), /srcset/],
    ['a comment ended early by --!>', () => body('<!-- x --!><img src=x onerror=alert(1)> -->'), /early/],
    ['<!--> (an empty comment that hides nothing)', () => body('<!--><img src=x onerror=alert(1)>-->'), /early/],
    ['a bogus comment <!x>', () => body('<!x><img src=x onerror=alert(1)>'), /not a comment/],
    ['a CDATA section in a template', () => body('<![CDATA[x]]>'), /CDATA/],
    ['a processing instruction in a template', () => body('<?xml-stylesheet href="x.css"?>'), /processing instruction/],
    ['a style="" that fetches', () => body('<div style="background:url(https://evil.example/x)"></div>'), /outside the pack/],
    ['a <style> in the template that fetches', () => withTemplate((t) => t.replace('</head>', '<style>a{background:url(//evil.example/x)}</style></head>')), /root of the computer/],
    ['a <style> holding markup', () => withTemplate((t) => t.replace('</head>', '<style>a{}<img src=x onerror=alert(1)></style></head>')), /markup/],
    ['an SVG fill="url(https://…)"', () => add(`${id}/a.svg`, '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://evil.example/f.svg#a)"/></svg>'), /outside the pack/],
    ['an SVG fill with an entity-escaped url(', () => add(`${id}/a.svg`, '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url&#40;https://evil.example/f.svg#a)"/></svg>'), /outside the pack/],
    ['an SVG <script>', () => add(`${id}/a.svg`, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), /not one a pack may use/],
    ['an SVG <foreignObject>', () => add(`${id}/a.svg`, '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>'), /not one a pack may use/],
    ['an SVG <animate> / <set> (can change an href)', () => add(`${id}/a.svg`, '<svg xmlns="http://www.w3.org/2000/svg"><a><set attributeName="href" to="javascript:alert(1)"/></a></svg>'), /not one a pack may use/],
    ['an SVG prefix bound to XHTML (h:script)', () => add(`${id}/a.svg`, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:h="http://www.w3.org/1999/xhtml"><h:script>alert(1)</h:script></svg>'), /namespace/],
    ['an SVG xml-stylesheet', () => add(`${id}/a.svg`, '<?xml-stylesheet href="https://evil.example/x.css"?><svg xmlns="http://www.w3.org/2000/svg"/>'), /processing instruction/],
    ['an SVG doctype with an internal subset (entities)', () => add(`${id}/a.svg`, '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>'), /doctype/],
    ['an SVG xml:base', () => add(`${id}/a.svg`, '<svg xmlns="http://www.w3.org/2000/svg" xml:base="https://evil.example/"><image href="a.png"/></svg>'), /xml:base/],
    ['an SVG <style> fetching in CDATA', () => add(`${id}/a.svg`, '<svg xmlns="http://www.w3.org/2000/svg"><style><![CDATA[a{background:url(https://evil.example/x)}]]></style></svg>'), /outside the pack/],
    ['a picture named outside the pack (../../)', () => body('<img src="../../../../secret.png">'), /outside the pack/],
    ['a picture from the root of the computer', () => body('<img src="/etc/passwd">'), /root of the computer/],
    ['a local picture the pack does not have', () => body('<img src="gone.png">'), /not self-contained.*gone\.png/]
  ];
  for (const [what, make, re] of cases) {
    it(what, () => {
      const e = refusal(make());
      expect(e, 'it was not refused').not.toBeNull();
      expect(e.message).toMatch(re);
    });
  }
});

describe('template placeholders: only shapes that stay text', () => {
  const cases = [
    ['a path token ({{PROJECT_ROOT}}) in an address', () => body('<img src="{{PROJECT_ROOT}}/.ssh/id_rsa.png">'), /placeholder/],
    ['{{content}} inside an attribute', () => body('<div title="{{content}}"></div>'), /between elements/],
    ['a placeholder in an unquoted attribute', () => body('<div class={{metadata.x}}></div>'), /holds|placeholder|quotes/],
    ['a placeholder in a single-quoted attribute', () => body("<div class='{{metadata.x}}'></div>"), /double quotes/],
    ['"<" glued to a placeholder (it could become a tag)', () => body('<{{metadata.tag}}>'), /"<"/],
    ['a default that writes markup', () => body('<p>{{metadata.x ?? "<img src=x onerror=alert(1)>"}}</p>'), /placeholder/],
    ['a ternary that writes an address', () => body('<p>{{metadata.x ? "javascript:alert(1)" : ""}}</p>'), /placeholder/],
    ['an address made of text and a placeholder', () => body('<img src="java{{metadata.x}}script:alert(1)">'), /one placeholder/],
    ['a {{#if}} that opens in a comment (it would un-hide markup)', () => body('{{#if metadata.x}}<!--{{/if}} <img src=x onerror=alert(1)> -->'), /comment/],
    ['a {{#if}} that opens in text and closes in an attribute', () => body('{{#if metadata.x}}<div class="a{{/if}}"></div>'), /different places/],
    ['an {{#if}} left open', () => body('{{#if metadata.x}}<p>x</p>'), /not closed/],
    ['a placeholder inside <style>', () => withTemplate((t) => t.replace('</head>', '<style>a{color:{{metadata.c}}}</style></head>')), /style/]
  ];
  for (const [what, make, re] of cases) {
    it(what, () => {
      const e = refusal(make());
      expect(e, 'it was not refused').not.toBeNull();
      expect(e.message).toMatch(re);
    });
  }
});

describe("the profile: only what a pack may set (the review's item 4)", () => {
  const cases = [
    ['outputs.directory', (p) => { p.outputs.directory = '/home/u/.config/autostart'; }, /outputs\.directory/],
    ['outputs.pdf.outputDir', (p) => { p.outputs.pdf.outputDir = '../../'; }, /outputs\.pdf\.outputDir/],
    ['outputs.pdf.options', (p) => { p.outputs.pdf.options = { path: '/tmp/x.pdf' }; }, /outputs\.pdf\.options/],
    ['layout.css (an old path setting)', (p) => { p.layout = { css: '/etc/x.css' }; }, /"layout"/],
    ['styles.profile', (p) => { p.styles = { profile: '../../x.css' }; }, /"styles"/],
    ['debugArtifacts', (p) => { p.debugArtifacts = true; }, /"debugArtifacts"/],
    ['pagedjs.handlers (scripts)', (p) => { p.pagedjs = { handlers: ['./x.js'] }; }, /"pagedjs"/],
    ['extends as a path', (p) => { p.extends = '../../other/profile'; }, /extends must be a profile name/],
    ['resources.template outside ./<id>/', (p) => { p.resources.template = '../templates/x.html'; }, /not inside/],
    ['resources.css with ".." inside the folder', (p) => { p.resources.css.push(`./${id}/../other.css`); }, /plain path/],
    ['resources.fonts outside the pack', (p) => { p.resources.fonts = ['/usr/share/fonts/x.ttf']; }, /not inside/],
    ['resources.assets that the pack lacks', (p) => { p.resources.assets = [`./${id}/gone.png`]; }, /does not have/],
    ['a metadata default holding markup', (p) => { p.metadata.defaults.doc_type = '<img src=x onerror=alert(1)>'; }, /metadata\.defaults\.doc_type/],
    ['a metadata default holding a quote (would end an attribute)', (p) => { p.metadata.defaults.doc_type = 'x" onmouseover="alert(1)'; }, /metadata\.defaults\.doc_type/],
    ['a metadata default holding a web address', (p) => { p.metadata.defaults.logo = 'https://evil.example/x.png'; }, /web address/],
    ['an annotatedImage colour that ends the declaration', (p) => { p.annotatedImage = { markerColor: 'red;background:url(https://evil.example)' }; }, /plain CSS colour/],
    ['a description holding markup', (p) => { p.description = '</title><script>alert(1)</script>'; }, /description|holds/],
    ['an unknown setting', (p) => { p.somethingNew = 1; }, /"somethingNew"/]
  ];
  for (const [what, change, re] of cases) {
    it(what, () => {
      const e = refusal(withProfile(change));
      expect(e, 'it was not refused').not.toBeNull();
      expect(e.message).toMatch(re);
    });
  }
});

describe("file names Windows can't write or reads as something else (the review's item 5)", () => {
  for (const name of [`${id}/a:b.css`, `${id}/core.css:stream`, `${id}/CON.css`, `${id}/nul.png`, `${id}/com1.json`, `${id}/x.css.`, `${id}/x /a.css`, `${id}/a|b.css`, `${id}/a\u0001.css`]) {
    it(JSON.stringify(name), () => {
      expect(badName(name)).not.toBeNull();
      const e = refusal(add(name, 'a{}'));
      expect(e, 'it was not refused').not.toBeNull();
    });
  }
});

describe('what real packs do is still accepted', () => {
  it('the fixtures (two library packs, and the 0.2.0 one)', () => {
    for (const f of ['library/pml-sop-ink-0.1.0.zip', 'library/uofo-sop-0.1.0.zip', 'library-v2/pml-sop-ink-0.2.0.zip']) {
      const buf = fs.readFileSync(path.join(FIXTURES, f));
      expect(() => verifyPack(buf, sha256(buf)), f).not.toThrow();
    }
  });
  it('CSS escapes, data: pictures, comments holding markup, url() forms, paged-media functions', () => {
    const css = [
      '/* the template has <span class="x"> and <!-- ::TOC --> */',
      'h2::before{content:counter(h2c) ".\\2002"}',
      'li::before{background:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'%3E%3C/svg%3E")}',
      '@font-face{font-family:I;src:url("fonts/Inter-Bold.woff2") format("woff2")}',
      'a{background:url()} b{background:URL(fonts/Inter-Bold.woff2)}',
      '@page{@top-left{content:string(title) element(running)}} a::after{content:target-counter(attr(href url), page)}',
      '@media (width < 600px){a{color:red}}',
      '.x{content:"Page: "}'
    ].join('\n');
    const refs = [];
    expect(badCss(css, `${id}/core/tokens.css`, refs)).toBeNull();
    expect(refs).toEqual([`${id}/core/fonts/Inter-Bold.woff2`, `${id}/core/fonts/Inter-Bold.woff2`]);
  });
  it('a template like the library\'s: placeholders in text and in double-quoted attributes, {{#if}} blocks', () => {
    expect(badMarkup(tpl(), 'html', tplName)).toBeNull();
    const t = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><title>{{metadata.title}}</title>{{styles}}</head>' +
      '<body class="{{metadata.logo ? \'has-logo\' : \'\'}}">{{#if metadata.logo}}<img src="{{metadata.logo}}" alt="{{metadata.company ?? \'Logo\'}}" />{{/if}}' +
      '<p>a < b, 2<3</p><svg viewBox="0 0 1 1"><title>t</title><path d="M0 0"/></svg><main>{{content}}</main></body></html>';
    expect(badMarkup(t, 'html', tplName)).toBeNull();
  });
  it('an SVG as editors write it (xml declaration, xlink, inkscape metadata)', () => {
    const svg = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
      'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs>' +
      '<inkscape:x/><rect fill="url(#g)" width="10" height="10"/><use xlink:href="#g"/><style>rect{fill:red}</style></svg>';
    expect(badMarkup(svg, 'svg', `${id}/a.svg`)).toBeNull();
  });
  it('the allowlist reads the library profile as it is', () => {
    expect(badProfile(id, profile())).toBeNull();
  });
});
