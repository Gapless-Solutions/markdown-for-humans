/**
 * @jest-environment jsdom
 */

/**
 * Source position jump: gesture matching and the line->block-position inverse
 * of the aiContextReference block/line mapping.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { MarkdownParagraph } from '../../webview/extensions/markdownParagraph';
import { BlankLinePreservation } from '../../webview/extensions/blankLinePreservation';
import { installBlankLineLexerNormalizer } from '../../webview/utils/markedLexerNormalizer';
import {
  matchesSourceJumpGesture,
  normalizeSourceJumpModifier,
} from '../../webview/utils/sourceJump';
import {
  computeSelectionBlockRange,
  findBlockPosForLine,
} from '../../webview/utils/aiContextReference';

function keys(overrides: Partial<Record<'alt' | 'ctrl' | 'meta' | 'shift', boolean>> = {}) {
  return {
    altKey: overrides.alt ?? false,
    ctrlKey: overrides.ctrl ?? false,
    metaKey: overrides.meta ?? false,
    shiftKey: overrides.shift ?? false,
  };
}

describe('matchesSourceJumpGesture', () => {
  it('alt: requires exactly Alt', () => {
    expect(matchesSourceJumpGesture(keys({ alt: true }), 'alt')).toBe(true);
    expect(matchesSourceJumpGesture(keys(), 'alt')).toBe(false);
    expect(matchesSourceJumpGesture(keys({ alt: true, ctrl: true }), 'alt')).toBe(false);
    expect(matchesSourceJumpGesture(keys({ alt: true, shift: true }), 'alt')).toBe(false);
  });

  it('ctrl: accepts Cmd as Ctrl, rejects extra modifiers', () => {
    expect(matchesSourceJumpGesture(keys({ ctrl: true }), 'ctrl')).toBe(true);
    expect(matchesSourceJumpGesture(keys({ meta: true }), 'ctrl')).toBe(true);
    expect(matchesSourceJumpGesture(keys({ ctrl: true, alt: true }), 'ctrl')).toBe(false);
  });

  it('shift: requires exactly Shift', () => {
    expect(matchesSourceJumpGesture(keys({ shift: true }), 'shift')).toBe(true);
    expect(matchesSourceJumpGesture(keys({ shift: true, alt: true }), 'shift')).toBe(false);
  });

  it('none: fires only with no modifiers held', () => {
    expect(matchesSourceJumpGesture(keys(), 'none')).toBe(true);
    expect(matchesSourceJumpGesture(keys({ alt: true }), 'none')).toBe(false);
  });

  it('disabled: never fires', () => {
    expect(matchesSourceJumpGesture(keys(), 'disabled')).toBe(false);
    expect(matchesSourceJumpGesture(keys({ alt: true }), 'disabled')).toBe(false);
  });
});

describe('normalizeSourceJumpModifier', () => {
  it('passes valid values through and defaults the rest to ctrl', () => {
    expect(normalizeSourceJumpModifier('ctrl')).toBe('ctrl');
    expect(normalizeSourceJumpModifier('disabled')).toBe('disabled');
    expect(normalizeSourceJumpModifier('bogus')).toBe('ctrl');
    expect(normalizeSourceJumpModifier(undefined)).toBe('ctrl');
  });
});

describe('findBlockPosForLine', () => {
  function createEditor(markdown: string): Editor {
    const element = document.createElement('div');
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({ paragraph: false } as never),
        MarkdownParagraph,
        BlankLinePreservation,
        Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
      ],
    });
    const instance =
      (editor as unknown as { markdown?: { instance?: unknown } }).markdown?.instance ??
      (editor as unknown as { storage?: { markdown?: { instance?: unknown } } }).storage?.markdown
        ?.instance;
    installBlankLineLexerNormalizer(instance);
    editor.commands.setContent(markdown, { contentType: 'markdown' } as never);
    return editor;
  }

  const MARKDOWN = [
    '# Title', // line 1
    '',
    'First paragraph.', // line 3
    '',
    '- item one', // lines 5-6
    '- item two',
    '',
    'Last paragraph.', // line 8
  ].join('\n');

  it('round-trips with the selection->line mapping for every block', () => {
    const editor = createEditor(MARKDOWN);

    editor.state.doc.content.forEach((_node, offset) => {
      const blockPos = offset + 1;
      editor.commands.setTextSelection(blockPos);
      const forward = computeSelectionBlockRange(editor);
      expect(forward.ok).toBe(true);
      if (forward.ok) {
        const back = findBlockPosForLine(editor, forward.range.startLine);
        expect(back).toBe(blockPos);
      }
    });

    editor.destroy();
  });

  it('maps interior lines of a multi-line block to the block start', () => {
    const editor = createEditor(MARKDOWN);
    // Line 6 ("- item two") is inside the list block starting at line 5.
    expect(findBlockPosForLine(editor, 6)).toBe(findBlockPosForLine(editor, 5));
    editor.destroy();
  });

  it('clamps lines past the end to the last block', () => {
    const editor = createEditor(MARKDOWN);
    const lastBlockPos = findBlockPosForLine(editor, 8);
    expect(findBlockPosForLine(editor, 999)).toBe(lastBlockPos);
    editor.destroy();
  });

  it('returns null for an empty document', () => {
    const editor = createEditor('');
    expect(findBlockPosForLine(editor, 1)).toBeNull();
    editor.destroy();
  });
});
