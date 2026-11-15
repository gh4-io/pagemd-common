/**
 * Tests for PageMD directives plugin and extended syntax
 */

import { describe, it, expect, beforeEach } from 'vitest';
import MarkdownIt from 'markdown-it';
import { directivesPlugin, figurePlugin } from '../src/index.js';

describe('directivesPlugin', () => {
  let md;

  beforeEach(() => {
    md = new MarkdownIt({ html: true });
    md.use(directivesPlugin);
  });

  describe('PAGEBREAK directive', () => {
    it('should render PAGEBREAK as break-page div', () => {
      const input = '<!-- ::PAGEBREAK -->';
      const html = md.render(input);

      expect(html).toContain('<div class="break-page"></div>');
    });

    it('should handle PAGEBREAK with whitespace variations', () => {
      const inputs = [
        '<!--::PAGEBREAK-->',
        '<!--  ::PAGEBREAK  -->',
        '<!-- ::PAGEBREAK -->'
      ];

      for (const input of inputs) {
        const html = md.render(input);
        expect(html).toContain('<div class="break-page"></div>');
      }
    });

    it('should render multiple PAGEBREAK directives', () => {
      const input = `Content before

<!-- ::PAGEBREAK -->

Middle content

<!-- ::PAGEBREAK -->

Content after`;

      const html = md.render(input);
      const matches = html.match(/<div class="break-page"><\/div>/g);
      expect(matches).toHaveLength(2);
    });
  });

  describe('TOC directive', () => {
    it('should render TOC as placeholder div', () => {
      const input = '<!-- ::TOC -->';
      const html = md.render(input);

      expect(html).toContain('<div class="toc-placeholder"');
      // Bare directive has no data attributes - frontmatter controls settings
      expect(html).not.toContain('data-levels');
    });

    it('should accept custom levels parameter', () => {
      const input = '<!-- ::TOC levels=5 -->';
      const html = md.render(input);

      expect(html).toContain('data-levels="5"');
    });

    it('should handle levels with quotes', () => {
      const input = '<!-- ::TOC levels="2" -->';
      const html = md.render(input);

      expect(html).toContain('data-levels="2"');
    });

    it('should accept min parameter for minimum heading level', () => {
      const input = '<!-- ::TOC min="2" -->';
      const html = md.render(input);

      expect(html).toContain('data-min-level="2"');
      // No explicit levels param, so no data-levels attribute
      expect(html).not.toContain('data-levels');
    });

    it('should accept section keyword for section-scoped TOC', () => {
      const input = '<!-- ::TOC section -->';
      const html = md.render(input);

      expect(html).toContain('data-scope="section"');
    });

    it('should combine section, min, and levels parameters', () => {
      const input = '<!-- ::TOC section min="3" levels="4" -->';
      const html = md.render(input);

      expect(html).toContain('data-scope="section"');
      expect(html).toContain('data-min-level="3"');
      expect(html).toContain('data-levels="4"');
    });
  });

  describe('SECTION_START/SECTION_END directives', () => {
    it('should render SECTION_START with class', () => {
      const input = '<!-- ::SECTION_START class="sidebar" -->';
      const html = md.render(input);

      expect(html).toContain('<div class="sidebar">');
    });

    it('should render SECTION_END as closing div', () => {
      const input = '<!-- ::SECTION_END -->';
      const html = md.render(input);

      expect(html).toContain('</div>');
    });

    it('should handle SECTION with id and class', () => {
      const input = '<!-- ::SECTION_START class="cols-2" id="two-col" -->';
      const html = md.render(input);

      expect(html).toContain('id="two-col"');
      expect(html).toContain('class="cols-2"');
    });

    it('should render complete section with content', () => {
      const input = `<!-- ::SECTION_START class="note" -->

This is section content.

<!-- ::SECTION_END -->`;

      const html = md.render(input);

      expect(html).toContain('<div class="note">');
      expect(html).toContain('This is section content.');
      expect(html).toContain('</div>');
    });
  });

  describe('LAYOUT directive', () => {
    it('should render first LAYOUT without closing div', () => {
      const input = '<!-- ::LAYOUT(landscape) -->';
      const html = md.render(input);

      // First LAYOUT only opens (no previous section to close)
      expect(html).not.toContain('</div>');
      expect(html).toContain('<div class="page-landscape">');
    });

    it('should render LAYOUT with name attribute', () => {
      const input = '<!-- ::LAYOUT name="portrait" -->';
      const html = md.render(input);

      expect(html).toContain('<div class="page-portrait">');
    });

    it('should close previous layout when switching', () => {
      const input = `<!-- ::LAYOUT(landscape) -->

Content here

<!-- ::LAYOUT(default) -->`;
      const html = md.render(input);

      // First LAYOUT opens
      expect(html).toContain('<div class="page-landscape">');
      // Second LAYOUT closes previous and opens new
      expect(html).toContain('</div>');
      expect(html).toContain('<div class="page-default">');
    });
  });

  describe('COVER_START/COVER_END directives', () => {
    it('should render COVER_START as cover div', () => {
      const input = '<!-- ::COVER_START -->';
      const html = md.render(input);

      expect(html).toContain('<div class="cover">');
    });

    it('should render COVER_END as closing div', () => {
      const input = '<!-- ::COVER_END -->';
      const html = md.render(input);

      expect(html).toContain('</div>');
    });

    it('should render complete cover section', () => {
      const input = `<!-- ::COVER_START -->

# Document Title

**Author Name**

<!-- ::COVER_END -->`;

      const html = md.render(input);

      expect(html).toContain('<div class="cover">');
      expect(html).toContain('Document Title');
      expect(html).toContain('Author Name');
      expect(html).toContain('</div>');
    });
  });

  describe('INCLUDE directive fallback', () => {
    it('should render INCLUDE placeholder when include plugin not loaded', () => {
      const input = '<!-- ::INCLUDE path="chapter1.md" -->';
      const html = md.render(input);

      expect(html).toContain('include-placeholder');
      expect(html).toContain('data-path="chapter1.md"');
    });
  });

  describe('unknown directives', () => {
    it('should output comment for unknown directives', () => {
      const input = '<!-- ::UNKNOWN_DIRECTIVE -->';
      const html = md.render(input);

      expect(html).toContain('Unknown directive: UNKNOWN_DIRECTIVE');
    });
  });

  describe('edge cases', () => {
    it('should not match regular HTML comments', () => {
      const input = '<!-- This is a regular comment -->';
      const html = md.render(input);

      // Regular comments should pass through unchanged
      expect(html).not.toContain('break-page');
      expect(html).not.toContain('toc-placeholder');
    });

    it('should handle directives mixed with other content', () => {
      const input = `# Heading

<!-- ::PAGEBREAK -->

Paragraph text

<!-- ::TOC -->

More content`;

      const html = md.render(input);

      expect(html).toContain('Heading');
      expect(html).toContain('<div class="break-page">');
      expect(html).toContain('toc-placeholder');
      expect(html).toContain('More content');
    });
  });

  describe('INDEX directive', () => {
    it('should render INDEX with term as invisible marker', () => {
      const input = '<!-- ::INDEX term="aviation fuel" -->';
      const html = md.render(input);

      expect(html).toContain('<span class="index-marker"');
      expect(html).toContain('data-term="aviation fuel"');
      expect(html).toContain('data-sort="aviation fuel"');
    });

    it('should use custom sort key when provided', () => {
      const input = '<!-- ::INDEX term="jet fuel" sort="fuel, jet" -->';
      const html = md.render(input);

      expect(html).toContain('data-term="jet fuel"');
      expect(html).toContain('data-sort="fuel, jet"');
    });

    it('should render INDEX without term as placeholder', () => {
      const input = '<!-- ::INDEX -->';
      const html = md.render(input);

      expect(html).toContain('<div class="index-placeholder"></div>');
    });

    it('should escape HTML in term attribute', () => {
      const input = '<!-- ::INDEX term="<script>alert(1)</script>" -->';
      const html = md.render(input);

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should handle multiple index terms in document', () => {
      const input = `<!-- ::INDEX term="aviation" -->

<!-- ::INDEX term="fuel" -->

<!-- ::INDEX -->`;

      const html = md.render(input);

      const markers = html.match(/index-marker/g) || [];
      expect(markers.length).toBe(2);
      expect(html).toContain('index-placeholder');
    });

    it('should handle inline INDEX markers within text', () => {
      const input = 'This chapter covers <!-- ::INDEX term="aviation" -->aviation topics and <!-- ::INDEX term="fuel" -->fuel management.';
      const html = md.render(input);

      expect(html).toContain('<p>This chapter covers');
      expect(html).toContain('<span class="index-marker" data-term="aviation"');
      expect(html).toContain('aviation topics');
      expect(html).toContain('<span class="index-marker" data-term="fuel"');
      expect(html).toContain('fuel management.</p>');
      const markers = html.match(/index-marker/g) || [];
      expect(markers.length).toBe(2);
    });

    it('should handle INDEX markers in list items', () => {
      const input = `- <!-- ::INDEX term="turbine" -->Turbine blades
- <!-- ::INDEX term="compressor" sort="compressor stage" -->Compressor stages
- Regular item`;
      const html = md.render(input);

      expect(html).toContain('<span class="index-marker" data-term="turbine"');
      expect(html).toContain('<span class="index-marker" data-term="compressor"');
      expect(html).toContain('data-sort="compressor stage"');
      expect(html).toContain('Turbine blades');
      expect(html).toContain('Compressor stages');
      const markers = html.match(/index-marker/g) || [];
      expect(markers.length).toBe(2);
    });
  });
});

