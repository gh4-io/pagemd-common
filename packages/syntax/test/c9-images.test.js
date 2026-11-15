/**
 * Phase C9: annotated-image v2 and image fixes.
 * IDs (A4, PD1, …) refer to pagemd-editor docs/research/image-editor-integration.md.
 */

import { describe, it, expect } from 'vitest';
import { createDialect, items, listImageRefs } from '../src/index.js';

const md = () => createDialect();
const block = (yaml, path = './shot.png') => `::: annotated-image ${path}\n${yaml}\n:::`;

describe('A4: lines', () => {
  it('draws a line without a head, clamped to the image', () => {
    const html = md().render(block('lines:\n  - { x1: -5, y1: 10, x2: 50, y2: 120, color: "#555" }'));
    expect(html).toContain('<line x1="0" y1="10" x2="50" y2="100" stroke="#555" stroke-width="2" vector-effect="non-scaling-stroke" />');
    expect(html).not.toContain('marker-end');
    expect(html).not.toContain('<defs>');
  });

  it('can be dashed (dash scales with the line width)', () => {
    const html = md().render(block('lines:\n  - { x1: 0, y1: 0, x2: 10, y2: 10, strokeWidth: 3, dashed: true }'));
    expect(html).toContain('stroke-width="3" stroke-dasharray="9 6"');
  });

  it('joins the legend with a badge at its middle, in its own color', () => {
    const html = md().render(block('lines:\n  - { id: 4, x1: 10, y1: 20, x2: 30, y2: 40, label: "Divider", color: "#123456" }'));
    expect(html).toContain('<span class="marker" style="left: 20%; top: 30%; --marker-color: #123456;">4</span>');
    expect(html).toContain('<span class="legend-num" style="--marker-color: #123456;">4</span>');
    expect(html).toContain('<span class="legend-text">Divider</span>');
  });

  it('skips a line with a missing coordinate', () => {
    const html = md().render(block('lines:\n  - { x1: 0, y1: 0, x2: 10 }'));
    expect(html).not.toContain('<line');
  });
});

describe('A4: ellipses', () => {
  it('draws an ellipse from its bounding box, clamped inside the image', () => {
    const html = md().render(block('ellipses:\n  - { x: 60, y: 10, width: 60, height: 20 }'));
    // width is trimmed to 40 so the ellipse stays inside: cx 80, rx 20
    expect(html).toContain('<ellipse cx="80" cy="20" rx="20" ry="10" stroke="#0066cc" fill="none" stroke-width="2" vector-effect="non-scaling-stroke" />');
  });

  it('joins the legend like a box, badge on the outline up-left of the centre', () => {
    const html = md().render(block('ellipses:\n  - { id: 5, x: 0, y: 0, width: 20, height: 40, label: "Logo", color: "#0a7d00" }'));
    // centre (10, 20), radii (10, 20): 45° point = (10 - 7.0711, 20 - 14.1421)
    expect(html).toContain('<span class="marker" style="left: 2.9289%; top: 5.8579%; --marker-color: #0a7d00;">5</span>');
    expect(html).toContain('<span class="legend-text">Logo</span>');
  });
});

describe('A4: highlights', () => {
  it('draws a see-through filled rectangle with no outline (default yellow, 0.5, multiply)', () => {
    const html = md().render(block('highlights:\n  - { x: 5, y: 30, width: 40, height: 6 }'));
    expect(html).toContain('<rect x="5" y="30" width="40" height="6" fill="#ffeb3b" fill-opacity="0.5" stroke="none" style="mix-blend-mode: multiply" />');
  });

  it('takes a color and an opacity, clamped to 0-1', () => {
    const html = md().render(block('highlights:\n  - { x: 0, y: 0, width: 10, height: 10, color: "#0f0", opacity: 4 }'));
    expect(html).toContain('fill="#0f0" fill-opacity="1"');
  });

  it('is not in the legend even with id and label', () => {
    const html = md().render(block('highlights:\n  - { id: 1, x: 0, y: 0, width: 10, height: 10, label: "Hi" }'));
    expect(html).not.toContain('annotation-legend');
    expect(html).not.toContain('class="marker"');
  });
});

