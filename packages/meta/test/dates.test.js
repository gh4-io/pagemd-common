/**
 * Date fix (R-35): a date written without a time keeps its calendar day in
 * every time zone. Before C7, `date: 2024-01-15` printed as 01/14/2024 west of
 * UTC. Each time zone runs in its own Node process, because the time zone is
 * fixed per process.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../src/index.js', import.meta.url));

// [input (string, or { date: iso } for a YAML-style Date object), expected per zone]
const CASES = [
  // Calendar dates: the same day everywhere
  ['2024-01-15', { all: '01/15/2024' }],
  [{ date: '2024-01-15T00:00:00Z' }, { all: '01/15/2024' }],   // YAML `date: 2024-01-15`
  ['2024-12-31', { all: '12/31/2024' }],
  ['2024-01', { all: '01/01/2024' }],
  ['2024', { all: '01/01/2024' }],
  ['2024-02-30', { all: '03/01/2024' }],                    // JavaScript rolls over, as before
  ['01/15/2024', { all: '01/15/2024' }],
  ['1/5/24', { all: '01/05/2024' }],
  ['01-15-2024', { all: '01/15/2024' }],
  ['15 Jan 2024', { all: '01/15/2024' }],
  ['January 15, 2024', { all: '01/15/2024' }],
  ['2024-01-15T23:30:00', { all: '01/15/2024' }],           // local time, no zone: as written
  ['not a date', { all: 'not a date' }],
  // Moments (a time and a zone): printed in local time, as before
  ['2024-01-15T02:00:00Z', { UTC: '01/15/2024', 'America/New_York': '01/14/2024', 'Asia/Tokyo': '01/15/2024' }],
  [{ date: '2024-01-15T18:45:00Z' }, { UTC: '01/15/2024', 'America/New_York': '01/15/2024', 'Asia/Tokyo': '01/16/2024' }]
];

const ZONES = ['UTC', 'America/New_York', 'Asia/Tokyo'];

function runIn(tz) {
  const script = `
    const { normalizeValue } = await import(${JSON.stringify('file://' + entry)});
    const cases = ${JSON.stringify(CASES.map(([input]) => input))};
    const out = cases.map((c) => normalizeValue('effective_date', typeof c === 'object' ? new Date(c.date) : c));
    console.log(JSON.stringify(out));
  `;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8'
  }));
}

describe.each(ZONES)('effective_date under TZ=%s', (tz) => {
  const results = runIn(tz);
  it.each(CASES.map(([input, want], i) => [JSON.stringify(input), want, i]))('%s', (_, want, i) => {
    expect(results[i]).toBe(want.all ?? want[tz]);
  });
});
