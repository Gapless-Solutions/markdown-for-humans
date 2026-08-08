import * as vscode from 'vscode';
import { Position } from 'vscode';
import { MarkdownEditorProvider } from '../../editor/MarkdownEditorProvider';

/**
 * Regression: intermittently blank editor on load.
 *
 * A webview that posts 'ready' is empty by definition, but updateWebview's
 * lastWebviewContent dedupe could still hold the document's current content
 * when the webview was recreated (tab moved between editor groups, fast
 * close/reopen where the old panel's dispose fires after the new resolve).
 * The update was then skipped and the editor stayed blank until the document
 * changed. 'ready' must always result in an 'update' message.
 */

function createDocument(content: string, uri = 'file://test.md') {
  return {
    getText: jest.fn(() => content),
    uri: { toString: () => uri },
    positionAt: jest.fn((offset: number) => new Position(0, offset)),
  };
}

type ProviderInternals = {
  lastWebviewContent: Map<string, string>;
  pendingEdits: Map<string, number>;
  handleWebviewMessage: (
    message: { type: string },
    document: unknown,
    webview: { postMessage: jest.Mock }
  ) => void;
};

function readyMessageUpdates(webview: { postMessage: jest.Mock }) {
  return webview.postMessage.mock.calls
    .map(call => call[0] as { type: string; content?: string })
    .filter(message => message.type === 'update');
}

describe('webview ready refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('re-sends content on ready even when the dedupe cache matches', () => {
    const provider = new MarkdownEditorProvider({} as unknown as vscode.ExtensionContext);
    const document = createDocument('hello world\n');
    const webview = { postMessage: jest.fn() };
    const internals = provider as unknown as ProviderInternals;

    // Simulate a recreated webview: cache already holds the current content.
    internals.lastWebviewContent.set(document.uri.toString(), 'hello world\n');

    internals.handleWebviewMessage({ type: 'ready' }, document, webview);

    const updates = readyMessageUpdates(webview);
    expect(updates).toHaveLength(1);
    expect(updates[0].content).toBe('hello world\n');
  });

  it('ignores a stale recent-edit suppression from a previous webview instance', () => {
    const provider = new MarkdownEditorProvider({} as unknown as vscode.ExtensionContext);
    const document = createDocument('fresh text\n');
    const webview = { postMessage: jest.fn() };
    const internals = provider as unknown as ProviderInternals;

    internals.pendingEdits.set(document.uri.toString(), Date.now());

    internals.handleWebviewMessage({ type: 'ready' }, document, webview);

    const updates = readyMessageUpdates(webview);
    expect(updates).toHaveLength(1);
    expect(updates[0].content).toBe('fresh text\n');
  });
});
