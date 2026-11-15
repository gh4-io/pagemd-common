/**
 * The POSIX path fallback matches Node's path.posix for everything the resolver uses (phase C4).
 * (pagemd passes Node's own `path`, so this only matters where there is none, e.g. a browser.)
 */

import { describe, it, expect } from 'vitest';
import nodePath from 'node:path';
import { posix, pathCases } from './path-cases.js';

const N = nodePath.posix;

describe('posix path functions = node:path.posix', () => {
  for (const [fn, cases] of Object.entries(pathCases)) {
    for (const args of cases) {
      it(`${fn}(${args.map((a) => JSON.stringify(a)).join(', ')})`, () => {
        expect(posix[fn](...args)).toEqual(fn === 'parse' ? { root: N.parse(...args).root } : N[fn](...args));
      });
    }
  }

  it('non-string arguments throw a TypeError, as Node does', () => {
    expect(() => posix.join('a', null)).toThrow(TypeError);
    expect(() => posix.isAbsolute(undefined)).toThrow(TypeError);
  });
});
