/**
 * @pagemd/validate (phase C8): the setting, every level, and a fixture for each decision (R-183–R-188).
 * Every check is shown failing on a document that breaks it and quiet on one that doesn't.
 */

import { describe, it, expect } from 'vitest';
import { createMemoryFileSystem } from '@pagemd/resolver';
import { validate, validateSync, readConfig, passes, LEVELS, lookupReason, frontmatterBlock, readFrontmatter } from '../src/index.js';

const env = { homePath: '/home/u', cwd: '/work', defaultsPath: '/cli' };
const json = (o) => JSON.stringify(o);

const CLI = {
  '/cli/profiles/standard_letter.json': json({
    id: 'standard_letter',
    resources: { template: '${cliPath}/templates/standard_letter.html', layout: '${cliPath}/layouts/letter.css', css: ['${cliPath}/styles/primary.css'] },
    validation: { required_fields: ['document_id', 'title'] }
  }),
  '/cli/profiles/quiet.json': json({ id: 'quiet', resources: { template: '${cliPath}/templates/standard_letter.html' } }),
  '/cli/templates/standard_letter.html': '<html><head>{{styles}}</head><body><h1>{{metadata.title}}</h1>{{content}}</body></html>',
  '/cli/layouts/letter.css': '@page { size: letter; margin: 1in; }\n.page-landscape { page: landscape; }\n@page landscape { size: letter landscape; }',
  '/cli/styles/base.css': '',
  '/cli/styles/primary.css': 'p { color: black; }',
  '/cli/styles/syntax/shiki-base.css': ''
};

/** A project with a profile `p` (written as given) next to the document. */
function project(profile, extra = {}) {
  return createMemoryFileSystem({
    ...CLI,
    '/proj/package.json': '{}',
    '/proj/profiles/p.json': json({ id: 'p', ...profile }),
    ...extra
  });
}

/** A document using profile `p`; `fm` is extra frontmatter lines, `body` the text after it. */
const doc = (fm = '', body = '# Doc\n') => `---\nprofile: p\ntitle: T\ndocument_id: D-1\n${fm}---\n${body}`;

function run(text, fs, options = {}) {
  return validateSync({ path: '/proj/doc.md', text }, options, { fs, env });
}
const codes = (r) => r.diagnostics.map((d) => d.code);
const only = (r, level) => r.diagnostics.filter((d) => d.level === level);

/** A profile with only one level on (the others false). */
const onlyLevel = (level, extra = {}) => ({ validation: Object.fromEntries(LEVELS.map((l) => [l, l === level])), ...extra });

const OK_RESOURCES = { template: '${cliPath}/templates/standard_letter.html', layout: '${cliPath}/layouts/letter.css', css: ['${cliPath}/styles/primary.css'] };

