/**
 * resolveDocument(), project root, discovery, the drivers and the in-memory FileSystem (phase C4).
 */

import { describe, it, expect } from 'vitest';
import {
  createMemoryFileSystem,
  resolveDocument,
  resolveDocumentSync,
  findProjectRootSync,
  discoverResourcesSync,
  getResourceDirectories,
  resolveTemplateSync,
  profileStylesheets,
  runSync,
  runAsync,
  fsOp,
  createPathContext,
  DEFAULT_TEMPLATE_PATH,
  loadAndMergeProfileSync,
  mergeProfiles,
  resourceFolder
} from '../src/index.js';

const env = { homePath: '/home/u', cwd: '/work', defaultsPath: '/cli' };
const json = (o) => JSON.stringify(o);

function project(extra = {}) {
  return createMemoryFileSystem({
    '/proj/package.json': '{}',
    '/proj/docs/a.md': '# A',
    '/proj/docs/own.css': 'p{}',
    '/cli/profiles/standard_letter.json': json({
      id: 'standard_letter',
      resources: {
        template: '${cliPath}/templates/standard_letter.html',
        layout: '${cliPath}/layouts/letter.css',
        css: ['${cliPath}/styles/primary.css']
      }
    }),
    '/cli/profiles/sop.json': json({ id: 'sop', extends: 'standard_letter', metadata: { defaults: { styles: ['own.css'] } } }),
    '/cli/profiles/legacy.json': json({ id: 'legacy', layout: { source: 'legacy.html', css: 'legacy-layout.css' }, styles: { profile: 'legacy-a.css' } }),
    '/cli/profiles/bare.json': json({ id: 'bare' }),
    '/cli/profiles/holes.json': json({ id: 'holes', resources: { template: 'none.html', layout: 'none.css', css: ['base.css', 'x/primary.css', 'none2.css'] } }),
    '/cli/templates/standard_letter.html': '<html>',
    '/cli/templates/legacy.html': '<html>',
    '/cli/layouts/letter.css': '@page{}',
    '/cli/styles/legacy-layout.css': '',
    '/cli/layouts/only-in-layouts.css': '',
    '/cli/styles/legacy-a.css': '',
    '/cli/styles/base.css': '',
    '/cli/styles/primary.css': '',
    '/cli/styles/syntax/shiki-base.css': '',
    ...extra
  });
}