describe('A4: draw order', () => {
  it('highlights, then boxes and ellipses, then lines and arrows', () => {
    const html = md().render(block([
      'arrows:\n  - { x1: 1, y1: 1, x2: 9, y2: 9 }',
      'lines:\n  - { x1: 1, y1: 1, x2: 9, y2: 9 }',
      'ellipses:\n  - { x: 1, y: 1, width: 9, height: 9 }',
      'boxes:\n  - { x: 1, y: 1, width: 9, height: 9 }',
      'highlights:\n  - { x: 1, y: 1, width: 9, height: 9 }'
    ].join('\n')));
    const order = ['fill-opacity', '<rect x="1" y="1" width="9" height="9" stroke=', '<ellipse', '<line x1="1" y1="1" x2="9" y2="9" stroke="#cc0000" stroke-width="2" vector', 'marker-end'];
    const at = order.map((s) => html.indexOf(s));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});

describe('PD1-PD3: one figure numbering', () => {
  const doc = [
    '<!-- ::FIGURE src="a.png" caption="One" -->',
    '',
    '<!-- ::FIGURE src="b.png" -->',
    '',
    block('options:\n  caption: "Two"\nmarkers:\n  - { id: 1, x: 1, y: 1, label: "m" }'),
    '',
    block('markers:\n  - { id: 1, x: 1, y: 1, label: "m" }'),
    '',
    '<!-- ::FIGURE src="c.png" caption="Three" -->'
  ].join('\n');
  const nums = (html) => [...html.matchAll(/Figure <span class="fig-num">(\d*)<\/span>: ([^<]*)/g)].map((m) => `${m[1]}:${m[2]}`);

  it('shares one counter across FIGURE and annotated images, in document order', () => {
    expect(nums(md().render(doc))).toEqual(['1:One', '2:Two', '3:Three']);
  });

  it('gives an uncaptioned FIGURE no number and no figcaption (PD2)', () => {
    const html = md().render('<!-- ::FIGURE src="b.png" -->');
    expect(html).toBe('<figure><img src="b.png" alt=""></figure>');
  });

  it('keeps numbers stable when parse and render are called separately (PD3)', () => {
    const m = md();
    m.parse(doc, {});
    const env = {};
    const tokens = m.parse(doc, env);
    m.parse(doc, {});
    expect(nums(m.renderer.render(tokens, m.options, env))).toEqual(['1:One', '2:Two', '3:Three']);
    expect(nums(m.render(doc))).toEqual(['1:One', '2:Two', '3:Three']);
    expect(env.figureCount).toBe(3);
  });

  it('writes the number onto the tokens, and the parsed YAML onto the annotated token', () => {
    const tokens = md().parse(doc, {});
    const figures = tokens.filter((t) => t.type === 'figure_open' || t.type === 'annotated_image');
    expect(figures.map((t) => t.meta.figureNumber)).toEqual([1, undefined, 2, undefined, 3]);
    const annotated = tokens.find((t) => t.type === 'annotated_image');
    expect(annotated.meta.data.options.caption).toBe('Two');
    expect(annotated.meta.data.markers).toHaveLength(1);
  });
});

describe('PD4, PD22: badge colors', () => {
  it('puts markerColor on the whole figure, so legend badges use it too', () => {
    const html = md().render(block('options:\n  markerColor: "#0066cc"\nmarkers:\n  - { id: 1, x: 1, y: 1, label: "m" }'));
    expect(html).toContain('<figure class="annotated-image-container" style="--marker-color: #0066cc;">');
    expect(html).toContain('<div class="image-wrapper">');
    expect(html).toContain('<span class="legend-num">1</span>');
  });
});

describe('A7: annotated-image alt, width, link, class', () => {
  it('uses alt when given, else the caption', () => {
    expect(md().render(block('options:\n  caption: "Cap"\n  alt: "Alt"'))).toContain('alt="Alt"');
    expect(md().render(block('options:\n  caption: "Cap"'))).toContain('alt="Cap"');
  });

  it('takes FIGURE width names as classes and other values as max-width', () => {
    expect(md().render(block('options:\n  width: half'))).toContain('<figure class="annotated-image-container width-half" style="--marker-color: #cc0000;">');
    expect(md().render(block('options:\n  width: "60%"'))).toContain('style="--marker-color: #cc0000; max-width: 60%;"');
    expect(md().render(block('options:\n  width: "1px; color: red"'))).not.toContain('color: red');
  });

  it('wraps the image in a link with FIGURE\'s safety rules', () => {
    expect(md().render(block('options:\n  link: "https://x.test/big.png"'))).toContain('<a href="https://x.test/big.png" target="_blank" rel="noopener noreferrer"><img src="./shot.png" alt=""></a>');
    expect(md().render(block('options:\n  link: "full.png"'))).toContain('<a href="full.png"><img');
    expect(md().render(block('options:\n  link: "javascript:alert(1)"'))).not.toContain('<a ');
  });

  it('adds plain CSS class names only', () => {
    const html = md().render(block('options:\n  class: "rounded shadow \\"><script> bad;x"'));
    expect(html).toContain('<figure class="annotated-image-container rounded shadow"');
    expect(html).not.toContain('script');
  });
});

describe('PD21: text overlays', () => {
  it('turns a line break into <br>, after escaping', () => {
    const html = md().render(block('text:\n  - { x: 1, y: 1, text: "Line <1>\\nLine 2" }'));
    expect(html).toContain('>Line &lt;1&gt;<br>Line 2</span>');
  });
});

describe('PD10: FIGURE crop keeps decimals', () => {
  it('uses the decimal value, not a whole number', () => {
    const html = md().render('<!-- ::FIGURE src="a.png" caption="C" crop-x="33.3" crop-y="50.5" -->');
    expect(html).toContain('object-view-box: inset(0% 66.7% 49.5% 0%)');
  });

  it('leaves whole numbers exactly as before', () => {
    const html = md().render('<!-- ::FIGURE src="a.png" caption="C" crop-x="60" crop-y="50" -->');
    expect(html).toContain('object-view-box: inset(0% 40% 50% 0%)');
  });
});

describe('PD18: ![[…]] embeds', () => {
  it('takes alt text after "|", else the path', () => {
    expect(md().render('![[img/a.png|The chart]]')).toContain('<img src="img/a.png" alt="The chart" class="embedded-image">');
    expect(md().render('![[img/a.png]]')).toContain('<img src="img/a.png" alt="img/a.png" class="embedded-image">');
  });

  it('puts imageBaseUrl only in front of relative paths', () => {
    const m = createDialect({ options: { wikilinks: { imageBaseUrl: '/assets' } } });
    expect(m.render('![[a.png]]')).toContain('src="/assets/a.png"');
    expect(m.render('![[https://x.test/a.png]]')).toContain('src="https://x.test/a.png"');
    expect(m.render('![[data:image/png;base64,AAAA]]')).toContain('src="data:image/png;base64,AAAA"');
  });
});

describe('A12: listImageRefs', () => {
  it('lists every image form in document order, with its line', () => {
    const src = [
      '![plain](img/a%20b.png "t")',               // 0
      '',
      '<!-- ::FIGURE src="img/fig.png" caption="F" -->', // 2
      '',
      block('markers: []', 'img/ann.png'),          // 4-6
      '',
      'Text ![[img/embed.png|alt]] and <img src="img/inline.png">', // 8
      '',
      '<div><img src=\'img/block.png\'></div>',    // 10
      '',
      '<!-- ::FIGURE caption="Legacy" -->',         // 12
      '![legacy](img/legacy.png)',
      '',
      '```',
      '![not an image](img/code.png)',
      '```',
      '',
      '![web](https://x.test/w.png)'
    ].join('\n');
    expect(listImageRefs(createDialect().parse(src, {}))).toEqual([
      { form: 'image', src: 'img/a b.png', line: 0 },
      { form: 'figure', src: 'img/fig.png', line: 2 },          // line ranges on FIGURE since C2
      { form: 'annotated', src: 'img/ann.png', line: 4 },
      { form: 'embed', src: 'img/embed.png', line: 8 },
      { form: 'html', src: 'img/inline.png', line: 8 },
      { form: 'html', src: 'img/block.png', line: 10 },
      { form: 'image', src: 'img/legacy.png', line: 12 },       // the legacy FIGURE's range starts at its comment
      { form: 'image', src: 'https://x.test/w.png', line: 19 }
    ]);
  });
});

describe('A6: params for the Inspector', () => {
  const item = items.find((i) => i.id === 'annotated-image');
  const field = (key) => item.params.find((p) => p.key === key);

  it('describes every shape list with the fields of one entry', () => {
    for (const key of ['markers', 'arrows', 'boxes', 'text', 'lines', 'ellipses', 'highlights']) {
      expect(field(key).type).toBe('list');
      expect(field(key).fields.length).toBeGreaterThan(0);
    }
    expect(field('options').fields.map((f) => f.key)).toEqual(
      ['caption', 'id', 'alt', 'width', 'link', 'class', 'markerColor', 'legendColumns',
        // C13 (R-248, R-250): FIGURE's picture keys and the marker labels
        'crop-x', 'crop-y', 'pos-x', 'pos-y', 'height' /* FIX-CF */, 'crop-fit', 'rotate', 'flip', 'showLegend' /* FIX-S50: the legend can be hidden */, 'showLabels']);
  });

  it('uses the color type for colors, with the renderer\'s defaults', () => {
    expect(field('options').fields.find((f) => f.key === 'markerColor')).toMatchObject({ type: 'color', default: '#cc0000' });
    expect(field('highlights').fields.find((f) => f.key === 'color')).toMatchObject({ type: 'color', default: '#ffeb3b' });
    expect(field('lines').fields.find((f) => f.key === 'dashed')).toMatchObject({ type: 'boolean', default: false });
  });
});