describe('the validation setting (ADR-0017 V4)', () => {
  it('no block, false, or a non-object: no checks at all (R-30), even for a broken document', () => {
    for (const validation of [undefined, false, null, 'yes', []]) {
      const fs = project({ resources: { template: 'missing.html' }, ...(validation === undefined ? {} : { validation }) });
      const r = run(doc('', '![x](nope.png)\n<!-- ::BREAK -->\n'), fs);
      expect(r.enabled).toBe(false);
      expect(r.diagnostics).toEqual([]);
    }
  });

  it('true: every level on with its defaults', () => {
    const c = readConfig(true);
    expect(c.enabled).toBe(true);
    expect(LEVELS.every((l) => c.levels[l].on)).toBe(true);
    expect(c.strict).toBe(false);
  });

  it('an object: an unlisted level is on; false switches one off; an object is options (R-188)', () => {
    const c = readConfig({ required_fields: ['title'], styles: false, meta: { required_fields: ['owner'] }, strict: true, schema: 'x.json' });
    expect(c.levels.template.on).toBe(true);
    expect(c.levels.styles.on).toBe(false);
    expect(c.levels.meta.on).toBe(true);
    expect(c.requiredFields).toEqual(['owner']); // meta.required_fields wins over the legacy list
    expect(readConfig({ required_fields: ['title'] }).requiredFields).toEqual(['title']);
    expect(c.strict).toBe(true);
    expect(c.unknownKeys).toEqual(['schema']);
  });

  it('every level can be switched off by itself', () => {
    // A document that breaks every level at once
    const fs = project({
      $comment: 'x',
      resources: { template: 'bad.html', layout: 'bad.css', css: ['nocss.css'], fonts: ['nofont.woff2'] },
      validation: { required_fields: ['owner'] }
    }, { '/proj/profiles/bad.html': '<html></html>', '/proj/profiles/bad.css': 'p { color: red; }' });
    const text = doc('fancy_lists: false\n', 'a. one\nb. two\n\n<!-- ::BREAK -->\n\n![x](nope.png)\n\n<!-- ::LAYOUT(wide) -->\n');
    const all = run(text, fs);
    const levelsHit = new Set(all.diagnostics.map((d) => d.level));
    expect([...levelsHit].sort()).toEqual([...LEVELS].sort());
    for (const level of LEVELS) {
      const off = project({
        $comment: 'x',
        resources: { template: 'bad.html', layout: 'bad.css', css: ['nocss.css'], fonts: ['nofont.woff2'] },
        validation: { required_fields: ['owner'], [level]: false }
      }, { '/proj/profiles/bad.html': '<html></html>', '/proj/profiles/bad.css': 'p { color: red; }' });
      const r = run(text, off);
      expect(only(r, level)).toEqual([]);
      expect(r.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('strict: the profile or the caller makes warnings fail; notes never fail', () => {
    const warn = [{ severity: 'warning' }];
    expect(passes(warn)).toBe(true);
    expect(passes(warn, true)).toBe(false);
    expect(passes([{ severity: 'info' }], true)).toBe(true);
    expect(passes([{ severity: 'error' }])).toBe(false);
    expect(run(doc(), project({ validation: { strict: true } })).strict).toBe(true);
    expect(run(doc(), project({ validation: true }), { strict: true }).strict).toBe(true);
    expect(run(doc(), project({ validation: true })).strict).toBe(false);
  });

  it('sync and async give the same answer', async () => {
    const fs = project({ resources: OK_RESOURCES, validation: true });
    const text = doc('', '<!-- ::BREAK -->\n');
    const a = validateSync({ path: '/proj/doc.md', text }, {}, { fs, env });
    const b = await validate({ path: '/proj/doc.md', text }, {}, { fs: fs.async(), env });
    expect(b).toEqual(a);
    expect(codes(a)).toContain('unknown-directive');
  });
});

describe('always reported: frontmatter that can not be read, a profile that can not be loaded', () => {
  it('a YAML error is a parse error (as pagemd validate said), whatever the profile', () => {
    const r = run('---\ntitle: [unclosed\n---\n# x\n', project({}));
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ severity: 'error', code: 'frontmatter-error' });
    expect(r.diagnostics[0].message).toMatch(/^Parse error: Frontmatter YAML error: /);
  });

  it('frontmatter without a closing line is read to the end, as pagemd renders it (gray-matter)', () => {
    expect(frontmatterBlock('---\na: 1\n')).toEqual({ yaml: 'a: 1\n', endLine: 3 });
    expect(frontmatterBlock('----\n')).toBe(null);
    expect(frontmatterBlock('# x\n---\n')).toBe(null);
    expect(readFrontmatter('---\nwiki | [[x]] | y\n')).toBeDefined();
    expect(() => readFrontmatter('---\n[[Home]] | [[CLI]]: x: y\n')).toThrow(/Frontmatter YAML error/);
  });

  it('a profile that is not found: "Profile error: …"', () => {
    const r = run('---\nprofile: nowhere\n---\n', project({}));
    expect(r.diagnostics).toEqual([{ severity: 'error', level: 'profile', code: 'profile-error', message: 'Profile error: Profile not found in inheritance chain: nowhere' }]);
    expect(passes(r.diagnostics)).toBe(false);
  });

  it('an extends loop: "Profile error: …"', () => {
    const fs = project({ extends: 'q' }, { '/proj/profiles/q.json': json({ id: 'q', extends: 'p' }) });
    const r = run('---\nprofile: p\n---\n', fs);
    expect(r.diagnostics[0].code).toBe('profile-error');
    expect(r.diagnostics[0].message).toMatch(/Circular|circular/);
  });

  it('pagemd validate -p overrides the frontmatter; pagemd build -p only fills in (R-57)', () => {
    const fs = project({ validation: true });
    expect(run(doc(), fs, { profileOverride: 'quiet' }).profileId).toBe('quiet');
    expect(run(doc(), fs, { profile: 'quiet' }).profileId).toBe('p');
    expect(run('# none\n', fs, { profile: 'quiet' }).profileId).toBe('quiet');
  });
});

describe('level meta', () => {
  const fs = (validation) => project({ resources: OK_RESOURCES, validation: { ...onlyLevel('meta').validation, ...validation } });

  it('a missing required field: pagemd validate\'s own message', () => {
    const r = run('---\nprofile: p\n---\n# x\n', fs({ required_fields: ['document_id', 'title'] }));
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      'Missing required field: document_id (required by profile p)',
      'Missing required field: title (required by profile p)'
    ]);
    expect(r.diagnostics.every((d) => d.severity === 'error')).toBe(true);
  });

  it('R-187: a nickname counts (doc_id for document_id); so do other case and _ or -', () => {
    for (const fm of ['doc_id: X', 'docId: X', 'Document-ID: X', 'DOCUMENT_ID: X', 'document_id: X']) {
      const r = run(`---\nprofile: p\n${fm}\n---\n`, fs({ required_fields: ['document_id'] }));
      expect(codes(r)).not.toContain('missing-required-field');
    }
    // and the other way round: a profile that requires the nickname
    expect(codes(run('---\nprofile: p\ndocument_id: X\n---\n', fs({ required_fields: ['doc_id'] })))).not.toContain('missing-required-field');
  });

  it('a required field present but empty: a warning, on its line', () => {
    const r = run('---\nprofile: p\ntitle: ""\n---\n', fs({ required_fields: ['title'] }));
    expect(r.diagnostics).toEqual([{ severity: 'warning', level: 'meta', code: 'empty-required-field', message: "Required field 'title' is present but empty", where: { line: 2 } }]);
  });

  it('wrong types: a number, a yes/no, a choice, a date', () => {
    const r = run(doc('revision: Rev. 2\ntoc: maybe\ncolor_scheme: purple\neffective_date: someday\n'), fs({}));
    expect(only(r, 'meta').filter((d) => d.code === 'wrong-type').map((d) => d.message)).toEqual([
      'Property revision: "Rev. 2" should be a number',
      'Property toc: "maybe" should be true or false',
      'Property color_scheme: "purple" should be one of light, dark, auto',
      'Property effective_date: "someday" isn\'t a date pagemd can read (it is printed as written)'
    ]);
    const fine = run(doc('revision: "3"\ntoc: yes\ncolor_scheme: dark\neffective_date: 2024-01-15\n'), fs({}));
    expect(codes(fine)).not.toContain('wrong-type');
  });

  it('a gated item while its property is off: a lettered list without fancy_lists', () => {
    const body = '# H\n\na. one\nb. two\n';
    const r = run(doc('', body), fs({}));
    const gate = r.diagnostics.find((d) => d.code === 'gate-off');
    expect(gate.message).toMatch(/fancy_lists is not true, so this lettered or roman list prints as a numbered list/);
    expect(gate.where.line).toBe(7);
    expect(codes(run(doc('fancy_lists: true\n', body), fs({})))).not.toContain('gate-off');
    // the profile's default switches it on too (R-124)
    const viaProfile = project({ resources: OK_RESOURCES, metadata: { defaults: { fancy_lists: true } }, ...onlyLevel('meta') });
    expect(codes(run(doc('', body), viaProfile))).not.toContain('gate-off');
    expect(codes(run(doc('', '1. one\n2. two\n'), fs({})))).not.toContain('gate-off');
  });

  it('a property the template shows, written but empty: a note (a required one gets the warning instead)', () => {
    const r = run(doc('author: ""\n'), project({ resources: { ...OK_RESOURCES, template: 't.html' }, ...onlyLevel('meta') }, { '/proj/t.html': '{{metadata.author}}{{metadata.title}}' }));
    expect(r.diagnostics).toEqual([{ severity: 'info', level: 'meta', code: 'empty-shown-field', message: 'Property author is shown on the page but empty', where: { line: 4 } }]);
    expect(run(doc('author: Ann\n'), project({ resources: { ...OK_RESOURCES, template: 't.html' }, ...onlyLevel('meta') }, { '/proj/t.html': '{{metadata.author}}' })).diagnostics).toEqual([]);
  });

  it('properties nothing uses: one note listing them', () => {
    const r = run(doc('flavour: mint\ncolour: blue\n'), fs({}));
    const note = r.diagnostics.find((d) => d.code === 'unknown-property');
    expect(note).toMatchObject({ severity: 'info', message: '2 properties are not used by pagemd, the profile or the template: flavour, colour', where: { line: 4 } });
    // the template shows it, or the profile has a default for it: known
    const known = project({ resources: OK_RESOURCES, metadata: { defaults: { flavour: 'x' } }, ...onlyLevel('meta') });
    expect(run(doc('flavour: mint\n'), known).diagnostics).toEqual([]);
  });
});

