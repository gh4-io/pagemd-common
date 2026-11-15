/**
 * Gates: syntax items that only work when a property has a given value.
 * e.g. fancy lists (lettered/roman) parse only with `fancy_lists: true`.
 *
 * @pagemd/syntax declares the same gate on its item (it may not import this
 * package: see its browser-safe rule); test/gates.test.js fails if they differ.
 */

import { CATALOGUE } from './catalogue.js';

/**
 * @param {string} itemId - A @pagemd/syntax item id, e.g. 'fancy-lists'
 * @returns {{ field: string, value: * } | null}
 */
export function gateFor(itemId) {
  const gate = CATALOGUE.gates[itemId];
  return gate ? { ...gate } : null;
}

/**
 * Properties that configure an item (not gates: the item works without them)
 * @param {string} itemId - e.g. 'toc'
 * @returns {string[]} canonical keys
 */
export function fieldsForItem(itemId) {
  return CATALOGUE.fields.filter((f) => f.items?.includes(itemId)).map((f) => f.key);
}