describe('enhanced figurePlugin', () => {
  let md;

  beforeEach(() => {
    md = new MarkdownIt();
    md.use(figurePlugin);
  });

  describe('src attribute', () => {
    it('should render figure with src attribute', () => {
      const input = '<!-- ::FIGURE src="diagram.png" caption="Test diagram" -->';
      const html = md.render(input);

      expect(html).toContain('<figure>');
      expect(html).toContain('<img src="diagram.png" alt="Test diagram">');
      expect(html).toContain('Figure');
      expect(html).toContain('Test diagram');
    });

    it('should not require image on next line when src provided', () => {
      const input = `<!-- ::FIGURE src="image.png" caption="Standalone" -->

Other content`;

      const html = md.render(input);

      expect(html).toContain('<img src="image.png"');
      expect(html).toContain('Other content');
    });
  });

  describe('id attribute', () => {
    it('should render figure with id', () => {
      const input = '<!-- ::FIGURE src="test.png" caption="Test" id="fig-1" -->';
      const html = md.render(input);

      expect(html).toContain('<figure id="fig-1"');
    });

    it('should escape HTML in id', () => {
      const input = '<!-- ::FIGURE src="test.png" caption="Test" id="fig<script>" -->';
      const html = md.render(input);

      expect(html).not.toContain('<script>');
    });
  });

  describe('width attribute', () => {
    it('should render figure with width class', () => {
      const input = '<!-- ::FIGURE src="test.png" caption="Test" width="full" -->';
      const html = md.render(input);

      expect(html).toContain('class="width-full"');
    });

    it('should handle half width', () => {
      const input = '<!-- ::FIGURE src="test.png" caption="Test" width="half" -->';
      const html = md.render(input);

      expect(html).toContain('class="width-half"');
    });
  });

  describe('all attributes combined', () => {
    it('should render figure with all attributes', () => {
      const input = '<!-- ::FIGURE src="arch.png" caption="System Architecture" id="fig-arch" width="full" -->';
      const html = md.render(input);

      expect(html).toContain('<figure id="fig-arch" class="width-full">');
      expect(html).toContain('<img src="arch.png" alt="System Architecture">');
      expect(html).toContain('<figcaption>Figure <span class="fig-num">1</span>: System Architecture</figcaption>');
    });
  });

  describe('backward compatibility', () => {
    it('should still work with caption-only and image on next line', () => {
      const input = `<!-- ::FIGURE caption="Legacy format" -->
![](legacy.png)`;

      const html = md.render(input);

      expect(html).toContain('<figure>');
      expect(html).toContain('Figure');
      expect(html).toContain('Legacy format');
    });
  });
});

