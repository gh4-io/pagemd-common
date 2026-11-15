/** Cases for path.test.js (kept apart so the list is easy to extend). */

export { posix } from '../src/path.js';

export const pathCases = {
  normalize: [['/a/b/../c'], ['a//b/./c/'], [''], ['.'], ['../a'], ['/..'], ['a/..'], ['/a/b/']],
  join: [['/a', 'b', '../c'], ['a', ''], [''], ['/a/', '/b'], ['a', '..', '..'], ['/x', '.pagemd', 'styles', 'presets']],
  resolve: [['/a', 'b'], ['/a', '/b', 'c'], ['/a/b', '../c/./d'], ['/', '..'], ['/a', './x.css']],
  dirname: [['/a/b/c'], ['/a/b/'], ['a'], ['/a'], ['/'], ['a/b'], ['']],
  basename: [['/a/b.css'], ['/a/b.css', '.css'], ['/a/b/'], ['b.css', 'b.css'], ['/']],
  extname: [['a.css'], ['.bashrc'], ['a.b.c'], ['a'], ['a.'], ['/x.y/z']],
  isAbsolute: [['/a'], ['a'], ['']],
  parse: [['/a/b'], ['a/b']],
  relative: [['/a/b', '/a/c/d'], ['/a/b', '/a/b'], ['/a/b/c', '/a'], ['/', '/x/y'], ['/p/01-SOP', '/p/Resources/r/assets/i.png'], ['/a/b/', '/a/b/c/']]
};
