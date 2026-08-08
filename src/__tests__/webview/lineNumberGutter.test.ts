/** @jest-environment jsdom */

/**
 * The gutter's contract is that a number in the margin is the line the block
 * occupies in the SAVED file — so every assertion here checks the decoration
 * against `getEditorMarkdownForSync` output rather than a hand-counted
 * expectation, which is what would drift if the saver ever changed.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { ListKit } from '@tiptap/extension-list';
import { MarkdownParagraph } from '../../webview/extensions/markdownParagraph';
import { OrderedListMarkdownFix } from '../../webview/extensions/orderedListMarkdownFix';
import { BlankLinePreservation } from '../../webview/extensions/blankLinePreservation';
import {
  GUTTER_ACTIVE_CLASS,
  GUTTER_BLOCK_CLASS,
  LineNumberGutter,
  areLineNumbersEnabled,
  buildGutterDecorations,
  computeGutterLineNumbers,
  lineNumberGutterPluginKey,
  refreshLineNumbers,
  setLineNumbersEnabled,
} from '../../webview/extensions/lineNumberGutter';
import { getEditorMarkdownForSync } from '../../webview/utils/markdownSerialization';
import { installBlankLineLexerNormalizer } from '../../webview/utils/markedLexerNormalizer';
import type { BlankLineMode } from '../../shared/blankLinePolicy';

function createEditor(
  initialMarkdown: string,
  options: { enabled?: boolean; blankLineMode?: BlankLineMode } = {}
): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        paragraph: false,
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        undoRedo: { depth: 100 },
      }),
      MarkdownParagraph,
      BlankLinePreservation,
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
      ListKit.configure({ orderedList: false, taskItem: { nested: true } }),
      OrderedListMarkdownFix,
      LineNumberGutter.configure({
        enabled: options.enabled ?? true,
        getBlankLineMode: () => options.blankLineMode ?? 'preserve',
      }),
    ],
    content: '',
    contentType: 'markdown',
  });
  const markdownStorage = editor as unknown as {
    markdown?: { instance?: unknown };
    storage?: { markdown?: { instance?: unknown } };
  };
  const markedInstance =
    markdownStorage.markdown?.instance ?? markdownStorage.storage?.markdown?.instance;
  if (markedInstance) {
    installBlankLineLexerNormalizer(markedInstance);
  }
  if (initialMarkdown) {
    editor.commands.setContent(initialMarkdown, { contentType: 'markdown' });
  }
  return editor;
}

/** The rendered numbers, in document order, as the user would read them. */
function renderedLineNumbers(editor: Editor): number[] {
  return Array.from(editor.view.dom.querySelectorAll(`.${GUTTER_BLOCK_CLASS}`)).map(el =>
    Number(el.getAttribute('data-source-line'))
  );
}

describe('computeGutterLineNumbers', () => {
  it('maps every content block to its start line in the saved file', () => {
    const editor = createEditor('# Title\n\nFirst paragraph\n\nSecond paragraph');
    const saved = getEditorMarkdownForSync(editor).split('\n');

    const lines = computeGutterLineNumbers(editor, 'preserve');
    expect(lines).not.toBeNull();
    expect(Array.from(lines!.values())).toEqual([1, 3, 5]);
    expect(saved[0]).toBe('# Title');
    expect(saved[2]).toBe('First paragraph');
    expect(saved[4]).toBe('Second paragraph');
    editor.destroy();
  });

  it('accounts for multi-line blocks when numbering what follows', () => {
    const editor = createEditor('- one\n- two\n- three\n\nAfter');
    const saved = getEditorMarkdownForSync(editor).split('\n');

    const lines = computeGutterLineNumbers(editor, 'preserve');
    const values = Array.from(lines!.values());
    expect(values[0]).toBe(1);
    // The list occupies three lines, so "After" starts on line 5, not line 3.
    expect(saved[values[1] - 1]).toBe('After');
    editor.destroy();
  });

  it('skips blank-line paragraphs — they have no source line to point at', () => {
    const editor = createEditor('A\n\n\n\nB', { blankLineMode: 'preserve' });
    const saved = getEditorMarkdownForSync(editor, 'preserve').split('\n');

    const lines = computeGutterLineNumbers(editor, 'preserve');
    // Three top-level nodes (A, empty paragraph, B) but only two numbers.
    expect(editor.state.doc.childCount).toBeGreaterThan(lines!.size);
    const values = Array.from(lines!.values());
    expect(saved[values[0] - 1]).toBe('A');
    expect(saved[values[values.length - 1] - 1]).toBe('B');
    editor.destroy();
  });

  it('follows the blank-line policy the saver is using', () => {
    const editor = createEditor('A\n\n\n\nB', { blankLineMode: 'strip' });
    const stripped = computeGutterLineNumbers(editor, 'strip');
    const preserved = computeGutterLineNumbers(editor, 'preserve');
    // Stripping the extra blank line pulls B one line up.
    expect(Array.from(stripped!.values())).toEqual([1, 3]);
    expect(Array.from(preserved!.values())).toEqual([1, 5]);
    editor.destroy();
  });

  it('returns null for an empty document rather than guessing', () => {
    const editor = createEditor('');
    expect(computeGutterLineNumbers(editor, 'preserve')).toBeNull();
    editor.destroy();
  });
});