describe('level profile', () => {
  it('a profile found by name whose id differs from its file name: a warning; one named by path: not checked', () => {
    const fs = project({ resources: OK_RESOURCES, ...onlyLevel('profile') }, {
      '/proj/profiles/named.json': json({ id: 'other', resources: OK_RESOURCES, ...onlyLevel('profile') })
    });
    const r = run('---\nprofile: named\n---\n', fs);
    expect(r.diagnostics).toEqual([expect.objectContaining({ severity: 'warning', code: 'profile-id-mismatch', message: "Profile ID 'other' does not match filename 'named'" })]);
    const byPath = run('---\nprofile: ./profiles/named.json\n---\n', fs);
    expect(codes(byPath)).not.toContain('profile-id-mismatch');
  });

  it('a setting the profile format does not have: a warning', () => {
    const r = run(doc(), project({ resources: OK_RESOURCES, colours: {}, ...onlyLevel('profile') }));
    expect(r.diagnostics.map((d) => d.message)).toEqual(["Profile p has a setting pagemd doesn't read: colours"]);
  });

  it('R-183: layout.source is still checked, with a gentle note; no false "no layout.source defined" for modern profiles', () => {
    const legacy = project({ layout: { type: 'html', source: '${cliPath}/templates/standard_letter.html' }, validation: { ...onlyLevel('profile').validation, template: true } });
    const r = run(doc(), legacy);
    expect(r.diagnostics).toEqual([expect.objectContaining({ severity: 'info', code: 'deprecated-setting', message: 'Profile p: `layout.source` is an old setting: use `resources.template` (and `resources.layout` for the page CSS)' })]);
    expect(passes(r.diagnostics, true)).toBe(true);
    // the old setting pointing nowhere: the template is reported missing
    const broken = project({ layout: { type: 'html', source: 'gone.html' }, validation: { ...onlyLevel('profile').validation, template: true } });
    expect(codes(run(doc(), broken))).toEqual(['deprecated-setting', 'template-not-found']);
    // a modern profile: nothing at all
    expect(run(doc(), project({ resources: OK_RESOURCES, validation: true })).diagnostics.filter((d) => /layout\.source/.test(d.message))).toEqual([]);
  });

  it('R-185: validation.schema is not a setting (any longer): a warning', () => {
    const r = run(doc(), project({ resources: OK_RESOURCES, validation: { ...onlyLevel('profile').validation, schema: 'fm.schema.json' } }));
    expect(r.diagnostics).toEqual([expect.objectContaining({ severity: 'warning', code: 'unknown-validation-setting', message: 'validation.schema is not a validation setting (validation.schema was never read and is no longer a setting)' })]);
  });
});

