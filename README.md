# pagemd-common

Shared, browser-safe packages used by both the **pagemd** CLI and **pagemd-editor**, so the two can
never disagree about pagemd syntax.

> **Status:** published as packages for pagemd and pagemd-editor. To work on all three, clone `pagemd`, `pagemd-common`
> and `pagemd-editor` side by side in one folder.

## Packages
| Package | Job | Since |
|---|---|---|
| [`@pagemd/syntax`](packages/syntax) | The pagemd markdown dialect: each syntax item, how it is read, the HTML it produces, how it is written back | phase C1 (editor mode C2, write rules C3) |
| [`@pagemd/meta`](packages/meta) | Document properties: the field catalogue, normalizing, layering, requirements, syntax gates | phase C7 |
| [`@pagemd/resolver`](packages/resolver) | Finding a document's files in pagemd's order: project root, the 5-tier search, path tokens, profiles with inheritance, template and stylesheets; `resolveDocument()` | phase C4 |
| [`@pagemd/theme-kit`](packages/theme-kit) | Stylesheets → final CSS and page: layer order, the style block, running header/footer, page geometry, pagemd's default CSS and layout (`defaults/`), filling an HTML template's tokens | phase C5 (moved from pagemd); template tokens P18 |
| [`@pagemd/validate`](packages/validate) | The checks a profile asks for in its `validation` setting (meta, profile, template, layout, styles, syntax, assets), run the same by `pagemd validate`, `pagemd build --dry-run` and pagemd-editor's Problems panel | phase C8 |
| [`@pagemd/packs`](packages/packs) | **Node only** (`zlib`, `crypto`, `fs`): profile packs. Read and check a pack zip, install it into the shared profiles folder, uninstall, list installed packs; `pagemd profiles` uses it | pagemd-editor phase L2 |

