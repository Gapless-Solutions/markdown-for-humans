/**
 * @jest-environment jsdom
 */

/**
 * linkifyjs custom-scheme registration, in the order the webview actually
 * builds the editor.
 *
 * Regression: the packaged extension logged, on every document open,
 *
 *   linkifyjs: already initialized - will not register custom scheme "vscode"
 *
 * TipTap's Link extension registers its `protocols` in `onCreate`, which the
 * editor emits from a `setTimeout(…, 0)` after mounting — while editor.ts sets
 * the initial content synchronously right after construction. With a document
 * of more than one block, the autolink plugin tokenizes that content
 * immediately, compiling linkify's scanner first, and the registration is
 * dropped. Bare `vscode://…` URLs then never autolink.
 *
 * The existing link tests can't see this: a single-paragraph document makes the
 * autolink plugin bail before it tokenizes anything, so linkify is still
 * uninitialised when `onCreate` finally runs. The multi-block initial content
 * below is the whole point of this file — keep it.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Link, { isAllowedUri } from '@tiptap/extension-link';
import { find } from 'linkifyjs';
import { MarkdownParagraph } from '../../webview/extensions/markdownParagraph';
import { BlankLinePreservation } from '../../webview/extensions/blankLinePreservation';
import { shouldAutoLink } from '../../webview/utils/linkValidation';
import {
  CUSTOM_LINK_PROTOCOLS,
  registerCustomLinkProtocols,
} from '../../webview/utils/linkProtocols';

const VSCODE_URL = 'vscode://file/c:/Users/me/notes/a.md:12';

/** Multi-block, like every real document — see the file header. */
const INITIAL_CONTENT = '# Title\n\nfirst paragraph\n\nsecond paragraph\n';

/** Mirrors initializeEditor() in editor.ts: register, construct, set content. */
function createEditorLikeProduction(): Editor {
  registerCustomLinkProtocols();

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
        isAllowedUri: (url: string) => !!isAllowedUri(url, CUSTOM_LINK_PROTOCOLS),
      }),
    ],
  });

  editor.commands.setContent(INITIAL_CONTENT, { contentType: 'markdown' } as never);
  return editor;
}

/** Let the editor's deferred 'create' event fire, as it does in the webview. */
const flushCreate = () => new Promise(resolve => setTimeout(resolve, 0));

describe('linkify custom scheme registration', () => {
  it('detects vscode:// URLs after the production init sequence', async () => {
    const editor = createEditorLikeProduction();
    await flushCreate();

    const found = find(`see ${VSCODE_URL} here`);
    expect(found).toHaveLength(1);
    expect(found[0].href).toBe(VSCODE_URL);

    editor.destroy();
  });

  it('autolinks a bare vscode:// URL typed into the document', async () => {
    const editor = createEditorLikeProduction();
    await flushCreate();

    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(` ${VSCODE_URL} `); // autolink needs the spaces

    expect(editor.getHTML()).toContain(`href="${VSCODE_URL}"`);

    editor.destroy();
  });

  it('still autolinks ordinary https URLs', async () => {
    const editor = createEditorLikeProduction();
    await flushCreate();

    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(' https://example.com ');

    expect(editor.getHTML()).toContain('href="https://example.com"');

    editor.destroy();
  });

  it('keeps explicit vscode:// markdown links, which never depended on linkify', async () => {
    const editor = createEditorLikeProduction();
    await flushCreate();

    editor.commands.setContent(`[label](${VSCODE_URL})`, { contentType: 'markdown' } as never);
    expect(editor.getHTML()).toContain(`href="${VSCODE_URL}"`);

    editor.destroy();
  });

  it('still refuses javascript: hrefs', async () => {
    const editor = createEditorLikeProduction();
    await flushCreate();

    editor.commands.setContent('[evil](javascript:alert(1))', { contentType: 'markdown' } as never);
    expect(editor.getHTML()).not.toContain('href="javascript:');

    editor.destroy();
  });

  it('re-registers after the schemes are cleared, so a later editor still works', async () => {
    // Link.onDestroy calls linkify's reset(), which drops the custom schemes.
    const first = createEditorLikeProduction();
    await flushCreate();
    first.destroy();

    const second = createEditorLikeProduction();
    await flushCreate();
    expect(find(VSCODE_URL)).toHaveLength(1);

    second.destroy();
  });
});
