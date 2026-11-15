/**
 * buildStyles(), the style block, running headers/footers and the defaults (phase C5).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildStyles,
  formatStyleBlock,
  formatStyleTag,
  minifyCSS,
  inlineStyles,
  generatePageLayoutCSS,
  runningContent,
  CSS_LAYER_ORDER,
  SHARED_LAYERS,
  PROFILE_LAYERS,
  DEFAULTS,
  FALLBACK_PAGE
} from '../src/index.js';

const defaultsFile = (rel) => fileURLToPath(new URL(`../defaults/${rel}`, import.meta.url));
const LETTER = readFileSync(defaultsFile(DEFAULTS.layout), 'utf8');

const input = (extra = {}) => ({
  base: { content: 'body{}', path: '/cli/styles/base.css' },
  primary: { content: 'p{}', path: '/cli/styles/primary.css' },
  syntax: { content: '.shiki{}', path: '/cli/styles/syntax/shiki-base.css' },
  ...extra
});

describe('layers and defaults', () => {
  it('the layer order', () => {
    expect(CSS_LAYER_ORDER).toEqual(['base', 'primary', 'layout', 'syntax', 'profile', 'frontmatter']);
    expect(SHARED_LAYERS).toEqual(['base', 'primary', 'syntax']);
    expect(PROFILE_LAYERS).toEqual(['layout', 'profile']);
  });

  it("the defaults folder has pagemd's four files (pagemd checks its copies byte for byte)", () => {
    expect(DEFAULTS).toEqual({
      base: 'styles/base.css',
      primary: 'styles/primary.css',
      syntax: 'styles/syntax/shiki-base.css',
      layout: 'layouts/letter.css'
    });
    for (const rel of Object.values(DEFAULTS)) expect(existsSync(defaultsFile(rel))).toBe(true);
  });

  // R-128 (P5): theme-kit's defaults/ also carries every other bundled profile, layout, style (including the
  // presets) and template, so the editor can build styles with no pagemd install. pagemd's own
  // tests/integration/theme-kit.test.js checks these are byte-identical to its own copies; this test only proves
  // the manifest theme-kit ships, so a future change here is deliberate and reviewed.
  const BUNDLED = [
    'profiles/book-wiki.json',
    'profiles/sop.json',
    'profiles/standard_letter.json',
    'profiles/technical-report.json',
    'layouts/book.css',
    'layouts/letter.css',
    'styles/base.css',
    'styles/book-fonts.css',
    'styles/book-fonts.LICENSE.txt', // the Inter font's SIL OFL 1.1 text, next to the CSS that embeds it (SAN-0a)
    'styles/book.css',
    'styles/presets/modern-clean.css',
    'styles/presets/print-friendly.css',
    'styles/presets/technical-docs.css',
    'styles/primary.css',
    'styles/standard_letter.css',
    'styles/syntax/shiki-base.css',
    'templates/book.html',
    'templates/standard_letter.css',
    'templates/standard_letter.html'
  ];

  it("the defaults folder ships every bundled profile, layout, style and template (R-128)", () => {
    for (const rel of BUNDLED) {
      expect(existsSync(defaultsFile(rel)), `missing ${rel}`).toBe(true);
      expect(readFileSync(defaultsFile(rel)).length, `${rel} is empty`).toBeGreaterThan(0);
    }
  });
});

describe('formatStyleBlock (pagemd buildStyleBlock after reading the files)', () => {
  const agg = [
    { layer: 'base', content: 'a{}', resolvedPath: '/b.css', source: 'base.css', size: 3 },
    { layer: 'layout', content: '@page{}', resolvedPath: '/l.css' },
    { layer: 'profile', content: 'p{}' }
  ];

  it('inline: the declared order, one tag per layer, frontmatter last and undeclared', () => {
    expect(formatStyleBlock(agg, { frontmatterCSS: ':root{}' })).toBe(
      '<style>\n@layer base, primary, layout, syntax, profile;\n</style>\n' +
      '<style data-layer="base">\n@layer base {\na{}\n}\n</style>\n' +
      '<style data-layer="layout">\n@layer layout {\n@page{}\n}\n</style>\n' +
      '<style data-layer="profile">\n@layer profile {\np{}\n}\n</style>\n' +
      '<style data-layer="frontmatter">\n@layer frontmatter {\n:root{}\n}\n</style>\n'
    );
  });

  it('without @layer (Paged.js)', () => {
    expect(formatStyleBlock(agg.slice(0, 1), { useCSSLayers: false })).toBe('<style data-layer="base">\na{}\n</style>\n');
    expect(formatStyleTag('x', 'profile', false)).toBe('<style data-layer="profile">\nx\n</style>');
  });

  it('extract and split; resources only with returnMetadata', () => {
    const extract = formatStyleBlock(agg, { extractCSS: true, frontmatterCSS: 'f{}', returnMetadata: true });
    expect(extract.externalCSS).toBe('@layer base, primary, layout, syntax, profile;\n\n@layer base {\na{}\n}\n\n@layer layout {\n@page{}\n}\n\n@layer profile {\np{}\n}\n\n');
    expect(extract.frontmatterCSS).toBe('f{}');
    expect(extract.resources).toEqual([
      { layer: 'base', source: 'base.css', resolvedPath: '/b.css', size: 3 },
      { layer: 'layout', source: '/l.css', resolvedPath: '/l.css', size: 0 }
    ]);
    const split = formatStyleBlock(agg, { extractCSS: 'split', profileId: 'sop' });
    expect(split.sharedCSS).toBe('@layer base, primary, syntax;\n\n@layer base {\na{}\n}\n\n');
    expect(split.profileCSS).toBe('@layer layout, profile;\n\n@layer layout {\n@page{}\n}\n\n@layer profile {\np{}\n}\n\n');
    expect(split.profileId).toBe('sop');
    expect(split.resources).toBeUndefined();
    expect(formatStyleBlock([], { extractCSS: 'split' }).profileId).toBe('default');
  });

  it('minify and inlineStyles', () => {
    expect(minifyCSS('/* c */ a  {  color : red ; }\n')).toBe('a{color:red}');
    expect(minifyCSS('')).toBe('');
    expect(inlineStyles('<head>{{css}}</head>', '<style/>')).toBe('<head><style/></head>');
    expect(inlineStyles('<head>{{css}}</head>', '')).toBe('<head><!-- No styles provided --></head>');
    expect(inlineStyles('', 'x')).toBe('');
  });
});