describe('level template', () => {
  const fs = (template, extra = {}) => project({ resources: { ...OK_RESOURCES, template }, ...onlyLevel('template') }, extra);

  it('not found: an error saying where it looked (R-184)', () => {
    const r = run(doc(), fs('nowhere.html'));
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ severity: 'error', code: 'template-not-found' });
    expect(r.diagnostics[0].message).toMatch(/^Template file not found: nowhere\.html \(looked in \d+ folders\)$/);
    expect(r.diagnostics[0].where.searched).toContain('/proj/templates');
  });

  it('R-184: found anywhere rendering looks, e.g. only in ~/.pagemd/templates/', () => {
    const r = run(doc(), fs('mine.html', { '/home/u/.pagemd/templates/mine.html': '{{styles}}{{content}}' }));
    expect(r.diagnostics).toEqual([]);
  });

  it('no {{content}}, no {{styles}}, an {{#if}} without {{/if}}: warnings', () => {
    const r = run(doc(), fs('t.html', { '/proj/t.html': '<html>{{#if metadata.title}}<h1>{{metadata.title}}</h1></html>' }));
    expect(codes(r)).toEqual(['no-content-token', 'no-styles-token', 'unbalanced-if']);
    expect(run(doc(), fs('t.html', { '/proj/t.html': '{{styles}}{{#if metadata.title}}x{{/if}}{{ content }}' })).diagnostics).toEqual([]);
  });

  it('properties the template shows that nothing sets: one note', () => {
    const r = run(doc(), fs('t.html', { '/proj/t.html': '{{styles}}{{content}}{{metadata.title}}{{metadata.company}}{{metadata.logo ?? ""}}' }));
    expect(r.diagnostics).toEqual([expect.objectContaining({ severity: 'info', code: 'unknown-template-property', message: "Template t.html shows 2 properties this document doesn't set and pagemd doesn't know, printed empty: company, logo" })]);
    expect(run(doc('company: X\nlogo: y.png\n'), fs('t.html', { '/proj/t.html': '{{styles}}{{content}}{{metadata.company}}{{metadata.logo}}' })).diagnostics).toEqual([]);
  });
});

describe('level layout', () => {
  const fs = (layout, extra = {}) => project({ resources: { ...OK_RESOURCES, layout }, ...onlyLevel('layout') }, extra);

  it('not found: an error, with the reason (R-183: resources.layout is checked)', () => {
    const r = run(doc(), fs('./nope.css'));
    expect(r.diagnostics).toEqual([expect.objectContaining({ severity: 'error', code: 'layout-not-found', message: 'Layout file not found: ./nope.css (resolved to /proj/profiles/nope.css)' })]);
  });

  it('R-184: a layout only in ~/.pagemd/styles/ is found, as rendering finds it (validate used to say "not found")', () => {
    expect(run(doc(), fs('home.css', { '/home/u/.pagemd/styles/home.css': '@page { size: A4; }' })).diagnostics).toEqual([]);
  });

  it('no @page rule in any stylesheet: a warning; a page the editor can not read: a note', () => {
    expect(codes(run(doc(), fs('l.css', { '/proj/l.css': 'p {}' })))).toEqual(['no-page-rule']);
    expect(codes(run(doc(), fs('l.css', { '/proj/l.css': '@page { margin: var(--m); }' })))).toEqual(['page-unreadable']);
  });

  it('LAYOUT(name) needs .page-name and @page name somewhere in the CSS', () => {
    const r = run(doc('', '# x\n\n<!-- ::LAYOUT(wide) -->\n\ntext\n'), fs('${cliPath}/layouts/letter.css'));
    expect(r.diagnostics).toEqual([expect.objectContaining({ severity: 'warning', code: 'layout-name-without-page-rule', where: { line: 7 } })]);
    expect(r.diagnostics[0].message).toBe('LAYOUT(wide) has no page rule (.page-wide { page: wide } and @page wide { … }): these pages look like the others');
    expect(run(doc('', '<!-- ::LAYOUT(landscape) -->\n\n<!-- ::LAYOUT(default) -->\n'), fs('${cliPath}/layouts/letter.css')).diagnostics).toEqual([]);
  });
});

