/**
 * Behaviour lock (phase C7): @pagemd/meta must do exactly what pagemd's
 * parser/src/metadata.js and renderer-web's "Step 4" merge did before the move.
 * fixtures/behaviour.json was recorded from the unchanged code (pagemd
 * cd583e9) under TZ=UTC, before any edit. Under UTC the date fix (R-35)
 * changes nothing, so every normalize case must still match. Layering changed
 * by decision (OQ-13): those tests check that only the decided values differ.
 */

process.env.TZ = 'UTC';

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeMetadata, normalizeKey, applyDefaults, layer, normalize } from '../src/index.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/behaviour.json', import.meta.url), 'utf8'));

// The fixture stores Date objects as { $date: iso }
const dec = (v) => (Array.isArray(v) ? v.map(dec)
  : v && typeof v === 'object' ? ('$date' in v ? new Date(v.$date) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dec(x)])))
    : v);
const enc = (v) => JSON.parse(JSON.stringify(v, (k, x) => x));

describe('normalizeMetadata reproduces the recorded behaviour', () => {
  it('the time zone is UTC', () => {
    expect(new Date('2024-01-15').getDate()).toBe(15);
  });

  it.each(fixture.normalizeMetadata.map((c) => [c.name, c]))('%s', (_, c) => {
    const result = normalizeMetadata(dec(c.raw), c.options);
    // Same keys in the same order, same values
    expect(Object.keys(result)).toEqual(Object.keys(c.result));
    expect(enc(result)).toEqual(c.result);
  });
});

describe('normalizeKey reproduces the recorded behaviour', () => {
  it.each(fixture.normalizeKey)('%s', (input, expected) => {
    expect(normalizeKey(input)).toBe(expected);
  });
});

describe('applyDefaults reproduces the recorded behaviour', () => {
  it.each(fixture.applyDefaults.map(([input, result], i) => [i, input, result]))('case %i', (_, input, result) => {
    const out = applyDefaults(input);
    expect(Object.keys(out)).toEqual(Object.keys(result));
    expect(enc(out)).toEqual(result);
  });
});

describe('layer(): built-in → profile → document → overrides (OQ-13 decided 2026-09-26)', () => {
  // The fixture holds the OLD merge (built-ins beat profile defaults). The new
  // layer() must equal it everywhere except where a profile default was
  // overwritten by a built-in the author never wrote: there the profile wins.
  const expectedNow = (old, profileDefaults, written, overrides = {}) => {
    const want = { ...old };
    for (const [k, v] of Object.entries(profileDefaults)) {
      if (!(k in written) && !(k in overrides)) want[k] = v;
    }
    return want;
  };

  it.each(fixture.layering.map((c, i) => [`${c.profile} #${i}`, c]))('%s', (_, c) => {
    const pd = dec(c.profileDefaults);
    const written = normalizeMetadata(dec(c.frontmatter), { applyDefaults: false });
    const overrides = { extra: 1, title: 'Opt' };

    const doc = layer(pd, written);
    expect(Object.keys(doc)).toEqual(Object.keys(c.renderDocument));
    expect(enc(doc)).toEqual(enc(expectedNow(dec(c.renderDocument), pd, written)));

    const md = layer(pd, written, overrides);
    expect(Object.keys(md)).toEqual(Object.keys(c.renderMarkdown));
    expect(enc(md)).toEqual(enc(expectedNow(dec(c.renderMarkdown), pd, written, overrides)));
  });

  it('the one real case: sop keeps approver "TBD" when the document has none', () => {
    const sop = fixture.layering.find((c) => c.profile === 'sop' && Object.keys(c.frontmatter).length === 0);
    expect(sop.renderDocument.approver).toBe('');                  // old behaviour, recorded
    expect(layer(dec(sop.profileDefaults), {}).approver).toBe('TBD'); // decided behaviour
    expect(layer(dec(sop.profileDefaults), { approver: 'Jane' }).approver).toBe('Jane');
  });

  it('property: every key comes from the highest layer that has it', () => {
    const keys = ['a', 'status', 'approver', 'toc'];
    const layers = ['builtIn', 'profile', 'document', 'overrides'];
    for (let mask = 0; mask < 1 << (keys.length * layers.length); mask += 7) {
      const parts = layers.map(() => ({}));
      keys.forEach((k, ki) => layers.forEach((l, li) => {
        if (mask & (1 << (ki * layers.length + li))) parts[li][k] = `${l}-${k}`;
      }));
      const [builtIn, profile, document, overrides] = parts;
      const out = layer(profile, document, overrides, builtIn);
      for (const k of keys) {
        const want = overrides[k] ?? document[k] ?? profile[k] ?? builtIn[k];
        expect(out[k]).toBe(want);
      }
    }
  });

  it('a profile default of null still counts as set (not replaced by a built-in)', () => {
    expect(layer({ effective_date: null }, {}).effective_date).toBeNull();
  });

  it('layer() tolerates missing parts, as the renderer does', () => {
    expect(layer(undefined, { a: 1 }, undefined, {})).toEqual({ a: 1 });
  });
});

describe('normalize() keeps the author\'s keys (M4)', () => {
  it('maps canonical keys to the key as written', () => {
    const { values, keys } = normalize({ rev: '2', 'Doc-ID': ' X ', title: 'T', docId: 'Y' }, { applyDefaults: false });
    expect(values).toEqual({ revision: 2, document_id: 'Y', title: 'T' });
    expect(keys).toEqual({ revision: 'rev', document_id: 'docId', title: 'title' });
  });

  it('values equal normalizeMetadata()', () => {
    for (const c of fixture.normalizeMetadata) {
      expect(enc(normalize(dec(c.raw), c.options).values)).toEqual(c.result);
    }
  });
});