describe('buildGutterDecorations', () => {
  it('decorates exactly the mapped blocks, at their own positions', () => {
    const editor = createEditor('First\n\nSecond\n\nThird');
    const doc = editor.state.doc;
    const set = buildGutterDecorations(
      doc,
      new Map([
        [0, 1],
        [2, 5],
      ])
    );
    const found = set.find();
    expect(found).toHaveLength(2);
    expect(found[0].from).toBe(0);
    expect(found[1].from).toBe(doc.child(0).nodeSize + doc.child(1).nodeSize);
    editor.destroy();
  });

  it('omits a block with no mapping instead of numbering it wrongly', () => {
    const editor = createEditor('First\n\nSecond');
    const set = buildGutterDecorations(editor.state.doc, new Map([[1, 3]]));
    expect(set.find()).toHaveLength(1);
    editor.destroy();
  });
});

describe('gutter rendering', () => {
  it('renders the numbers in the DOM and marks the editable as gutter-on', () => {
    const editor = createEditor('# Title\n\nBody');
    refreshLineNumbers(editor, 'preserve');

    expect(editor.view.dom.classList.contains(GUTTER_ACTIVE_CLASS)).toBe(true);
    expect(renderedLineNumbers(editor)).toEqual([1, 3]);
    editor.destroy();
  });

  it('renders nothing when disabled, and paints once switched on', () => {
    const editor = createEditor('# Title\n\nBody', { enabled: false });
    refreshLineNumbers(editor, 'preserve');
    expect(areLineNumbersEnabled(editor)).toBe(false);
    expect(renderedLineNumbers(editor)).toEqual([]);
    expect(editor.view.dom.classList.contains(GUTTER_ACTIVE_CLASS)).toBe(false);

    setLineNumbersEnabled(editor, true);
    refreshLineNumbers(editor, 'preserve');
    expect(renderedLineNumbers(editor)).toEqual([1, 3]);
    editor.destroy();
  });

  it('clears the numbers when switched off', () => {
    const editor = createEditor('# Title\n\nBody');
    refreshLineNumbers(editor, 'preserve');
    expect(renderedLineNumbers(editor)).toHaveLength(2);

    setLineNumbersEnabled(editor, false);
    expect(renderedLineNumbers(editor)).toEqual([]);
    expect(lineNumberGutterPluginKey.getState(editor.state)?.decorations.find()).toHaveLength(0);
    editor.destroy();
  });

  it('keeps existing numbers attached to their blocks between recomputes', () => {
    const editor = createEditor('First\n\nSecond');
    refreshLineNumbers(editor, 'preserve');
    expect(renderedLineNumbers(editor)).toEqual([1, 3]);

    // Insert a new first paragraph WITHOUT recomputing: the debounced pass has
    // not run yet, so the old numbers must still be on their original blocks
    // (mapped through the transaction), not detached or shifted onto the new one.
    editor.commands.insertContentAt(0, '<p>New</p>');
    const stale = editor.view.dom.querySelectorAll(`.${GUTTER_BLOCK_CLASS}`);
    expect(stale).toHaveLength(2);
    expect(stale[0].textContent).toContain('First');

    refreshLineNumbers(editor, 'preserve');
    expect(renderedLineNumbers(editor)).toEqual([1, 3, 5]);
    editor.destroy();
  });

  it('recomputes after an edit once the debounce elapses', () => {
    jest.useFakeTimers();
    try {
      const editor = createEditor('First\n\nSecond');
      jest.runOnlyPendingTimers();
      expect(renderedLineNumbers(editor)).toEqual([1, 3]);

      editor.commands.insertContentAt(0, '<p>New</p>');
      jest.advanceTimersByTime(500);
      expect(renderedLineNumbers(editor)).toEqual([1, 3, 5]);
      editor.destroy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('every rendered number points at that block’s own text in the saved file', () => {
    const editor = createEditor(
      ['# Heading', '', 'A paragraph.', '', '- one', '- two', '', '> Quote', '', 'Tail.'].join('\n')
    );
    refreshLineNumbers(editor, 'preserve');
    const saved = getEditorMarkdownForSync(editor, 'preserve').split('\n');

    const decorated = Array.from(
      editor.view.dom.querySelectorAll(`.${GUTTER_BLOCK_CLASS}`)
    ) as HTMLElement[];
    expect(decorated.length).toBeGreaterThan(0);
    for (const el of decorated) {
      const line = Number(el.getAttribute('data-source-line'));
      expect(line).toBeGreaterThanOrEqual(1);
      expect(line).toBeLessThanOrEqual(saved.length);
      // The block's first word must appear on the line the gutter advertises.
      // Read it from the first text node rather than `textContent`, which
      // concatenates list items into a single unbroken string.
      const firstTextNode = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
      const firstWord = (firstTextNode?.textContent ?? '').trim().split(/\s+/)[0];
      if (firstWord) {
        expect(saved[line - 1]).toContain(firstWord);
      }
    }
    editor.destroy();
  });
});