describe('level styles', () => {
  const fs = (resources, extra = {}, more = {}) => project({ resources: { ...OK_RESOURCES, ...resources }, ...onlyLevel('styles'), ...more }, extra);

  it('a profile stylesheet or a styles: file not found: errors in pagemd validate\'s words', () => {
    const r = run(doc('styles: [mine.css]\n'), fs({ css: ['gone.css'] }));
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      expect.stringMatching(/^CSS file not found: gone\.css \(looked in \d+ folders\)$/),
      expect.stringMatching(/^Custom CSS file not found: mine\.css \(looked in \d+ folders\)$/)
    ]);
  });

  it('R-184: a stylesheet next to the profile that names it is found (the old no-search lookup missed it)', () => {
    expect(run(doc(), fs({ css: ['../styles/s.css'] }, { '/proj/styles/s.css': 'p{}' })).diagnostics).toEqual([]);
  });

  it('fonts and profile assets that are not there: warnings', () => {
    const r = run(doc(), fs({ fonts: ['gone.woff2', 'here.woff2'], assets: ['./logo.png', './gone.png'] }, { '/proj/profiles/here.woff2': 'x', '/proj/profiles/logo.png': 'x' }));
    expect(r.diagnostics.map((d) => [d.severity, d.message.replace(/ \(.*$/, '')])).toEqual([
      ['warning', 'Font file not found: gone.woff2'],
      ['warning', 'Profile asset not found: ./gone.png']
    ]);
  });

  it('braces that do not pair up, a url() file that is not there: warnings', () => {
    const r = run(doc(), fs({ css: ['./a.css'] }, {
      '/proj/profiles/a.css': '/* { */ p { content: "}"; background: url(img/bg.png); }\nh1 { color: red;\n@font-face { src: url("fonts/x.woff2"), url(data:font/woff2;base64,AAA), url(#f), url(https://x/y.woff); }',
      '/proj/profiles/fonts/x.woff2': 'x'
    }));
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      "Stylesheet a.css: its { and } don't pair up, so the rest of the file may be ignored",
      'File not found: img/bg.png, named in the stylesheet a.css (looked in /proj/profiles/img/bg.png and /proj/img/bg.png)'
    ]);
    expect(r.diagnostics[1]).toMatchObject({ severity: 'warning', code: 'template-asset-missing', where: { file: '/proj/profiles/a.css', searched: ['/proj/profiles/img/bg.png', '/proj/img/bg.png'] } });
  });

  it('FIX-template-asset-paths: a url() found in the document\'s folder (the old place) is not a warning', () => {
    const r = run(doc(), fs({ css: ['./a.css'] }, {
      '/proj/profiles/a.css': 'p { background: url(img/bg.png); }',
      '/proj/img/bg.png': 'png'
    }));
    expect(r.diagnostics).toEqual([]);
  });
});

describe('level template: template-asset-missing (FIX-template-asset-paths, R-259)', () => {
  const fs = (template, extra = {}) => project({ resources: { ...OK_RESOURCES, template: './t.html' }, ...onlyLevel('template') }, { '/proj/profiles/t.html': template, ...extra });

  it('a picture in neither place: a warning naming the path, the template and both places; found ones are quiet', () => {
    const r = run(doc(), fs('<html><head>{{styles}}</head><body><img src="../assets/logo.png"><img src=".pagemd/old.png"><img src="gone.png"><!-- <img src="x.png"> -->{{content}}</body></html>', { '/proj/assets/logo.png': 'png', '/proj/.pagemd/old.png': 'png' }));
    expect(r.diagnostics).toEqual([{
      severity: 'warning',
      level: 'template',
      code: 'template-asset-missing',
      message: 'File not found: gone.png, named in the template t.html (looked in /proj/profiles/gone.png and /proj/gone.png)',
      where: { file: '/proj/profiles/t.html', searched: ['/proj/profiles/gone.png', '/proj/gone.png'] }
    }]);
  });
});