## Rules
- **Browser-safe:** no `fs`, `os`, `path`, `child_process`, no `process.*`, no dependency on pagemd. File access goes
  through **ports** the caller fills in (the resolver's `FileSystem` and `Environment`). The one exception is
  `@pagemd/packs`, which writes files and is Node only by design (it has no browser-safe test; nothing browser-side imports it).
- **Tests never touch the user's folders:** `vitest.config.js` sets `PAGEMD_CONFIG_DIR` to an empty temporary folder, so
  the shared profiles folder is never the real one; the packs tests install into temporary folders only.
  Enforced per package by `packages/<name>/test/browser-safe.test.js` (plus an esbuild `platform: browser` build).
- **Byte-identical output:** pagemd's C0 snapshots (`tests/snapshots/` in pagemd) must not change when
  code moves here. Dependency versions are pinned exactly, on the newest release (phase U1: markdown-it
  15.0.2). `overrides` keep **one** copy of markdown-it (15.0.2, which plugins that declare ≤ 14 also
  get) and its `linkify-it`/`mdurl`.
- **Newest libraries:** at each phase start run `npm run deps:check` and upgrade (pagemd-editor rule R-69).
- **Adapter:** `markdown-it-multimd-table` 4.2.3 needs `md.utils.assign`, which markdown-it 15 removed; see
  `packages/syntax/src/tables/multimd-table.js` (upstream PR #83).

## `@pagemd/syntax` in short
```js
import { createDialect } from '@pagemd/syntax';

const md = createDialect({
  mode: 'render',                      // or 'editor' (phase C2)
  groups: undefined,                   // or a subset of: text lists tables blocks media page document
  slots: { afterTables, afterAttrs, beforeContainers },  // caller's own steps, at fixed positions
  options: {
    markdownIt: { html: true, linkify: true },
    fields: { fancy_lists: false },    // document properties that switch gated items on
    wikilinks: { baseUrl: '', generateSlugs: false }
  }
});
md.render(markdown);
```
Items live in `packages/syntax/src/<group>/<item>.js` and export
`{ id, group, read(md, mode, options), gate?, write?(data, content?), htmlContract, structuralCss?, params }`.

**Editor mode (phase C2):** tokens an editor can turn back into the same markdown.
- Every block token has a line range (`token.map`), in both modes (FIGURE, `[[WARNING]]` callouts and
  `::: {…}` containers had none before).
- Directives stay as written: `pagemd_directive` / `pagemd_directive_inline` tokens with
  `meta = { name, item, known, parenParams, params, attrs }` (unknown ones, e.g. `BREAK`, too). FIGURE keeps
  its parameters as written (`meta.raw`, `meta.attrs`, `meta.legacy`).
- `!!!include(path)!!!` on its own line is one `pagemd_include` atom; nothing is read from disk. (Render mode
  leaves includes to pagemd, which reads them from the document's folder.) The text rules pagemd's expander
  applies to an included file (phase C12, `document/include-rules.js`, pure and browser-safe): which lines count
  (`analyzeIncludes`: only a line that is just the include, outside code, the same rule as the atom), frontmatter
  removed (`splitFrontmatter`), image paths rewritten from the main file's folder (`rebaseImageRefs`), the page type
  in force (`pageTypeAt`, `pageTypeAtEnd`, `layoutRestore`) and the note for a missing or circular include
  (`includeErrorBlock`).
- Render-only rewriting is off: no directive HTML, and `typographer` off. Wikilinks carry
  `meta = { wikilink, target, display }`, embeds `meta.alt`, tables a model (`table_open.meta.table`), and an
  annotated image with broken YAML a `meta.yamlError` note.
- `applyDialect(md, opts)` adds the dialect to a markdown-it instance the caller built (the editor starts
  from the `'commonmark'` preset; editor mode switches the `table` rule on).

**Write rules (phase C3):** `item.write(data, content?)` turns the data an editor-mode token carries back
into markdown (for blocks the author changed). `itemOccurrences(tokens)` lists every item with that data.
The author's style is kept where it can be (untouched parameters, quoting, callout form, container marker);
an annotated image keeps the author's YAML and changes only the edited entries (`updateYaml`, with the `yaml`
library; js-yaml stays the reader). Escaping follows the image tool's rules; numbers are written exactly.
Each item's source file documents its canonical form and the few values its reader cannot hold.
Tests: `packages/syntax/test/editor-mode/` and `test/roundtrip/` (hand-written examples plus fast-check
property tests); pagemd's `tests/editor-mode/` runs the same round trip over its whole corpus.

**For the editor's saves (phase P4, pagemd-editor):** every non-blank line belongs to a block's line range:
a named container's range includes its closing `:::`, and in editor mode a table's range includes a `{…}`
attribute line right under it. A named container's opening token says whether it had its own closing line
(`meta.closed`, as `::: {…}` containers and callouts already did), so an editor writes a nested one back
unclosed. The annotated-image item carries the CSS its HTML needs whatever the theme (`structuralCss`, exported
as `ANNOTATED_IMAGE_STRUCTURAL_CSS`: markers and shapes placed on the image); pagemd's `styles/base.css` holds
the same declarations, checked by pagemd's `tests/integration/structural-css.test.js`. None of this changes HTML.

**Footnotes and task lists (pagemd-editor P26):** `footnotes` (`[^label]`, `^[inline]`, `[^label]: note`) is read by
markdown-it-footnote 4.0.0 with two shims (a line range on every token it makes; in editor mode the notes stay where they are
written, `footnote_reference_open/close` with `meta.label`, and an inline note's reference carries `meta.content`); `task-lists`
(`- [ ]`, `- [x]`) is our own rule giving markdown-it-task-lists 2.1.1's HTML byte for byte (editor mode: `meta.task` on the list
item). Their CSS is not in pagemd's `base.css`: for a document whose HTML has them, `structuralCssFor(html)` returns the footnotes' CSS, which pagemd
(and theme-kit's `buildStyles({ structural })`) adds at the end of the base layer, and `lateStructuralCssFor(html)` returns the task lists' CSS,
which goes in a layer of its own, `structural`, after the profile's (`buildStyles({ structuralLate })`; the layer statement then reads
`@layer base, primary, layout, syntax, profile, structural;`). The task lists' CSS is GitHub's layout (the list keeps a 2em indent, each box is
pulled back 1.4em), so every profile gets the same look whatever indent its lists have. A document without either is unchanged.
`@pagemd/validate` reports a reference with no note, a note nothing refers to and a label written twice.

Figures: captioned FIGUREs and annotated images share one document-order counter; the number is on the token
(`token.meta.figureNumber`), and an annotated image's parsed YAML is on its token (`token.meta.data`).
`listImageRefs(md.parse(src, {}))` lists every image reference (`![]()`, FIGURE, annotated image, `![[…]]`,
raw `<img>`) as `{ form, src, line }` (phase C9).

Picture keys (pagemd-editor C13, `media/picture.js`): FIGURE and the annotated image (in `options`) take `crop-x`, `crop-y`
(a % or any CSS length), `pos-x`, `pos-y`, `crop-fit`, `rotate` (0, 90, 180, 270) and `flip` (h, v, hv); markers take `size`
(0.5–4) and `showLabel`, `options.showLabels` labels them all; `redact:` lists rectangles (provisional). Every new key appears
in the HTML only when used. A crop that is not in % only is drawn with a window (`.image-crop` > `.image-window` > `.image-frame`)
that the browser sizes (`calc-size()`, `cqw`), so shapes stay on their picture points; a 90°/270° turn needs the picture's size
from the caller, `env.pictureSize(src)` (read with `readPictureSize(bytes)`: PNG, JPEG with its EXIF turn, WebP, GIF). In
render mode a redacted picture is drawn only from `env.redacted(src, rects, rotate, flip)` (a baked, blacked-out `data:`
address), else a "Redacted picture not prepared" box: never the original (editor mode draws black boxes over it).
`listPictureEdits(tokens)` lists the turned, flipped and redacted pictures as the renderer reads them; `displayedRectToNatural`
maps a rectangle back to the file's own orientation; `shapesHiddenByCrop(data)` lists the shapes a % crop hides. Shapes and
redactions are % of the picture as shown (turned, flipped). `@pagemd/validate` checks the values (`picture-crop`,
`picture-rotate`, `picture-flip`, `marker-size`, `annotation-hidden-by-crop`, `redact-rect`, `redact-url`, `redact-unreadable`).

## `@pagemd/meta` in short
```js
import { catalogue, normalizeMetadata, normalize, layer, requirements, gateFor } from '@pagemd/meta';

catalogue(profile);                 // FieldSpec[]; a profile adds its own fields (doc_type, …)
normalizeMetadata(frontmatter);     // what pagemd's parser returns (keys, aliases, types, defaults)
normalize(frontmatter).keys;        // canonical key → the key the author wrote (keep it on save)
layer(profileDefaults, metadata, overrides);  // today's order
requirements(profile, templateText);          // { required, shownOnPage }
gateFor('fancy-lists');             // { field: 'fancy_lists', value: true }
```
`packages/meta/catalogue.json` is the one source; pagemd's `schemas/metadata.defaults.json` is generated
from it.
Needs Node 24 (`engines.node >=24`, `.nvmrc`), the same as pagemd and pagemd-editor.

## Develop
```bash
npm install
npm test
```

## `@pagemd/resolver` in short (phase C4)
```js
import { resolveDocument, resolveDocumentSync, createMemoryFileSystem } from '@pagemd/resolver';

// ports: fs = { readText, exists, stat, list } (sync or Promise-returning), env = { homePath, defaultsPath, cwd, path }
const doc = await resolveDocument('/proj/docs/a.md', { frontmatter }, { fs, env });
doc.profile; doc.template.path; doc.layout?.path; doc.styles; doc.frontmatterStyles; doc.sources; doc.problems;
```
Every lookup is written once (a generator that asks for files) and offered twice: `name()` (async) and `nameSync()`.
The 5-tier search order is the code's (document → profile folder → workspace → `~/.pagemd` → bundled); every folder
is searched and a name found twice is an error. pagemd's `core` keeps its old functions as adapters over these.

**Phase L2 (profile packs, R-263, R-264):** profiles have a **sixth tier**, the shared profiles folder (`env.sharedProfilesPath`),
after the workspace and before `~/.pagemd/profiles`; the other types keep five. `sharedProfilesFolder({ platform, env, homePath,
exists, list, osRelease, path })` is the rule (pure, browser-safe): `$PAGEMD_CONFIG_DIR/profiles` when set, else Windows
`%LOCALAPPDATA%\pagemd\profiles`, WSL the same Windows folder under `/mnt/c/Users/<user>/AppData/Local` (the user named like the
WSL user, else the only one), macOS `~/Library/Application Support/pagemd/profiles`, Linux `${XDG_DATA_HOME:-~/.local/share}/pagemd/profiles`;
`sharedProfilesFolderInfo` also says why. pagemd's `nodeEnv()` and the editor's host fill the port with it. **A match must be a
file** (a pack's `<name>/` folder beside `<name>.json` used to be taken for the profile). `listProfiles({ documentPath, projectRoot,
cliPath }, ports)` lists every profile a document can name (document folder's and project's `profiles/` and `.pagemd/profiles/`,
the shared folder, `~/.pagemd/profiles`, pagemd's own) with its tier, a pack's version from `<name>/manifest.json`, and the other
files with the same name in `duplicates` (reported, never hidden); `pagemd profiles list` and the editor's profile picker use it.

## `@pagemd/packs` in short (phase L2, Node only)
```js
import { verifyPack, installPack, uninstallPack, listInstalled, defaultTarget, otherProfileFolders } from '@pagemd/packs';

const pack = verifyPack(zipBytes, sha256FromIndex);         // checks everything; writes nothing; throws PackError
installPack(pack, defaultTarget(), { elsewhere: otherProfileFolders({ projectRoot, cliPath }), pagemdVersion });
uninstallPack('pml-sop-ink', defaultTarget());               // keeps files changed by hand
listInstalled(defaultTarget());                              // [{ id, version, built, changed, installing, ... }]
```
The rules and limits are pagemd-library's (`scripts/unpack.mjs`, the reference copy): checksum first, clean names, allowed file
types, no scripts or remote references, real pictures and fonts, the manifest exact, the pack self-contained; 2000 entries, 8 MB
per file, 64 MB unpacked. Since the security review of pagemd-editor session 56 the content rules are **readers, not text
patterns** (`markup.js`: CSS tokens with escapes decoded; a strict HTML/SVG tokenizer with an element and attribute allowlist,
character references decoded, every address inside the pack, template placeholders only where they stay text) and the profile
is read against an **allowlist** (`profile.js`: no output paths, scripts, `layout`/`styles` paths or `debugArtifacts`; `extends`
by name; plain text); names Windows cannot write (`:`, `CON`, a trailing dot) are refused. The library's reference copy is now
weaker than this package until the library imports it (R-264 item 8). Stricter than the reference too: every other file is written first, then `manifest.json`, then `<id>.json`
**last** (an install that stops leaves nothing findable); a journal `.<id>.installing` lets a retry recognise its own files; an
uninstall that keeps hand-changed files rewrites the manifest to list only those. `PackError.code` is the exit code: 1 refused,
2 usage, 3 would overwrite a file it did not write, 4 the name exists in another folder pagemd searches. `pagemdMinVersion` above
the running pagemd is refused. The test fixtures in `packages/packs/test/fixtures/` are real packs made by pagemd-library.

`rebaseAssetPaths(text, { kind: 'html' | 'css', fileDir, documentDir }, ports)` (pagemd-editor FIX-template-asset-paths, R-259):
a relative path inside a template (`src`, `srcset`, `poster`, `<link href>`, `style`/`<style>` `url()`) or a stylesheet (`url()`)
starts from that file's folder; found there, it is written again from the document's folder; not found there, it is left as
written (the document's folder, as before). Answers `{ text, assets }` (each path, where it was found, the places tried). pagemd's
renderer, the editor's canvas and `@pagemd/validate` (`template-asset-missing`) all use it.

## `@pagemd/theme-kit` in short (phase C5)
```js
import { buildStyles, pageGeometry, DEFAULTS } from '@pagemd/theme-kit';

const styles = buildStyles({ base, primary, syntax, layout, profile, frontmatter, metadata, defaultLayout, defaultsPath });
styles.css; styles.styleBlock; styles.page;   // { width, height, margins } in mm
styles.usingDefault; styles.layout?.bundled; styles.header; styles.footer;
```
Only text in, text out: the caller reads the files (pagemd: `renderer-web/src/aggregate-styles.js`). `defaults/` holds
pagemd's `styles/base.css`, `styles/primary.css`, `styles/syntax/shiki-base.css` and `layouts/letter.css` (the default
layout); pagemd keeps byte-identical copies and a test checks them.

`fillTemplate(template, data, { expand, log })` fills a profile's HTML template (`{{metadata.x}}`, `{{x ?? "d"}}`,
`{{x ? "a" : "b"}}`, `{{#if x}}…{{/if}}`) and answers `{ html, missing }`. It moved here from pagemd's `renderer-web` in
pagemd-editor phase P18, so pagemd's PDF and the editor's Print Layout fill a template with the same code.

## Licence
Apache License 2.0: see [LICENSE](LICENSE) and [NOTICE](NOTICE). Every package says `"license": "Apache-2.0"` and stays
`"private": true` until publishing is set up (OQ-12 / R-268: GitHub Packages first; sanitize plan SAN-2). The Inter font
embedded in `packages/theme-kit/defaults/styles/book-fonts.css` is under the SIL Open Font License 1.1; its text sits beside
it (`book-fonts.LICENSE.txt`). The pack test fixtures are made by pagemd-library from its general look (`pml-sop-ink`) and
its fictional company UOFO (`uofo-sop`).
