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

describe('detailsSection node view interaction', () => {
  const DETAILS_MD = [
    '<details>',
    '<summary>Title</summary>',
    '',
    'Body content.',
    '',
    '</details>',
  ].join('\n');

  function mountEditor(markdown: string): Editor {
    const editor = createEditor();
    editor.commands.setContent(markdown, { contentType: 'markdown' } as never);
    return editor;
  }

  function clickChevron(editor: Editor): HTMLElement {
    const chevron = editor.view.dom.querySelector('.details-chevron') as HTMLElement;
    expect(chevron).not.toBeNull();
    chevron.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return chevron;
  }

  function sectionElement(editor: Editor): HTMLElement {
    return editor.view.dom.querySelector('.details-section') as HTMLElement;
  }

  it('renders collapsed by default', () => {
    const editor = mountEditor(DETAILS_MD);
    const section = sectionElement(editor);

    expect(section).not.toBeNull();
    expect(section.classList.contains('details-collapsed')).toBe(true);
    expect(section.querySelector('.details-chevron')?.getAttribute('aria-expanded')).toBe('false');

    editor.destroy();
  });

  it('renders expanded when the source has <details open>', () => {
    const editor = mountEditor(DETAILS_MD.replace('<details>', '<details open>'));
    const section = sectionElement(editor);

    expect(section.classList.contains('details-collapsed')).toBe(false);
    expect(section.querySelector('.details-chevron')?.getAttribute('aria-expanded')).toBe('true');

    editor.destroy();
  });

  it('chevron click toggles the view without dirtying the document', () => {
    const editor = mountEditor(DETAILS_MD);
    const docBefore = editor.state.doc;
    const markdownBefore = getEditorMarkdownForSync(editor);

    clickChevron(editor);
    expect(sectionElement(editor).classList.contains('details-collapsed')).toBe(false);

    clickChevron(editor);
    expect(sectionElement(editor).classList.contains('details-collapsed')).toBe(true);

    // View-state only: no transaction touched the document.
    expect(editor.state.doc.eq(docBefore)).toBe(true);
    expect(getEditorMarkdownForSync(editor)).toBe(markdownBefore);

    editor.destroy();
  });

  it('insertDetailsSection wraps the current block and puts the cursor in the summary', () => {
    const editor = mountEditor('Some text');
    editor.commands.setTextSelection(3);

    const applied = editor.commands.insertDetailsSection();
    expect(applied).toBe(true);
    expect(editor.state.selection.$from.parent.type.name).toBe('detailsSummary');

    expect(getEditorMarkdownForSync(editor)).toBe(
      ['<details open>', '', 'Some text', '', '</details>'].join('\n')
    );

    editor.destroy();
  });

  it('insertDetailsSection wraps a multi-block selection', () => {
    const editor = mountEditor('First block.\n\nSecond block.');
    editor.commands.setTextSelection({ from: 2, to: editor.state.doc.content.size - 2 });

    expect(editor.commands.insertDetailsSection()).toBe(true);

    expect(getEditorMarkdownForSync(editor)).toBe(
      ['<details open>', '', 'First block.', '', 'Second block.', '', '</details>'].join('\n')
    );

    editor.destroy();
  });

  it('typing a title after insert serializes as the summary', () => {
    const editor = mountEditor('Body here.');
    editor.commands.setTextSelection(3);
    editor.commands.insertDetailsSection();
    editor.commands.insertContent('My title');

    expect(getEditorMarkdownForSync(editor)).toBe(
      ['<details open>', '<summary>My title</summary>', '', 'Body here.', '', '</details>'].join(
        '\n'
      )
    );

    editor.destroy();
  });

  it('toggleDetailsOpen flips the persisted open attribute', () => {
    const editor = mountEditor(DETAILS_MD);
    // Put the cursor inside the section (summary text position).
    const sectionPos = (() => {
      let pos = -1;
      editor.state.doc.descendants((node, nodePos) => {
        if (pos === -1 && node.type.name === 'detailsSection') pos = nodePos;
        return pos === -1;
      });
      return pos;
    })();
    editor.commands.setTextSelection(sectionPos + 2);

    expect(editor.commands.toggleDetailsOpen()).toBe(true);
    expect(getEditorMarkdownForSync(editor)).toBe(
      DETAILS_MD.replace('<details>', '<details open>')
    );

    expect(editor.commands.toggleDetailsOpen()).toBe(true);
    expect(getEditorMarkdownForSync(editor)).toBe(DETAILS_MD);

    editor.destroy();
  });

  it('toggleDetailsOpen is a no-op outside a section', () => {
    const editor = mountEditor('Plain paragraph.');
    editor.commands.setTextSelection(3);

    expect(editor.commands.toggleDetailsOpen()).toBe(false);

    editor.destroy();
  });

  it('moves the cursor out of a body being collapsed into the summary', () => {
    const editor = mountEditor(DETAILS_MD);

    clickChevron(editor); // expand first
    // Place the cursor inside the body paragraph ("Body content.").
    const bodyPos = (() => {
      let pos = -1;
      editor.state.doc.descendants((node, nodePos) => {
        if (pos === -1 && node.type.name === 'paragraph' && node.textContent === 'Body content.') {
          pos = nodePos + 1;
        }
        return pos === -1;
      });
      return pos;
    })();
    expect(bodyPos).toBeGreaterThan(-1);
    editor.commands.setTextSelection(bodyPos);

    clickChevron(editor); // collapse with cursor in body

    const { $from } = editor.state.selection;
    expect($from.parent.type.name).toBe('detailsSummary');

    editor.destroy();
  });
});
