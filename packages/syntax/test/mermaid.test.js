/**
 * The mermaid fence helpers (moved from pagemd's parser in phase C6, R-108): finding diagrams and their
 * <figure> attributes, plus the version and settings pagemd and the editor share.
 */

import { describe, it, expect } from 'vitest';
import { extractMermaidBlocks, parseFenceAttributes, MERMAID_VERSION, MERMAID_CONFIG } from '../src/index.js';

describe('mermaid helpers', () => {
  describe('extractMermaidBlocks', () => {
    it('should extract standard mermaid block', () => {
      const md = '```mermaid\ngraph LR\n  A --> B\n```';
      const blocks = extractMermaidBlocks(md);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].code).toBe('graph LR\n  A --> B');
      expect(blocks[0].attrs).toBeNull();
    });

    it('should handle trailing whitespace after mermaid keyword', () => {
      const md = '```mermaid   \ngraph LR\n  A --> B\n```';
      const blocks = extractMermaidBlocks(md);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].code).toBe('graph LR\n  A --> B');
      expect(blocks[0].attrs).toBeNull();
    });

    it('should capture attributes on opening fence', () => {
      const md = '```mermaid {.custom-class}\ngraph LR\n  A --> B\n```';
      const blocks = extractMermaidBlocks(md);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].code).toBe('graph LR\n  A --> B');
      expect(blocks[0].attrs).toBe('.custom-class');
    });

    it('should capture attributes on closing fence', () => {
      const md = '```mermaid\ngraph LR\n  A --> B\n``` {style="max-width: 200px"}';
      const blocks = extractMermaidBlocks(md);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].code).toBe('graph LR\n  A --> B');
      expect(blocks[0].attrs).toBe('style="max-width: 200px"');
    });

    it('should merge attributes from both fences (opening first)', () => {
      const md = '```mermaid {.diagram}\ngraph LR\n  A --> B\n``` {style="max-width: 200px"}';
      const blocks = extractMermaidBlocks(md);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].attrs).toBe('.diagram style="max-width: 200px"');
    });

    it('should capture complex attributes on opening fence', () => {
      const md = '```mermaid {.flow-chart #fig-1 style="max-width: 200px; margin: 0 auto;"}\ngraph LR\n  A --> B\n```';
      const blocks = extractMermaidBlocks(md);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].attrs).toBe('.flow-chart #fig-1 style="max-width: 200px; margin: 0 auto;"');
    });

    it('should extract multiple mermaid blocks', () => {
      const md = '# Title\n\n```mermaid {.a}\ngraph LR\n  A --> B\n```\n\nText\n\n```mermaid\nsequenceDiagram\n  A->>B: Hi\n``` {.b}';
      const blocks = extractMermaidBlocks(md);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].attrs).toBe('.a');
      expect(blocks[0].code).toBe('graph LR\n  A --> B');
      expect(blocks[1].attrs).toBe('.b');
      expect(blocks[1].code).toBe('sequenceDiagram\n  A->>B: Hi');
    });

    it('should not match non-mermaid code blocks', () => {
      const md = '```javascript\nconst x = 1;\n```';
      const blocks = extractMermaidBlocks(md);
      expect(blocks).toHaveLength(0);
    });
  });

  describe('parseFenceAttributes', () => {
    it('should return default class when attrs is null', () => {
      expect(parseFenceAttributes(null)).toBe(' class="mermaid-diagram"');
    });

    it('should return default class when attrs is empty string', () => {
      expect(parseFenceAttributes('')).toBe(' class="mermaid-diagram"');
    });

    it('should parse .class-name', () => {
      const result = parseFenceAttributes('.custom-class');
      expect(result).toBe(' class="mermaid-diagram custom-class"');
    });

    it('should parse multiple classes', () => {
      const result = parseFenceAttributes('.flow-chart .centered');
      expect(result).toBe(' class="mermaid-diagram flow-chart centered"');
    });

    it('should parse #id', () => {
      const result = parseFenceAttributes('#fig-1');
      expect(result).toContain('id="fig-1"');
      expect(result).toContain('class="mermaid-diagram"');
    });

    it('should parse key="value" attributes', () => {
      const result = parseFenceAttributes('style="max-width: 200px"');
      expect(result).toContain('style="max-width: 200px"');
      expect(result).toContain('class="mermaid-diagram"');
    });

    it('should parse key=\'value\' (single quotes)', () => {
      const result = parseFenceAttributes("style='color: red'");
      expect(result).toContain('style="color: red"');
    });

    it('should parse combined class + id + style', () => {
      const result = parseFenceAttributes('.flow-chart #fig-1 style="max-width: 200px; margin: 0 auto;"');
      expect(result).toContain('class="mermaid-diagram flow-chart"');
      expect(result).toContain('id="fig-1"');
      expect(result).toContain('style="max-width: 200px; margin: 0 auto;"');
    });

    it('should use first id when duplicates exist (opening fence precedence)', () => {
      const result = parseFenceAttributes('#opening-id #closing-id');
      expect(result).toContain('id="opening-id"');
      expect(result).not.toContain('closing-id');
    });

    it('should use first value for duplicate keys (opening fence precedence)', () => {
      const result = parseFenceAttributes('style="color: red" style="color: blue"');
      expect(result).toContain('style="color: red"');
      expect(result).not.toContain('color: blue');
    });

    it('should combine classes from both fences', () => {
      const result = parseFenceAttributes('.from-opening .from-closing');
      expect(result).toBe(' class="mermaid-diagram from-opening from-closing"');
    });

    it('should handle data attributes', () => {
      const result = parseFenceAttributes('data-caption="Flow diagram"');
      expect(result).toContain('data-caption="Flow diagram"');
    });
  });
  describe('fences inside other fences (phase C6)', () => {
    it('does not take a ```mermaid example inside a ````markdown block as a diagram', () => {
      const md = '````markdown\n```mermaid\ngraph LR\n  A --> B\n```\n````\n\n```mermaid\ngraph TD\n  C --> D\n```\n';
      const blocks = extractMermaidBlocks(md);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].code).toBe('graph TD\n  C --> D');
    });

    it('does not take a ```mermaid example inside a ~~~ block as a diagram', () => {
      const md = '~~~\n```mermaid\ngraph LR\n```\n~~~\n';
      expect(extractMermaidBlocks(md)).toHaveLength(0);
    });

    it('does not end a ```` mermaid fence at a shorter ``` run', () => {
      const md = '````mermaid\ngraph LR\n  A["```"] --> B\n````\n';
      const blocks = extractMermaidBlocks(md);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].code).toBe('graph LR\n  A["```"] --> B');
    });

    it('finds an indented diagram (inside a list item), offsets at the fence', () => {
      const md = '- item\n\n  ```mermaid\n  graph LR\n  ```\n';
      const [block] = extractMermaidBlocks(md);
      expect(block.code).toBe('graph LR');
      expect(md.slice(block.start, block.end)).toBe(block.fullMatch);
      expect(block.fullMatch.startsWith('```mermaid')).toBe(true);
    });

    it('reads CRLF text', () => {
      const md = '```mermaid {.a}\r\ngraph LR\r\n```\r\n';
      const [block] = extractMermaidBlocks(md);
      expect(block.code).toBe('graph LR');
      expect(block.attrs).toBe('.a');
    });

    it('ignores an unclosed fence', () => {
      expect(extractMermaidBlocks('```mermaid\ngraph LR\n')).toHaveLength(0);
    });
  });

  describe('shared settings', () => {
    it('names one exact mermaid version and strict security', () => {
      expect(MERMAID_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
      expect(MERMAID_CONFIG).toMatchObject({ startOnLoad: false, securityLevel: 'strict' });
      expect(Object.isFrozen(MERMAID_CONFIG)).toBe(true);
    });
  });
});
