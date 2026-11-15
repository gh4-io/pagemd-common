/**
 * CSS layer order (from pagemd `theme-kit/src/index.js` and `renderer-web/src/styles.js`, phase C5).
 *
 * Priority low to high:
 * 1. base - CSS reset/normalize (bundled styles/base.css)
 * 2. primary - project overrides (bundled styles/primary.css)
 * 3. layout - Paged.js structure (@page rules, margins) - optional, from the profile
 * 4. syntax - code block styling (bundled styles/syntax/shiki-base.css) - when highlighting is on
 * 5. profile - visual styling (fonts, colors) from the profile's CSS
 * 6. frontmatter - running header/footer variables and the document's `styles:` files
 *
 * The declared order (`@layer base, primary, layout, syntax, profile;`) leaves `frontmatter` out on
 * purpose: an undeclared layer comes last, so it wins.
 *
 * One more layer exists only in a document that has task lists (pagemd-editor FIX-ADT): `structural` (LATE_LAYER), GitHub's look for
 * them, between `profile` and `frontmatter`; the declaration then reads `@layer base, primary, layout, syntax, profile, structural;`.
 * It is not in CSS_LAYER_ORDER, which stays the six layers every document can have.
 */

/** @type {string[]} */
export const CSS_LAYER_ORDER = ['base', 'primary', 'layout', 'syntax', 'profile', 'frontmatter'];

/** Layers identical for every profile (bundled system files) */
export const SHARED_LAYERS = ['base', 'primary', 'syntax'];

/** Layers that vary per profile */
export const PROFILE_LAYERS = ['layout', 'profile'];

/** The layer after the profile's, present only in a document that has task lists */
export const LATE_LAYER = 'structural';