describe('resolveDocument', () => {
  it('a document with no profile: the default profile, its template, layout and CSS, every source', () => {
    const d = resolveDocumentSync('/proj/docs/a.md', {}, { fs: project(), env });
    expect(d.projectRoot).toBe('/proj');
    expect(d.markdownDir).toBe('/proj/docs');
    expect(d.cliPath).toBe('/cli');
    expect(d.profileId).toBe('standard_letter');
    expect(d.profileChain).toEqual([{ id: 'standard_letter', path: '/cli/profiles/standard_letter.json' }]);
    expect(d.template).toEqual({ source: '${cliPath}/templates/standard_letter.html', usedDefault: false, path: '/cli/templates/standard_letter.html' });
    expect(d.layout).toEqual({ source: '${cliPath}/layouts/letter.css', path: '/cli/layouts/letter.css' });
    expect(d.styles).toEqual([{ source: '${cliPath}/styles/primary.css', skipped: true }]);
    expect(d.frontmatterStyles).toEqual([]);
    expect(d.system).toEqual({ base: '/cli/styles/base.css', primary: '/cli/styles/primary.css', syntax: '/cli/styles/syntax/shiki-base.css' });
    expect(d.sources).toEqual([
      '/cli/profiles/standard_letter.json',
      '/cli/templates/standard_letter.html',
      '/cli/layouts/letter.css',
      '/cli/styles/base.css',
      '/cli/styles/primary.css',
      '/cli/styles/syntax/shiki-base.css'
    ]);
    expect(d.problems).toEqual([]);
    expect(d.pathContext).toMatchObject({ markdownDir: '/proj/docs', projectRoot: '/proj', manifestDir: '/cli/profiles', cliPath: '/cli' });
  });

  it('the frontmatter profile beats the option; the chain lists every file; profile defaults feed styles:', () => {
    const d = resolveDocumentSync('/proj/docs/a.md', { frontmatter: { pipeline_profile: 'sop' }, profile: 'bare' }, { fs: project(), env });
    expect(d.profileId).toBe('sop');
    expect(d.profileChain.map((p) => p.path)).toEqual(['/cli/profiles/sop.json', '/cli/profiles/standard_letter.json']);
    expect(d.frontmatterStyles).toEqual([{ source: 'own.css', path: '/proj/docs/own.css' }]);
    expect(d.metadata.styles).toEqual(['own.css']);
    expect(resolveDocumentSync('/proj/docs/a.md', { profile: 'bare' }, { fs: project(), env }).profileId).toBe('bare');
  });

  it('overrides (renderMarkdown options.metadata) are layered last', () => {
    const d = resolveDocumentSync('/proj/docs/a.md', {
      frontmatter: { pipeline_profile: 'sop', styles: ['nope.css'] },
      metadata: { styles: ['own.css'] }
    }, { fs: project(), env });
    expect(d.frontmatterStyles).toEqual([{ source: 'own.css', path: '/proj/docs/own.css' }]);
  });

  it('what used to be createRenderContext: profiles are searched from the document, else the project root', () => {
    const fs = project({ '/proj/docs/.pagemd/profiles/near.json': json({ id: 'near' }), '/proj/profiles/far.json': json({ id: 'far' }) });
    expect(resolveDocumentSync('/proj/docs/a.md', { profile: 'near' }, { fs, env }).profile.id).toBe('near');
    expect(resolveDocumentSync('/proj/docs/a.md', { profile: 'far' }, { fs, env }).profile.id).toBe('far');
    // No document: searched from the project root
    const noDoc = resolveDocumentSync(null, { profile: 'far', projectRoot: '/proj' }, { fs, env });
    expect(noDoc.profile.id).toBe('far');
    expect(noDoc.markdownDir).toBeNull();
    expect(() => resolveDocumentSync(null, { profile: 'near', projectRoot: '/proj' }, { fs, env }))
      .toThrow('Profile not found in inheritance chain: near');
  });

  it('the project root: given (even null) or searched from the document, else the working folder', () => {
    const fs = project();
    expect(resolveDocumentSync('/proj/docs/a.md', { projectRoot: '/elsewhere' }, { fs, env }).projectRoot).toBe('/elsewhere');
    expect(resolveDocumentSync('/proj/docs/a.md', { projectRoot: null }, { fs, env }).projectRoot).toBeNull();
    expect(resolveDocumentSync(null, {}, { fs, env: { ...env, cwd: '/proj/docs' } }).projectRoot).toBe('/proj');
  });

  it('legacy profiles: layout.source template, layout.css layout, styles.profile CSS', () => {
    const d = resolveDocumentSync('/proj/docs/a.md', { profile: 'legacy' }, { fs: project(), env });
    expect(d.template.path).toBe('/cli/templates/legacy.html');
    // A layout is looked up like any stylesheet: in styles/ folders, never layouts/ (the code's
    // behaviour; bundled profiles name ${cliPath}/layouts/… in full)
    expect(d.layout.path).toBe('/cli/styles/legacy-layout.css');
    const onlyLayouts = resolveDocumentSync('/proj/docs/a.md', { profile: 'legacy2' }, {
      fs: project({ '/cli/profiles/legacy2.json': json({ id: 'legacy2', resources: { template: 'legacy.html', layout: 'only-in-layouts.css' } }) }),
      env
    });
    expect(onlyLayouts.layout.error.message).toMatch(/^Resource not found: only-in-layouts.css/);
    expect(onlyLayouts.layout.error.searchedPaths).not.toContain('/cli/layouts');
    expect(d.legacyStyles).toBe(true);
    expect(d.styles).toEqual([{ source: 'legacy-a.css', path: '/cli/styles/legacy-a.css' }]);
  });

  it('missing files do not stop it: each entry carries its error, problems list them', () => {
    const d = resolveDocumentSync('/proj/docs/a.md', { profile: 'holes', frontmatter: { styles: ['${homeless}/x.css', 'gone.css'] } }, { fs: project(), env });
    expect(d.template.error.message).toMatch(/^Resource not found: none.html/);
    expect(d.layout.error.message).toMatch(/^Resource not found: none.css/);
    expect(d.styles.map((s) => s.skipped || s.error?.message.split('\n')[0])).toEqual([true, true, 'Resource not found: none2.css']);
    expect(d.frontmatterStyles[0].error.stage).toBe('search'); // ${homeless} isn't a token: searched as written
    expect(d.frontmatterStyles[1].error.searchedPaths.length).toBeGreaterThan(0);
    expect(d.problems.map((p) => p.kind)).toEqual(['template', 'frontmatter-style', 'frontmatter-style', 'layout', 'style']);
  });

  it('a token without a value is a problem at the tokens stage', () => {
    const d = resolveDocumentSync('/proj/docs/a.md', {
      profile: 'bare',
      projectRoot: null,
      frontmatter: { styles: ['${workspacePath}/x.css'] }
    }, { fs: project(), env });
    expect(d.frontmatterStyles[0].error.stage).toBe('tokens');
    expect(d.frontmatterStyles[0].error.message).toBe('Token ${workspacePath} used but not defined in context');
    // The default template names ${projectRoot}, which has no value either
    expect(d.template.error.message).toMatch(/^Token \$\{projectRoot\} used but not defined/);
  });

  it('a profile without a template uses DEFAULT_TEMPLATE_PATH (the workspace templates/ folder)', () => {
    const fs = project({ '/proj/templates/standard_letter.html': '<html>' });
    const d = resolveDocumentSync('/proj/docs/a.md', { profile: 'bare' }, { fs, env });
    expect(d.template).toEqual({ source: DEFAULT_TEMPLATE_PATH, usedDefault: true, path: '/proj/templates/standard_letter.html' });
    const missing = resolveDocumentSync('/proj/docs/a.md', { profile: 'bare' }, { fs: project(), env });
    expect(missing.template.usedDefault).toBe(true);
    expect(missing.template.error).toBeDefined();
  });

  it('the async form gives the same answer', async () => {
    const opts = { frontmatter: { pipeline_profile: 'sop' } };
    const a = resolveDocumentSync('/proj/docs/a.md', opts, { fs: project(), env });
    const b = await resolveDocument('/proj/docs/a.md', opts, { fs: project().async(), env });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('an unknown profile throws, as pagemd always has', () => {
    expect(() => resolveDocumentSync('/proj/docs/a.md', { profile: 'nope' }, { fs: project(), env }))
      .toThrow('Profile not found in inheritance chain: nope');
  });
});

describe("R-136: a profile's relative paths start from that profile's own folder, also under extends", () => {
  // A shared profile in /proj/shared names its files every way a profile can, relative to its own folder; a
  // per-document profile in /proj/docs/.pagemd/profiles extends it (P5's create-layout).
  const shared = {
    '/proj/shared/profiles/house.json': json({
      id: 'house',
      resources: { template: './house.html', layout: '../layouts/house.css', css: ['house-own.css', '${manifestPath}/../styles/house-token.css'] }
    }),
    '/proj/shared/profiles/house.html': '<html>',
    '/proj/shared/layouts/house.css': '@page{}',
    '/proj/shared/profiles/house-own.css': '',
    '/proj/shared/styles/house-token.css': ''
  };
  const child = (resources) => json({ id: 'doc', extends: '../shared/profiles/house.json' /* read from the document's folder */, ...(resources ? { resources } : {}) });

  it('inherited template, layout and CSS resolve from the parent profile\'s folder (./, ../, a bare name, ${manifestPath})', () => {
    const fs = project({ ...shared, '/proj/docs/.pagemd/profiles/doc.json': child() });
    const d = resolveDocumentSync('/proj/docs/a.md', { frontmatter: { pipeline_profile: './.pagemd/profiles/doc.json' } }, { fs, env });
    expect(d.problems).toEqual([]);
    expect(d.template.path).toBe('/proj/shared/profiles/house.html');
    expect(d.layout.path).toBe('/proj/shared/layouts/house.css');
    expect(d.styles.map((s) => s.path)).toEqual(['/proj/shared/profiles/house-own.css', '/proj/shared/profiles/../styles/house-token.css']);
    // `_manifestDir` stays the named (child) profile's folder
    expect(d.profile._manifestDir).toBe('/proj/docs/.pagemd/profiles');
    expect(d.pathContext.manifestPath).toBe('/proj/docs/.pagemd/profiles');
  });

  it("a child that overrides a resource uses the child's folder for it; the rest stays the parent's", () => {
    const fs = project({ ...shared, '/proj/docs/.pagemd/profiles/doc.json': child({ layout: '../layouts/doc.css' }), '/proj/docs/.pagemd/layouts/doc.css': '@page{}' });
    const d = resolveDocumentSync('/proj/docs/a.md', { frontmatter: { pipeline_profile: './.pagemd/profiles/doc.json' } }, { fs, env });
    expect(d.problems).toEqual([]);
    expect(d.layout.path).toBe('/proj/docs/.pagemd/layouts/doc.css');
    expect(d.styles.map((s) => s.path)).toEqual(['/proj/shared/profiles/house-own.css', '/proj/shared/profiles/../styles/house-token.css']);
    expect(d.template.path).toBe('/proj/shared/profiles/house.html');
  });

  it('`null` in a child inherits the parent\'s value and its folder; arrays replaced whole take the child\'s folder', () => {
    const fs = project({
      ...shared,
      '/proj/docs/.pagemd/profiles/doc.json': child({ layout: null, css: ['doc-own.css'] }),
      '/proj/docs/.pagemd/profiles/doc-own.css': ''
    });
    const d = resolveDocumentSync('/proj/docs/a.md', { frontmatter: { pipeline_profile: './.pagemd/profiles/doc.json' } }, { fs, env });
    expect(d.problems).toEqual([]);
    expect(d.layout.path).toBe('/proj/shared/layouts/house.css');
    expect(d.styles.map((s) => s.path)).toEqual(['/proj/docs/.pagemd/profiles/doc-own.css']);
  });

  it('resourceFolder / mergeProfiles: the folder of the profile that wrote each resource, through a chain of three', () => {
    const fs = project({
      '/a/p/top.json': json({ id: 'top', resources: { template: 't.html', css: ['top.css'] } }),
      '/b/p/mid.json': json({ id: 'mid', extends: '/a/p/top.json', resources: { layout: 'mid.css' } }),
      '/c/p/low.json': json({ id: 'low', extends: '/b/p/mid.json', layout: { source: 'legacy.html' } })
    });
    const merged = loadAndMergeProfileSync('/c/p/low.json', {}, { fs, env });
    expect(resourceFolder(merged, 'resources.template')).toBe('/a/p');
    expect(resourceFolder(merged, 'resources.css')).toBe('/a/p');
    expect(resourceFolder(merged, 'resources.layout')).toBe('/b/p');
    expect(resourceFolder(merged, 'layout.source')).toBe('/c/p');
    expect(resourceFolder(merged, 'resources.fonts')).toBe('/c/p'); // nobody wrote it: the profile's own folder
    expect(merged._manifestDir).toBe('/c/p');
    // A profile read on its own, or merged by hand, answers the same way
    expect(resourceFolder({ _manifestDir: '/x' }, 'resources.css')).toBe('/x');
    const byHand = mergeProfiles({ _manifestDir: '/p1', resources: { css: ['a.css'] } }, { _manifestDir: '/p2', resources: { layout: 'b.css' } });
    expect([resourceFolder(byHand, 'resources.css'), resourceFolder(byHand, 'resources.layout')]).toEqual(['/p1', '/p2']);
  });

  it('one profile without extends: unchanged (its own folder for everything)', () => {
    const fs = project({ ...shared });
    const d = resolveDocumentSync('/proj/docs/a.md', { frontmatter: { pipeline_profile: '../shared/profiles/house.json' } }, { fs, env });
    expect(d.problems).toEqual([]);
    expect(d.layout.path).toBe('/proj/shared/layouts/house.css');
    expect(d.pathContext.manifestPath).toBe('/proj/shared/profiles');
  });

  it("the duplicate check still applies at the parent's tiers (a name found twice is an error)", () => {
    const fs = project({ ...shared, '/proj/docs/house-own.css': '', '/proj/docs/.pagemd/profiles/doc.json': child() });
    const d = resolveDocumentSync('/proj/docs/a.md', { frontmatter: { pipeline_profile: './.pagemd/profiles/doc.json' } }, { fs, env });
    expect(d.problems.map((p) => p.message.split('\n')[0])).toEqual(['Duplicate resources found for "house-own.css":']);
  });
});

describe('templates and stylesheets named by a profile', () => {
  it('profileStylesheets: layout and CSS in order; base/primary entries skipped', () => {
    expect(profileStylesheets({ resources: { layout: 'l.css', css: ['a.css', 'base.css', 'dir/primary.css', 'b.css'] } })).toEqual({
      layout: 'l.css',
      legacy: false,
      styles: [
        { source: 'a.css', skipped: false },
        { source: 'base.css', skipped: true },
        { source: 'dir/primary.css', skipped: true },
        { source: 'b.css', skipped: false }
      ]
    });
    expect(profileStylesheets({})).toEqual({ layout: null, legacy: false, styles: [] });
    expect(profileStylesheets({ styles: { profile: ['x.css', 'y.css'] } }).styles.map((s) => s.source)).toEqual(['x.css', 'y.css']);
  });

  it('a template is searched in the profile folder too (sourceType profile)', () => {
    const fs = createMemoryFileSystem({ '/mine/t.html': '' });
    const ctx = createPathContext({ markdownDir: '/d', projectRoot: '/p' }, { env });
    const t = resolveTemplateSync({ resources: { template: 't.html' }, _manifestDir: '/mine' }, ctx, {}, { fs, env });
    expect(t.path).toBe('/mine/t.html');
  });
});

describe('project root and discovery', () => {
  it('findProjectRoot: the nearest folder with package.json, .git (file or folder) or .pagemdrc', () => {
    const fs = createMemoryFileSystem({ '/a/package.json': '', '/a/b/.pagemdrc': '', '/g/.git/HEAD': '', '/w/.git': 'gitdir: x' }, { dirs: ['/a/b/c', '/n/m'] });
    expect(findProjectRootSync('/a/b/c', { fs, env })).toBe('/a/b');
    expect(findProjectRootSync('/g/x', { fs, env })).toBe('/g');
    expect(findProjectRootSync('/w/x', { fs, env })).toBe('/w');
    expect(findProjectRootSync('/n/m', { fs, env })).toBeNull();
    // .pagemrc (the config file name) is not a marker
    expect(findProjectRootSync('/q', { fs: createMemoryFileSystem({ '/q/.pagemrc': '' }), env })).toBeNull();
  });

  it('discoverResources: the bundled folder, then .pagemd/ replacing same names; sorted', () => {
    const fs = createMemoryFileSystem({
      '/r/profiles/b.json': json({ id: 'b', description: 'B' }),
      '/r/profiles/a.yaml': 'id: a\nextends: b\n',
      '/r/profiles/notes.txt': '',
      '/r/.pagemd/profiles/b.json': json({ id: 'b', description: 'mine' })
    }, { dirs: ['/r/profiles/sub.json'] });
    const only = discoverResourcesSync('profiles', '/r', {}, { fs, env });
    expect(only.map((r) => [r.name, r.source, r.description])).toEqual([['a', 'project', null], ['b', 'project', 'B']]);
    expect(only[0].extends).toBe('b');
    const both = discoverResourcesSync('profiles', '/r', { includeWorkspace: true }, { fs, env });
    expect(both.map((r) => [r.name, r.source, r.description])).toEqual([['a', 'project', null], ['b', 'workspace', 'mine']]);
    expect(() => discoverResourcesSync('fonts', '/r', {}, { fs, env })).toThrow("Unknown resource type: 'fonts'");
    expect(getResourceDirectories('layouts', '/r', { env })).toEqual({ project: '/r/layouts', workspace: '/r/.pagemd/layouts' });
  });
});

describe('drivers and the FileSystem port', () => {
  function* reader(path) {
    try {
      return yield fsOp.readText(path);
    } catch (err) {
      return `caught: ${err.code}`;
    }
  }

  it('file errors are thrown back into the lookup, in both drivers', async () => {
    const fs = createMemoryFileSystem({ '/f': 'text' });
    expect(runSync(reader('/f'), fs)).toBe('text');
    expect(runSync(reader('/g'), fs)).toBe('caught: ENOENT');
    expect(await runAsync(reader('/g'), fs.async())).toBe('caught: ENOENT');
  });

  it('the sync driver refuses a FileSystem that answers with Promises', () => {
    const fs = createMemoryFileSystem({ '/f': 'text' }).async();
    expect(runSync(reader('/f'), fs)).toBe('caught: undefined');
    expect(() => runSync((function* () { return yield fsOp.exists('/f'); })(), fs)).toThrow(/answered exists\(\) with a Promise/);
  });

  it('a missing port method or an unknown request is an error', () => {
    expect(() => runSync((function* () { return yield fsOp.list('/'); })(), {})).toThrow('The FileSystem port has no list()');
    expect(() => runSync((function* () { return yield { op: 'write', path: '/' }; })(), {})).toThrow('Unknown file request: write');
  });

  it('the in-memory FileSystem: files, implicit and explicit folders, listing, sizes', () => {
    const fs = createMemoryFileSystem({ '/a/b.txt': 'é', '/a/c/d.txt': '' }, { dirs: ['/e'] });
    expect(fs.exists('/a')).toBe(true);
    expect(fs.exists('/e/')).toBe(true);
    expect(fs.exists('/x')).toBe(false);
    expect(fs.list('/a')).toEqual(['b.txt', 'c']);
    expect(fs.stat('/a/b.txt')).toEqual({ isFile: true, isDirectory: false, size: 2 });
    expect(fs.stat('/a/c')).toEqual({ isFile: false, isDirectory: true, size: 0 });
    expect(fs.stat('/x')).toBeNull();
    expect(() => fs.list('/x')).toThrow(/ENOENT/);
  });
});