describe('level syntax', () => {
  const fs = (extra = {}) => project({ resources: OK_RESOURCES, ...onlyLevel('syntax') }, extra);

  it('an unknown directive: a warning on its line; known ones are quiet', () => {
    const r = run(doc('', '# x\n\n<!-- ::BREAK -->\n\n<!-- ::PAGEBREAK -->\n'), fs());
    expect(r.diagnostics).toEqual([{ severity: 'warning', level: 'syntax', code: 'unknown-directive', message: "Unknown directive ::BREAK: pagemd doesn't know it and leaves it as a hidden comment", where: { line: 7 } }]);
  });

  it('footnotes (P26): a reference with no note, a note nothing refers to, two notes with one label', () => {
    const body = '# x\n\nA[^a] and B[^gone] and `[^code]`.\n\n[^a]: One.\n\n[^a]: Two.\n\n[^spare]: Unused.\n';
    const r = run(doc('', body), fs());
    expect(r.diagnostics.map((d) => [d.severity, d.code, d.where.line])).toEqual([
      ['warning', 'footnote-duplicate', 11],
      ['info', 'footnote-no-note', 7],
      ['info', 'footnote-unused', 13]
    ]);
    expect(r.diagnostics[1].message).toBe('Footnote [^gone] has no note ([^gone]: …), so pagemd prints it as text');
    // control: notes that are all referred to, once each, are quiet
    expect(run(doc('', '# x\n\nA[^a] and ^[inline].\n\n[^a]: One.\n'), fs()).diagnostics).toEqual([]);
  });

  it('an include that is not there: an error (from the document\'s folder, R-52)', () => {
    const r = run(doc('', '!!!include(parts/a.md)!!!\n\n!!!include(parts/b.md)!!!\n'), fs({ '/proj/parts/a.md': '# A' }));
    expect(r.diagnostics).toEqual([expect.objectContaining({ severity: 'error', code: 'include-not-found', message: 'Included file not found: parts/b.md (resolved to /proj/parts/b.md)', where: { line: 7 } })]);
  });

  describe('included files are read too (C12)', () => {
    it('a nested include that is not there: an error on the main file\'s include line, naming the file that includes it', () => {
      const r = run(doc('', '!!!include(parts/a.md)!!!\n'), fs({ '/proj/parts/a.md': '# A\n\n!!!include(deep/b.md)!!!\n' }));
      expect(r.diagnostics).toEqual([{ severity: 'error', level: 'syntax', code: 'include-not-found', message: 'Included file not found: deep/b.md (included by parts/a.md, resolved to /proj/parts/deep/b.md)', where: { line: 5 } }]);
    });

    it('an include that comes back to a file being included: include-circular (also back to the document itself)', () => {
      const r = run(doc('', '!!!include(a.md)!!!\n'), fs({ '/proj/a.md': '!!!include(b.md)!!!\n', '/proj/b.md': '!!!include(a.md)!!!\n' }));
      expect(r.diagnostics.map((d) => [d.severity, d.code, d.message])).toEqual([['error', 'include-circular', 'Included file a.md → b.md → a.md comes back to a file that is already being included, so pagemd prints a note instead']]);
      const self = run(doc('', '!!!include(doc.md)!!!\n'), fs({ '/proj/doc.md': '!!!include(doc.md)!!!\n' }));
      expect(codes(self)).toEqual(['include-circular']);
    });

    it('an included file\'s frontmatter: a note (it is ignored), whatever its YAML', () => {
      const r = run(doc('', '!!!include(a.md)!!!\n'), fs({ '/proj/a.md': '---\ntitle: [broken\n---\nText.\n' }));
      expect(r.diagnostics.map((d) => [d.severity, d.code])).toEqual([['info', 'include-frontmatter']]);
    });

    it('a page type left open: a warning; one the included text closes, or no LAYOUT at all, is quiet', () => {
      const open = run(doc('', '!!!include(a.md)!!!\n'), fs({ '/proj/a.md': '<!-- ::LAYOUT(wide) -->\n\nWide.\n' }));
      expect(open.diagnostics.map((d) => [d.severity, d.code, d.where.line])).toEqual([['warning', 'include-layout-open', 5]]);
      expect(open.diagnostics[0].message).toContain('<!-- ::LAYOUT(default) -->');
      const closed = run(doc('', '!!!include(a.md)!!!\n'), fs({ '/proj/a.md': '<!-- ::LAYOUT(wide) -->\n\nWide.\n\n<!-- ::LAYOUT(default) -->\n' }));
      expect(closed.diagnostics).toEqual([]);
      // The main file's page type before the include is the one to come back to
      const inWide = run(doc('', '<!-- ::LAYOUT(wide) -->\n\n!!!include(a.md)!!!\n'), fs({ '/proj/a.md': '<!-- ::LAYOUT(default) -->\n\nPlain.\n' }));
      expect(inWide.diagnostics[0].message).toContain('<!-- ::LAYOUT(wide) -->');
      // A LAYOUT inside a code fence counts for nothing
      expect(run(doc('', '!!!include(a.md)!!!\n'), fs({ '/proj/a.md': '```\n<!-- ::LAYOUT(wide) -->\n```\n' })).diagnostics).toEqual([]);
    });

    it('an include mid-line or inside code: a note (it is not expanded); an include on its own line is quiet', () => {
      const r = run(doc('', 'See !!!include(a.md)!!! here.\n\n```\n!!!include(a.md)!!!\n```\n'), fs({ '/proj/a.md': 'A.\n' }));
      expect(r.diagnostics.map((d) => [d.severity, d.code, d.where.line])).toEqual([['info', 'include-not-alone', 5], ['info', 'include-not-alone', 8]]);
      expect(run(doc('', '!!!include(a.md)!!!\n'), fs({ '/proj/a.md': 'A.\n' })).diagnostics).toEqual([]);
    });
  });

  it('FIGURE under a picture line (the readable style) is quiet; one with no picture is a warning (R-253)', () => {
    expect(run(doc('', '![A](a.png "Cap")\n<!-- ::FIGURE id="x" -->\n'), fs()).diagnostics.filter((d) => d.code === 'figure-orphan')).toEqual([]);
    const r = run(doc('', 'Some text\n\n<!-- ::FIGURE id="x" -->\n'), fs());
    expect(r.diagnostics.filter((d) => d.code === 'figure-orphan').map((d) => d.severity)).toEqual(['warning']);
  });

  it('FIGURE settings pagemd ignores: warnings; good ones are quiet', () => {
    const r = run(doc('', '<!-- ::FIGURE src="a.png" height="tall" width="huge" crop-x="150" crop-fit="zoom" colour="red" -->\n'), fs());
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      'FIGURE: it has no setting "colour"',
      'FIGURE: height="tall" is not a CSS length (e.g. 300px, 50%, auto), so it is ignored',
      'FIGURE: width="huge" is neither full, half, third, quarter nor a CSS length',
      'FIGURE: crop-fit="zoom" must be one of cover, contain, fill, scale-down',
      // C13: a crop may also be a CSS length (picture-crop)
      'FIGURE: crop-x="150" must be a % of the picture from 0 to 100 or a CSS length (e.g. 300px, 12em), so it is ignored'
    ]);
    expect(run(doc('', '<!-- ::FIGURE src="a.png" height="300px" width="half" crop-x="33.3" crop-fit="cover" caption="C" -->\n'), fs()).diagnostics).toEqual([]);
  });

  it('table column widths pagemd does not accept: a warning on the table\'s line; good ones are quiet (P19)', () => {
    const r = run(doc('', '| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |\n{data-col-widths="1 2in 70%"}\n'), fs());
    expect(r.diagnostics.map((d) => [d.code, d.where.line, d.message])).toEqual([
      ['table-widths', 5, 'Table column widths: "1" could mean 1 % or the whole table: write 1% or 100% (it counts as not set)'],
      ['table-widths', 5, 'Table column widths: "2in" is not a width (write 30%, 30, or 0.3 for 30 %; * for not set): it counts as not set']
    ]);
    expect(run(doc('', '| A | B |\n|---|---|\n| 1 | 2 |\n{data-col-widths="80% 0.3"}\n'), fs()).diagnostics.map((d) => d.message)).toEqual(['Table column widths: the widths add up to 110 %, more than the table (the browser scales them down)']);
    expect(run(doc('', '| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |\n{data-col-widths="30.5% 0.25 *"}\n'), fs()).diagnostics).toEqual([]);
  });

  it('the hidden <!-- ::TABLE --> comment: its values are checked the same way; one not under a table is reported (P19)', () => {
    const r = run(doc('', '| A | B |\n|---|---|\n| 1 | 2 |\n<!-- ::TABLE widths="1 50%" -->\n\nText.\n\n<!-- ::TABLE widths="equal" -->\n'), fs());
    expect(r.diagnostics.map((d) => [d.code, d.where.line])).toEqual([['table-widths', 5], ['table-directive-alone', 12]]);
    expect(run(doc('', '| A | B |\n|---|---|\n| 1 | 2 |\n<!-- ::TABLE widths="equal" -->\n'), fs()).diagnostics).toEqual([]);
  });

  it('a FIGURE over several lines is not read: a warning (not inside a code fence)', () => {
    const r = run(doc('', '<!-- ::FIGURE src="a.png"\ncaption="x" -->\n\n```\n<!-- ::FIGURE src="b.png"\n```\n'), fs());
    expect(r.diagnostics.map((d) => [d.code, d.where.line])).toEqual([['figure-multiline', 5]]);
  });

  it('an annotated image whose YAML can not be read: a warning', () => {
    const r = run(doc('', '::: annotated-image shot.png\nmarkers: [unclosed\n:::\n'), fs());
    expect(codes(r)).toEqual(['annotation-yaml']);
    expect(run(doc('', '::: annotated-image shot.png\nmarkers:\n  - { x: 1, y: 2, label: A }\n:::\n'), fs()).diagnostics).toEqual([]);
  });

  // pagemd-editor C13 (R-249 to R-251). Control for each: the rule removed in turn (the As built records the run).
  const ai = (yaml, path = 'shot.png') => `::: annotated-image ${path}\n${yaml}\n:::\n`;

  it('picture keys (C13): crop, shift, rotate and flip values pagemd ignores: warnings, on both forms; good ones are quiet', () => {
    const r = run(doc('', ai('options:\n  crop-x: 150\n  crop-y: "10px;x"\n  pos-x: left\n  rotate: 45\n  flip: x') + '\n<!-- ::FIGURE src="a.png" crop-y="abc" rotate="91" flip="hh" -->\n'), fs({ '/proj/shot.png': 'x', '/proj/a.png': 'x' }));
    expect(r.diagnostics.map((d) => [d.severity, d.code])).toEqual([
      ['warning', 'picture-crop'], ['warning', 'picture-crop'], ['warning', 'picture-crop'], ['warning', 'picture-rotate'], ['warning', 'picture-flip'],
      ['warning', 'picture-crop'], ['warning', 'picture-rotate'], ['warning', 'picture-flip']
    ]);
    const good = ai('options:\n  crop-x: 300px\n  crop-y: 50\n  pos-x: -2em\n  rotate: 90\n  flip: hv') + '\n<!-- ::FIGURE src="a.png" crop-x="12em" crop-y="40%" rotate="270" flip="h" -->\n';
    expect(run(doc('', good), fs()).diagnostics).toEqual([]);
  });

  it('marker size (C13): not a number, or outside 0.5-4: a warning', () => {
    const r = run(doc('', ai('markers:\n  - { id: 1, x: 1, y: 2, label: A, size: big }\n  - { id: 2, x: 1, y: 2, label: B, size: 9 }\n  - { id: 3, x: 1, y: 2, label: C, size: 2.5 }')), fs());
    expect(r.diagnostics.map((d) => [d.code, d.message])).toEqual([
      ['marker-size', 'Annotated image shot.png: marker 1 has size "big", not a number, so 1 is used'],
      ['marker-size', 'Annotated image shot.png: marker 2 has size 9, outside 0.5–4, so 4 is used']
    ]);
  });

  it('shapes a % crop hides (C13): info, naming them', () => {
    const r = run(doc('', ai('options:\n  crop-x: 50\nmarkers:\n  - { id: 1, x: 80, y: 2, label: A }\n  - { id: 2, x: 10, y: 2, label: B }')), fs());
    expect(r.diagnostics.map((d) => [d.severity, d.code, d.message])).toEqual([
      ['info', 'annotation-hidden-by-crop', 'Annotated image shot.png: 1 shape(s) lie wholly in the part the crop cuts away, so they are hidden (they stay in the YAML): markers 1']
    ]);
  });

  it('redaction (C13, provisional): not rectangles, a web address, a format or a file pagemd can\'t bake: errors; past the edge: a warning', () => {
    const files = { '/proj/shot.png': 'x', '/proj/s.bmp': 'x' };
    const check = (body) => run(doc('', body), fs(files)).diagnostics.map((d) => [d.severity, d.code]);
    expect(check(ai('redact:\n  - { x: 1, y: 2 }'))).toEqual([['error', 'redact-rect']]);
    expect(check(ai('redact: all'))).toEqual([['error', 'redact-rect']]);
    expect(check(ai('redact:\n  - { x: 90, y: 0, width: 20, height: 5 }'))).toEqual([['warning', 'redact-rect']]);
    expect(check(ai('redact:\n  - { x: 1, y: 2, width: 3, height: 4 }', 'https://x.test/a.png'))).toEqual([['error', 'redact-url']]);
    expect(check(ai('redact:\n  - { x: 1, y: 2, width: 3, height: 4 }', 's.bmp'))).toEqual([['error', 'redact-unreadable']]);
    expect(check(ai('redact:\n  - { x: 1, y: 2, width: 3, height: 4 }', 'gone.png'))).toEqual([['error', 'redact-unreadable']]);
    expect(check(ai('redact:\n  - { x: 1, y: 2, width: 3, height: 4 }'))).toEqual([]);
  });
});

