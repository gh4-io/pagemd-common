/**
 * @pagemd/packs: profile packs (phase L2, R-263, R-264). A pack is one zip holding one profile and every file it
 * needs (`<id>.json` + `<id>/` with the template, CSS, fonts, logo and `manifest.json`); installed, it is ordinary
 * files in the shared profiles folder, which pagemd's search finds by name.
 *
 *   const pack = verifyPack(zipBytes, sha256FromTheIndex);   // nothing written; throws PackError
 *   installPack(pack, defaultTarget(), { elsewhere: otherProfileFolders({ projectRoot, cliPath }), pagemdVersion });
 *
 * Node only (zlib, crypto, fs). The reference copy of these rules is pagemd-library `scripts/unpack.mjs`; the shared
 * fixture zips in test/fixtures were made by the library and keep the two the same.
 */

export { readZip, writeZip, ZipError, ZIP_LIMITS, crc32, crc32Fallback } from './zip.js';
export { ALLOWED_EXT, MAX_FILE, MAX_PACK, badName, badContent, cssRefs, incomplete, sha256 } from './rules.js';
export { badCss, badMarkup, checkPlaceholder, cssTokens, judgeAddress } from './markup.js';
export { badProfile, badText } from './profile.js';
export { EXIT, PackError, verifyPack } from './verify.js';
export { LIBRARY_POINTER_MARK, checkPagemdVersion, compareVersions, findElsewhere, installPack, listInstalled, uninstallPack } from './install.js';
export { SHARED_FOLDER_REASONS } from '@pagemd/resolver';
export { MAX_INDEX, defaultTarget, defaultTargetInfo, latestPacks, otherProfileFolders, parseIndex, readIndexFile } from './sources.js';
