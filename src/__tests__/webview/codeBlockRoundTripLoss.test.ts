/** @jest-environment jsdom */

/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 *
 * Regression tests for silent block loss on the WYSIWYG round-trip.
 *
 * Observed 2026-08-25 on three real documents: opening a markdown file whose
 * last section ends in a fenced code block, and letting `files.autoSave` fire,
 * wrote the file back with the fenced block — and its heading — gone. 735-848
 * bytes per file, no error, no prompt.
 *
 * The loss path is in `getEditorMarkdownForSync`: a top-level node that
 * serializes to `''` (because the markdown serializer has no rule for it, or
 * threw) was treated as if it were an empty paragraph, contributing a blank
 * line instead of its content. That is correct for a genuinely empty node and
 * catastrophic for everything else.
 *
 * It also explains why `isMarkdownStructurallyEquivalent` did not suppress the
 * write. That guard exists to swallow the serializer's cosmetic churn — the
 * editor parses with `breaks: true`, so every soft-wrapped prose line comes
 * back as a hard break. Losing a code block makes the two documents genuinely
 * non-equivalent, so the guard has to let the write through, and the cosmetic
 * reflow rides along with it. Fixing the loss is therefore what stops the
 * reflow reaching disk too.
 *
 * `CodeBlock` stands in for `CodeBlockWithCopy` here, extended with the same
 * markdown handlers and `indent-prefix` attribute, so the test does not need
 * the ESM-only lowlight runtime — the same convention as
 * `preservedCodeBlock.test.ts`.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import CodeBlock from '@tiptap/extension-code-block';
import type { JSONContent } from '@tiptap/core';
import {
  parsePreservedCodeBlock,
  renderPreservedCodeBlock,
} from '../../webview/extensions/preservedCodeBlock';
import { MarkdownParagraph } from '../../webview/extensions/markdownParagraph';
import { BlankLinePreservation } from '../../webview/extensions/blankLinePreservation';
import { getEditorMarkdownForSync } from '../../webview/utils/markdownSerialization';

const PreservedCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'indent-prefix': { default: null },
    };
  },
  parseMarkdown: parsePreservedCodeBlock,
  renderMarkdown: renderPreservedCodeBlock,
});

/**
 * The production extension set, narrowed to what governs code blocks and
 * serialization. Mirrors `editor.ts`: `codeBlock: false` on StarterKit with a
 * separate code-block extension, and `breaks: true`.
 */
function createEditor(): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        paragraph: false,
        codeBlock: false,
        link: false,
        undoRedo: { depth: 100 },
      }),
      MarkdownParagraph,
      PreservedCodeBlock,
      BlankLinePreservation,
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
    ],
  });
}

function roundTrip(markdown: string): string {
  const editor = createEditor();
  try {
    editor.commands.setContent(markdown, { contentType: 'markdown' });
    return getEditorMarkdownForSync(editor);
  } finally {
    editor.destroy();
  }
}

describe('WYSIWYG round-trip must never drop a block', () => {
  it('keeps a trailing fenced code block (the shipped defect)', () => {
    const source = ['## Kick-off prompt', '', '```', 'Read the handover and run it.', '```'].join(
      '\n'
    );

    const out = roundTrip(source);

    expect(out).toContain('Kick-off prompt');
    expect(out).toContain('Read the handover and run it.');
    expect((out.match(/^```/gm) || []).length).toBe(2);
  });

  it('keeps a fenced code block in the middle of a document', () => {
    const source = ['Before.', '', '```bash', 'echo hi', '```', '', 'After.'].join('\n');

    const out = roundTrip(source);

    expect(out).toContain('echo hi');
    expect(out).toContain('After.');
  });
});

describe('getEditorMarkdownForSync — a block that will not serialize', () => {
  /**
   * Drives the loss path directly, independent of which node type the
   * serializer happens to lack a rule for. A serializer that yields '' for one
   * block is exactly the shape of the shipped bug, and the only safe answer is
   * to refuse the sync rather than emit a document missing that block.
   */
  function fakeEditor(children: JSONContent[], failFor: string): Editor {
    return {
      getJSON: () => ({ type: 'doc', content: children }),
      markdown: {
        serialize: (json: JSONContent) => {
          const node = json.content?.[0];
          if (!node || node.type === failFor) return '';
          if (node.type === 'paragraph') {
            return (node.content || []).map(c => c.text || '').join('');
          }
          return '';
        },
      },
    } as unknown as Editor;
  }

  const doc: JSONContent[] = [
    { type: 'paragraph', content: [{ type: 'text', text: 'kept' }] },
    { type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'lost()' }] },
  ];

  it('throws rather than silently dropping the block', () => {
    expect(() => getEditorMarkdownForSync(fakeEditor(doc, 'codeBlock'))).toThrow(/codeBlock/);
  });

  it('names the node type in the error, so the cause is not a mystery', () => {
    expect(() => getEditorMarkdownForSync(fakeEditor(doc, 'codeBlock'))).toThrow(
      /serialize|serialise/i
    );
  });
});