describe('level assets', () => {
  const fs = (extra = {}) => project({ resources: OK_RESOURCES, ...onlyLevel('assets') }, extra);

  it('images that are not there, in every form: warnings on their lines; web links and data: are skipped', () => {
    const body = '![a](img/here.png)\n\n![b](img/gone.png)\n\n<!-- ::FIGURE src="img/fig.png" -->\n\n![[img/embed.png]]\n\n<img src="img/html.png">\n\n![w](https://x/y.png) ![d](data:image/png;base64,AA)\n';
    const r = run(doc('', body), fs({ '/proj/img/here.png': 'x' }));
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      'Image not found: img/gone.png',
      'Image not found: img/fig.png',
      'Image not found: img/embed.png',
      'Image not found: img/html.png'
    ]);
    expect(r.diagnostics[0].where.line).toBe(7);
  });

  it('a path starting with / says so; a format the PDF can not show: a warning', () => {
    const r = run(doc('', '![a](/img/x.png)\n\n![b](pic.heic)\n'), fs({ '/proj/pic.heic': 'x' }));
    expect(r.diagnostics.map((d) => d.code)).toEqual(['image-not-found', 'image-format']);
    expect(r.diagnostics[0].message).toMatch(/a path starting with \/ is read from the root of the disk/);
    expect(r.diagnostics[1].message).toBe("Image pic.heic: the PDF can't show .heic images (use png, jpg, gif, svg or webp)");
  });
});

describe('lookupReason (R-184)', () => {
  it('one line for each way a lookup fails', () => {
    expect(lookupReason(Object.assign(new Error('x'), { searchedPaths: ['/a', '/b'] }))).toBe('looked in 2 folders');
    expect(lookupReason(Object.assign(new Error('x'), { duplicates: ['/a/x.css', '/b/x.css'] }))).toBe('found in more than one place: /a/x.css, /b/x.css');
    expect(lookupReason(new Error('Relative path not found: ./x.css (resolved to /p/x.css)'))).toBe('resolved to /p/x.css');
    expect(lookupReason(new Error('Absolute path not found: /x.css'))).toBe('no such file');
  });
});
