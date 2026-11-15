/**
 * The catalogue: shape, derived tables, profile extension, requirements, gates.
 */

import { describe, it, expect } from 'vitest';
import {
  CATALOGUE, FIELD_ALIASES, DEFAULT_VALUES, FIELD_DEFINITIONS,
  catalogue, fieldFor, requirements, gateFor, fieldsForItem
} from '../src/index.js';
import { items as syntaxItems } from '../../syntax/src/index.js';

const TYPES = ['string', 'number', 'boolean', 'date', 'enum', 'list', 'path'];

describe('catalogue shape', () => {
  it('every field has key, a known type, label, help, sources', () => {
    for (const f of CATALOGUE.fields) {
      expect(f.key).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(TYPES).toContain(f.type);
      expect(f.label).toBeTruthy();
      expect(f.help).toBeTruthy();
      expect(f.sources.length).toBeGreaterThan(0);
    }
  });

  it('keys are unique', () => {
    const keys = CATALOGUE.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every alias points at a catalogue field', () => {
    const keys = new Set(CATALOGUE.fields.map((f) => f.key));
    for (const target of Object.values(CATALOGUE.aliases)) expect(keys).toContain(target);
  });

  it('keeps the parser\'s 23 field definitions and 20 defaults; 60 aliases + eff_date (OQ-18)', () => {
    expect(Object.keys(FIELD_DEFINITIONS)).toHaveLength(23);
    expect(Object.keys(DEFAULT_VALUES)).toHaveLength(20);
    expect(Object.keys(FIELD_ALIASES)).toHaveLength(60);
  });

  it('OQ-18 (user, 2026-09-26): rev and eff_date are aliases; ver and version are not', () => {
    expect(FIELD_ALIASES.rev).toBe('revision');
    expect(FIELD_ALIASES.eff_date).toBe('effective_date');
    expect(FIELD_ALIASES.ver).toBeUndefined();
    expect(FIELD_ALIASES.version).toBeUndefined();
    expect(fieldFor('version').key).toBe('version');
  });

  it('FieldSpec.aliases lists each field\'s aliases', () => {
    expect(fieldFor('revision').aliases).toEqual(['rev', 'revisionNumber', 'revision_number', 'revision-number']);
    expect(fieldFor('rev').key).toBe('revision');
  });
});

describe('catalogue(profile) adds profile-only fields', () => {
  const sop = {
    id: 'sop',
    metadata: { defaults: { doc_type: 'Standard Operating Procedure', approver: 'TBD', review_cycle: 'Annual', effective_date: null, page_numbers: true } },
    validation: { required_fields: ['document_id', 'title', 'owner', 'approver', 'site_code'] }
  };

  it('doc_type appears only when that profile is active', () => {
    expect(catalogue().some((f) => f.key === 'doc_type')).toBe(false);
    const field = catalogue(sop).find((f) => f.key === 'doc_type');
    expect(field).toMatchObject({ key: 'doc_type', type: 'string', sources: ['profile'] });
  });

  it('adds required fields the catalogue lacks; known keys are not duplicated', () => {
    const keys = catalogue(sop).map((f) => f.key);
    expect(keys).toContain('site_code');
    expect(keys).toContain('review_cycle');
    expect(keys.filter((k) => k === 'approver')).toHaveLength(1);
    expect(keys.filter((k) => k === 'page_numbers')).toHaveLength(1);
  });
});

describe('requirements(profile, template)', () => {
  it('required from validation.required_fields; shown from metadata tokens', () => {
    const template = '<h1>{{metadata.title}}</h1>{{ metadata.subtitle ?? "x" }}{{metadata.status ? "a" : "b"}}{{content}}{{profile.name}}{{metadata.title}}';
    expect(requirements({ validation: { required_fields: ['title', 'document_id'] } }, template)).toEqual({
      required: ['title', 'document_id'],
      shownOnPage: ['title', 'subtitle', 'status']
    });
  });

  it('no profile, no template', () => {
    expect(requirements()).toEqual({ required: [], shownOnPage: [] });
  });
});

describe('gates', () => {
  it('fancy lists need fancy_lists: true', () => {
    expect(gateFor('fancy-lists')).toEqual({ field: 'fancy_lists', value: true });
    expect(gateFor('toc')).toBeNull();
  });

  it('@pagemd/syntax declares exactly the gates meta knows (cross-check)', () => {
    const declared = Object.fromEntries(syntaxItems.filter((i) => i.gate).map((i) => [i.id, i.gate]));
    expect(declared).toEqual(CATALOGUE.gates);
  });

  it('every gate field is a catalogue boolean', () => {
    for (const { field } of Object.values(CATALOGUE.gates)) expect(fieldFor(field).type).toBe('boolean');
  });

  it('every item named by a field is a real syntax item', () => {
    const ids = new Set(syntaxItems.map((i) => i.id));
    for (const f of CATALOGUE.fields) for (const id of f.items || []) expect(ids).toContain(id);
  });

  it('fieldsForItem lists the settings of an item', () => {
    expect(fieldsForItem('toc')).toEqual(['toc', 'toc_levels', 'toc_min_level', 'toc_title', 'toc_page_numbers', 'toc_page_levels']);
  });
});