describe('running headers and footers', () => {
  it('generatePageLayoutCSS: the CSS variables the layout reads', () => {
    expect(generatePageLayoutCSS({ running_header: 'Title', page_numbers: true, first_page: false })).toBe(
      ':root {\n  --page-header-center: "Title";\n  --page-footer-center: counter(page) " of " counter(pages);\n' +
      '  --page-first-header-left: none;\n  --page-first-header-center: none;\n  --page-first-header-right: none;\n' +
      '  --page-first-footer-left: none;\n  --page-first-footer-center: none;\n  --page-first-footer-right: none;\n}'
    );
    expect(generatePageLayoutCSS({})).toBe('');
    expect(generatePageLayoutCSS(null)).toBe('');
  });

  it('runningContent: the same settings per position, tokens kept', () => {
    expect(runningContent({
      running_header: { left: 'Doc', outside: ':::PAGE' },
      running_footer: { right: 'R' },
      page_numbers: 'Page X',
      first_page: { header: false, footer: 'Cover' },
      page_margin_font_size: '8pt'
    })).toEqual({
      header: { left: 'Doc', outside: ':::PAGE' },
      footer: { center: 'Page :::PAGE', right: 'R' },
      firstPage: { header: false, footer: { center: 'Cover' } },
      marginFontSize: '8pt'
    });
    expect(runningContent({ running_header: { span: 'Wide', left: 'x' } }).header).toEqual({ center: 'Wide', spansWidth: true });
    expect(runningContent({})).toEqual({ header: null, footer: null, firstPage: null, marginFontSize: null });
    expect(runningContent({ first_page: false }).firstPage).toBe(false);
  });
});

