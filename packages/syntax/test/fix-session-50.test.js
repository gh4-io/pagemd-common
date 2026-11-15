/**
 * pagemd-editor fix run, session 50: the legend can be hidden (showLegend: false), a highlight multiplies, and the first heading can be hidden.
 */

import { describe, it, expect } from 'vitest';
import { createDialect, hideFirstH1Plugin, lateStructuralCssFor } from '../src/index.js';

const block = (yaml) => `::: annotated-image ./shot.png\n${yaml}\n:::`;

describe('showLegend', () => {
  const yaml = 'markers:\n  - { id: 1, x: 10, y: 10, label: "One" }';
  it('draws the legend by default', () => {
    expect(createDialect().render(block(yaml))).toContain('annotation-legend');
  });
  it('showLegend: false leaves it out; the badge stays', () => {
    const html = createDialect().render(block(`options: { showLegend: false }\n${yaml}`));
    expect(html).not.toContain('annotation-legend');
    expect(html).toContain('<span class="marker"');
  });
});

describe('highlight', () => {
  it('multiplies at 50% opacity by default', () => {
    const html = createDialect().render(block('highlights:\n  - { x: 1, y: 2, width: 3, height: 4 }'));
    expect(html).toContain('fill-opacity="0.5" stroke="none" style="mix-blend-mode: multiply"');
  });
});

describe('hide_first_h1', () => {
  const doc = '# Title\n\ntext\n\n# Second\n';
  const on = () => createDialect().use(hideFirstH1Plugin);
  it('does nothing unless the plugin is used', () => {
    expect(createDialect().render(doc)).not.toContain('hide-first-h1');
  });
  it('marks only the first level-1 heading', () => {
    const html = on().render(doc);
    expect(html.match(/hide-first-h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1 class="hide-first-h1">Title<\/h1>/);
    expect(html).toMatch(/<h1>Second<\/h1>/);
  });
  it('its CSS is added only for a document that has the class', () => {
    expect(lateStructuralCssFor('<h1 class="hide-first-h1">T</h1>')).toContain('display: none');
    expect(lateStructuralCssFor('<h1>T</h1>')).not.toContain('hide-first-h1');
  });
});
