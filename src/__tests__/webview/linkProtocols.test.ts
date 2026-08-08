/**
 * @jest-environment jsdom
 */

/**
 * Link protocol allowlist.
 *
 * Regression: vscode://file/<path>:<line> links did nothing in the editor —
 * TipTap's Link extension ships an XSS allowlist (http/https/mailto/…) and
 * silently refuses hrefs with unknown schemes, so the click dispatcher never
 * saw them. The editor now whitelists the vscode: protocols; script-ish
 * schemes must stay rejected.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Link from '@tiptap/extension-link';
import { MarkdownParagraph } from '../../webview/extensions/markdownParagraph';
import { BlankLinePreservation } from '../../webview/extensions/blankLinePreservation';
import { installBlankLineLexerNormalizer } from '../../webview/utils/markedLexerNormalizer';
import { getEditorMarkdownForSync } from '../../webview/utils/markdownSerialization';
import { shouldAutoLink } from '../../webview/utils/linkValidation';

function createEditor(): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);

  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ paragraph: false, link: false } as never),
      MarkdownParagraph,
      BlankLinePreservation,
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'markdown-link' },
        shouldAutoLink,
        protocols: ['vscode', 'vscode-insiders'],
      }),
    ],
  });

  const instance =
    (editor as unknown as { markdown?: { instance?: unknown } }).markdown?.instance ??
    (editor as unknown as { storage?: { markdown?: { instance?: unknown } } }).storage?.markdown
      ?.instance;
  installBlankLineLexerNormalizer(instance);
  return editor;
}

describe('link protocol allowlist', () => {
  it('keeps vscode://file links clickable and round-trips them', () => {
    const markdown =
      '[settings.json:79](vscode://file/c:/Users/me/AppData/Roaming/Code/User/settings.json:79)';

    const editor = createEditor();
    editor.commands.setContent(markdown, { contentType: 'markdown' } as never);

    const html = editor.getHTML();
    expect(html).toContain('href="vscode://file/');

    expect(getEditorMarkdownForSync(editor)).toBe(markdown);
    editor.destroy();
  });

  it('keeps https links working', () => {
    const editor = createEditor();
    editor.commands.setContent('[site](https://example.com)', {
      contentType: 'markdown',
    } as never);
    expect(editor.getHTML()).toContain('href="https://example.com"');
    editor.destroy();
  });

  it('still refuses javascript: hrefs', () => {
    const editor = createEditor();
    editor.commands.setContent('[evil](javascript:alert(1))', { contentType: 'markdown' } as never);
    expect(editor.getHTML()).not.toContain('href="javascript:');
    editor.destroy();
  });
});
