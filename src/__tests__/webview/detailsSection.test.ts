/**
 * @jest-environment jsdom
 */

/**
 * Collapsible `<details>` sections: round-trip and structure coverage.
 *
 * Load — markdown on disk -> marked -> ProseMirror. A `<details>` block whose
 * body is markdown arrives as an `html` fragment token, loose markdown tokens
 * for the body, and a closing `</details>` fragment. Without the details
 * merger + DetailsSection extension the wrapper tags are dropped by the HTML
 * fallback parser and saving silently destroys the collapsible markup.
 */

import { Editor } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import {
  DetailsSection,
  DetailsSummary,
  installDetailsBlockMerger,
} from '../../webview/extensions/detailsSection';
import { MarkdownParagraph } from '../../webview/extensions/markdownParagraph';
import { BlankLinePreservation } from '../../webview/extensions/blankLinePreservation';
import { installBlankLineLexerNormalizer } from '../../webview/utils/markedLexerNormalizer';
import { getEditorMarkdownForSync } from '../../webview/utils/markdownSerialization';

function createEditor(): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);

  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ paragraph: false } as never),
      MarkdownParagraph,
      BlankLinePreservation,
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
      DetailsSection,
      DetailsSummary,
    ],
  });

  // Production install order (editor.ts): the details merger FIRST, so it
  // sees marked's raw tokens before the blank-line normalizer's scaffolding
  // filter drops bare `</details>` fragments.
  const instance =
    (editor as unknown as { markdown?: { instance?: unknown } }).markdown?.instance ??
    (editor as unknown as { storage?: { markdown?: { instance?: unknown } } }).storage?.markdown
      ?.instance;
  installDetailsBlockMerger(instance);
  installBlankLineLexerNormalizer(instance);

  return editor;
}

function roundTrip(markdown: string): string {
  const editor = createEditor();
  editor.commands.setContent(markdown, { contentType: 'markdown' } as never);
  const serialized = getEditorMarkdownForSync(editor);
  editor.destroy();
  return serialized;
}

function parseToJson(markdown: string): JSONContent {
  const editor = createEditor();
  editor.commands.setContent(markdown, { contentType: 'markdown' } as never);
  const json = editor.getJSON() as JSONContent;
  editor.destroy();
  return json;
}

describe('detailsSection markdown round-trip', () => {
  it('preserves a canonical details block with markdown body byte-for-byte', () => {
    const markdown = [
      '# Doc',
      '',
      '<details>',
      '<summary>Click to expand</summary>',
      '',
      'Hidden **content** here.',
      '',
      '- item one',
      '- item two',
      '',
      '</details>',
      '',
      'After the section.',
    ].join('\n');

    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('preserves the open attribute', () => {
    const markdown = [
      '<details open>',
      '<summary>Expanded by default</summary>',
      '',
      'Body.',
      '',
      '</details>',
    ].join('\n');

    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('parses into a detailsSection node with summary and markdown body structure', () => {
    const markdown = [
      '<details open>',
      '<summary>Click to expand</summary>',
      '',
      'Hidden **content** here.',
      '',
      '- item one',
      '',
      '</details>',
    ].join('\n');

    const json = parseToJson(markdown);
    const section = (json.content || []).find(node => node.type === 'detailsSection');

    expect(section).toBeDefined();
    expect(section?.attrs?.open).toBe(true);

    const children = section?.content || [];
    expect(children[0]?.type).toBe('detailsSummary');
    expect(children[0]?.content?.[0]?.text).toBe('Click to expand');

    const bodyTypes = children.slice(1).map(child => child.type);
    expect(bodyTypes).toContain('paragraph');
    expect(bodyTypes).toContain('bulletList');

    const paragraph = children.find(child => child.type === 'paragraph');
    const boldText = paragraph?.content?.find(inline =>
      (inline.marks || []).some(mark => mark.type === 'bold')
    );
    expect(boldText?.text).toBe('content');
  });

  it('does not invent a summary when the source has none', () => {
    const markdown = ['<details>', '', 'Just body text.', '', '</details>'].join('\n');

    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('serializes a summary-only section without inventing body blank lines', () => {
    const markdown = ['<details>', '<summary>Only a summary</summary>', '</details>'].join('\n');

    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('preserves nested details blocks byte-for-byte', () => {
    const markdown = [
      '<details>',
      '<summary>Outer</summary>',
      '',
      'Intro.',
      '',
      '<details>',
      '<summary>Inner</summary>',
      '',
      'Inner body.',
      '',
      '</details>',
      '',
      '</details>',
    ].join('\n');

    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('normalizes a single-line details block while keeping all tags and text', () => {
    const markdown = '<details><summary>Title</summary>Body text.</details>';

    const serialized = roundTrip(markdown);
    expect(serialized).toContain('<details>');
    expect(serialized).toContain('<summary>Title</summary>');
    expect(serialized).toContain('Body text.');
    expect(serialized).toContain('</details>');
  });

  it('keeps blank-line runs inside the body', () => {
    const markdown = [
      '<details>',
      '<summary>Spaced body</summary>',
      '',
      'First block.',
      '',
      '',
      'Second block after an extra blank line.',
      '',
      '</details>',
    ].join('\n');

    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('does not crash or lose text on an unclosed details block', () => {
    const markdown = ['<details>', '<summary>Broken</summary>', '', 'Orphan body.'].join('\n');

    const serialized = roundTrip(markdown);
    expect(serialized).toContain('Orphan body.');
  });

  it('round-trips markdown formatting inside the summary', () => {
    const markdown = [
      '<details>',
      '<summary>**Bold** title</summary>',
      '',
      'Body.',
      '',
      '</details>',
    ].join('\n');

    expect(roundTrip(markdown)).toBe(markdown);
  });
});