describe('buildStyles', () => {
  it('a layout: layers in order, its page, not the default; header/footer from the properties', () => {
    const r = buildStyles(input({
      layout: { content: LETTER, path: '/cli/layouts/letter.css', source: '${cliPath}/layouts/letter.css' },
      profile: [{ content: 'h1{}', path: '/p/p.css' }],
      frontmatter: [{ content: 'em{}', path: '/d/f.css' }],
      metadata: { running_header: 'H' },
      defaultsPath: '/cli',
      profileId: 'standard_letter'
    }));
    expect(r.layers.map((l) => l.layer)).toEqual(['base', 'primary', 'layout', 'syntax', 'profile', 'frontmatter']);
    expect(r.usingDefault).toBe(false);
    expect(r.layout).toEqual({ path: '/cli/layouts/letter.css', source: '${cliPath}/layouts/letter.css', bundled: true });
    expect(r.page).toEqual({ width: 215.9, height: 279.4, margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 } });
    expect(Object.keys(r.namedPages)).toEqual(['landscape', 'default']);
    expect(r.header).toEqual({ center: 'H' });
    expect(r.frontmatterCSS).toBe(':root {\n  --page-header-center: "H";\n}\nem{}');
    expect(r.sources).toEqual(['/cli/styles/base.css', '/cli/styles/primary.css', '/cli/layouts/letter.css', '/cli/styles/syntax/shiki-base.css', '/p/p.css', '/d/f.css']);
    expect(r.styleBlock.startsWith('<style>\n@layer base, primary, layout, syntax, profile;\n</style>\n')).toBe(true);
    expect(r.css.endsWith('@layer frontmatter {\n:root {\n  --page-header-center: "H";\n}\nem{}\n}\n')).toBe(true);
  });

  it('P26: `structural` CSS goes at the end of the base layer (what pagemd adds for footnotes and task lists); without it the base layer is as read', () => {
    const plain = buildStyles(input({}));
    const withIt = buildStyles(input({ structural: '/* pagemd: task-lists */\n.task-list-item { list-style: none; }\n' }));
    const base = (r) => r.layers.find((l) => l.layer === 'base').content;
    expect(base(withIt)).toBe(`${base(plain)}\n/* pagemd: task-lists */\n.task-list-item { list-style: none; }\n`);
    expect(withIt.css.indexOf('.task-list-item')).toBeLessThan(withIt.css.indexOf('@layer primary'));
    // control: nothing else moves
    expect(withIt.layers.map((l) => l.layer)).toEqual(plain.layers.map((l) => l.layer));
    expect(plain.css).not.toContain('task-list-item');
  });

  it('FIX-ADT: `structuralLate` is a layer of its own after the profile (declared), only when given; without it the output is as before', () => {
    const plain = buildStyles(input({ frontmatter: [{ content: 'em{}' }] }));
    const late = '/* pagemd: task-lists */\n.task-list-item { list-style: none; }\n';
    const withIt = buildStyles(input({ structuralLate: late, frontmatter: [{ content: 'em{}' }] }));
    const names = (r) => r.layers.map((l) => l.layer);
    expect(names(withIt)).toEqual([...names(plain).filter((n) => n !== 'frontmatter'), 'structural', ...names(plain).filter((n) => n === 'frontmatter')]);
    expect(withIt.layers.find((l) => l.layer === 'structural').content).toBe(late);
    expect(withIt.styleBlock.startsWith('<style>\n@layer base, primary, layout, syntax, profile, structural;\n</style>\n')).toBe(true);
    expect(withIt.css.startsWith('@layer base, primary, layout, syntax, profile, structural;')).toBe(true);
    // after the profile's CSS and before the frontmatter layer, in the file too
    expect(withIt.css.indexOf('@layer structural')).toBeGreaterThan(withIt.css.indexOf('@layer profile'));
    expect(withIt.css.indexOf('@layer structural')).toBeLessThan(withIt.css.indexOf('@layer frontmatter'));
    // control: no late CSS (or an empty one): exactly the output as before, the layer statement included
    expect(buildStyles(input({ structuralLate: '', frontmatter: [{ content: 'em{}' }] })).styleBlock).toBe(plain.styleBlock);
    expect(buildStyles(input({ structuralLate: '', frontmatter: [{ content: 'em{}' }] })).css).toBe(plain.css);
    expect(plain.styleBlock).toContain('@layer base, primary, layout, syntax, profile;');
    expect(plain.css).not.toContain('structural');
    // not in the unlayered form either: source order (profile, then structural) is what counts
    const flat = buildStyles(input({ structuralLate: late, useCSSLayers: false }));
    expect(flat.styleBlock.indexOf('data-layer="structural"')).toBeGreaterThan(flat.styleBlock.indexOf('data-layer="profile"'));
  });

  it('a layout outside the defaults folder is not bundled', () => {
    const r = buildStyles(input({ layout: { content: '@page{size:A4}', path: '/proj/.pagemd/layouts/doc.css' }, defaultsPath: '/cli' }));
    expect(r.layout.bundled).toBe(false);
    expect(r.page.width).toBe(210);
    expect(buildStyles(input({ layout: { content: '', path: 'C:\\cli\\layouts\\x.css' }, defaultsPath: 'C:\\cli\\' })).layout.bundled).toBe(true);
  });

  it('usingDefault: true exactly when there is no layout and no @page anywhere', () => {
    expect(buildStyles(input()).usingDefault).toBe(true);
    expect(buildStyles(input({ profile: [{ content: '@page { size: A5 }' }] })).usingDefault).toBe(false);
    expect(buildStyles(input({ frontmatter: [{ content: '@page { margin: 0 }' }] })).usingDefault).toBe(false);
    expect(buildStyles(input({ layout: { content: 'no page rule here' } })).usingDefault).toBe(false);
    expect(buildStyles(input({ profile: [{ content: '@page :first { margin: 0 }' }] })).usingDefault).toBe(true);
  });

  it('the default layout is used only when asked for (the editor); the CLI form is unchanged', () => {
    const cli = buildStyles(input());
    expect(cli.layers.map((l) => l.layer)).toEqual(['base', 'primary', 'syntax']);
    expect(cli.page).toEqual({ width: FALLBACK_PAGE.width, height: FALLBACK_PAGE.height, margins: { ...FALLBACK_PAGE.margins } });
    expect(cli.layout).toBeNull();

    const editor = buildStyles(input({ defaultLayout: { content: LETTER, path: '/tk/defaults/layouts/letter.css' } }));
    expect(editor.usingDefault).toBe(true);
    expect(editor.layers.map((l) => l.layer)).toEqual(['base', 'primary', 'layout', 'syntax']);
    expect(editor.layout).toBeNull();
    expect(editor.page).toEqual(cli.page); // letter.css = Paged.js's own page
    expect(editor.sources).toContain('/tk/defaults/layouts/letter.css');
  });

  it('syntax highlighting off drops the syntax layer; strings are accepted as sheets', () => {
    const r = buildStyles({ base: 'a{}', primary: 'b{}', syntax: 'c{}', syntaxHighlight: false });
    expect(r.layers.map((l) => l.layer)).toEqual(['base', 'primary']);
    expect(r.sources).toEqual([]);
  });
});
