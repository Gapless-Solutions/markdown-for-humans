/**
 * Reclaim Text Editors Feature Tests
 *
 * Covers the pure policy helpers (association check, URI eligibility, mode
 * resolution), the source-view intent registry, and the tab watcher itself
 * driven through the mocked `window.tabGroups` API.
 *
 * Every guard is tested from both sides — the reclaim that should happen and
 * the reclaim that must not — because the failure mode that matters here is
 * taking over an editor the user deliberately asked for.
 */

import {
  MARKDOWN_VIEW_TYPE,
  isUnscopedMarkdownPattern,
  isDefaultMarkdownEditor,
  isReclaimableMarkdownUri,
  resolveReclaimEnabled,
  markSourceViewIntent,
  hasSourceViewIntent,
  clearSourceViewIntent,
  clearAllReclaimState,
  activateReclaimTextEditors,
} from '../../features/reclaimTextEditors';
import {
  window,
  workspace,
  TabInputText,
  TabInputCustom,
  TabInputTextDiff,
  Selection,
  resetAllMocks,
} from '../../__mocks__/vscode';
import { openRenderedMarkdown } from '../../activeWebview';

jest.mock('../../activeWebview', () => ({
  openRenderedMarkdown: jest.fn(async () => undefined),
}));

const mockOpenRendered = openRenderedMarkdown as jest.MockedFunction<typeof openRenderedMarkdown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fileUri(path: string): any {
  return { fsPath: path, path, scheme: 'file', toString: () => `file://${path}` };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeTab(input: unknown, isDirty = false): any {
  return { input, isDirty, label: 'tab' };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeContext(): any {
  return { subscriptions: [] };
}

/** Point `workspace.getConfiguration()` at a specific settings snapshot. */
function setConfig(settings: Record<string, unknown>) {
  (workspace.getConfiguration as jest.Mock).mockReturnValue({
    get: jest.fn((key: string, defaultValue?: unknown) =>
      key in settings ? settings[key] : defaultValue
    ),
    update: jest.fn(),
  });
}

describe('isUnscopedMarkdownPattern', () => {
  it.each(['*.md', '*.markdown', '**/*.md', '**/*.markdown'])(
    'accepts the unscoped pattern %s',
    pattern => {
      expect(isUnscopedMarkdownPattern(pattern)).toBe(true);
    }
  );

  it('tolerates surrounding whitespace', () => {
    expect(isUnscopedMarkdownPattern('  *.md  ')).toBe(true);
  });

  it('rejects a scheme-prefixed pattern', () => {
    // The common `{git}:` entry is about diffs, not about the default editor.
    expect(isUnscopedMarkdownPattern('{git}:/**/*.md')).toBe(false);
  });

  it('rejects a folder-scoped pattern', () => {
    // "markdown in docs/" is not "markdown generally".
    expect(isUnscopedMarkdownPattern('docs/*.md')).toBe(false);
  });

  it('rejects a non-markdown pattern', () => {
    expect(isUnscopedMarkdownPattern('*.txt')).toBe(false);
  });
});

describe('isDefaultMarkdownEditor', () => {
  it('is true when an unscoped pattern maps to this editor', () => {
    expect(isDefaultMarkdownEditor({ '*.md': MARKDOWN_VIEW_TYPE })).toBe(true);
  });

  it('is true alongside an unrelated git-scheme override', () => {
    expect(
      isDefaultMarkdownEditor({
        '{git}:/**/*.md': 'default',
        '*.md': MARKDOWN_VIEW_TYPE,
      })
    ).toBe(true);
  });

  it('is false when markdown is associated with the default text editor', () => {
    expect(isDefaultMarkdownEditor({ '*.md': 'default' })).toBe(false);
  });

  it('is false when the association is folder-scoped', () => {
    expect(isDefaultMarkdownEditor({ 'docs/*.md': MARKDOWN_VIEW_TYPE })).toBe(false);
  });

  it('is false for an empty or missing association map', () => {
    expect(isDefaultMarkdownEditor({})).toBe(false);
    expect(isDefaultMarkdownEditor(undefined)).toBe(false);
  });
});

describe('isReclaimableMarkdownUri', () => {
  it('accepts a .md file on the file scheme', () => {
    expect(isReclaimableMarkdownUri(fileUri('/notes/todo.md'))).toBe(true);
  });

  it('accepts .markdown and is case-insensitive', () => {
    expect(isReclaimableMarkdownUri(fileUri('/notes/README.MARKDOWN'))).toBe(true);
  });

  it('rejects a non-file scheme', () => {
    expect(isReclaimableMarkdownUri({ scheme: 'git', path: '/notes/todo.md' })).toBe(false);
    expect(isReclaimableMarkdownUri({ scheme: 'untitled', path: '/notes/todo.md' })).toBe(false);
  });

  it('rejects a non-markdown extension', () => {
    expect(isReclaimableMarkdownUri(fileUri('/notes/todo.txt'))).toBe(false);
  });
});

describe('resolveReclaimEnabled', () => {
  const owned = { '*.md': MARKDOWN_VIEW_TYPE };

  it('never disables regardless of association', () => {
    expect(resolveReclaimEnabled('never', owned)).toBe(false);
  });

  it('always enables regardless of association', () => {
    expect(resolveReclaimEnabled('always', {})).toBe(true);
  });

  it('auto follows the association', () => {
    expect(resolveReclaimEnabled('auto', owned)).toBe(true);
    expect(resolveReclaimEnabled('auto', {})).toBe(false);
  });
});

describe('source view intent registry', () => {
  beforeEach(() => clearAllReclaimState());

  it('records and reports an intent for a URI', () => {
    const uri = fileUri('/notes/todo.md');
    expect(hasSourceViewIntent(uri)).toBe(false);
    markSourceViewIntent(uri);
    expect(hasSourceViewIntent(uri)).toBe(true);
  });

  it('keeps intents per URI', () => {
    markSourceViewIntent(fileUri('/a.md'));
    expect(hasSourceViewIntent(fileUri('/b.md'))).toBe(false);
  });

  it('clears an intent', () => {
    const uri = fileUri('/notes/todo.md');
    markSourceViewIntent(uri);
    clearSourceViewIntent(uri);
    expect(hasSourceViewIntent(uri)).toBe(false);
  });
});

describe('activateReclaimTextEditors', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fireTabs: (e: any) => void;

  beforeEach(() => {
    resetAllMocks();
    clearAllReclaimState();
    mockOpenRendered.mockClear();
    jest.useFakeTimers();

    (window.tabGroups.onDidChangeTabs as jest.Mock).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cb: (e: any) => void) => {
        fireTabs = cb;
        return { dispose: jest.fn() };
      }
    );

    setConfig({
      'markdownForHumans.reclaimTextEditors': 'auto',
      'workbench.editorAssociations': { '*.md': MARKDOWN_VIEW_TYPE },
    });
    window.visibleTextEditors = [];

    activateReclaimTextEditors(makeContext());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function openTab(tab: any) {
    fireTabs({ opened: [tab], closed: [], changed: [] });
    await jest.advanceTimersByTimeAsync(500);
  }

  it('reclaims a markdown file opened in a plain text tab', async () => {
    const uri = fileUri('/notes/todo.md');
    const tab = makeTab(new TabInputText(uri));

    await openTab(tab);

    expect(mockOpenRendered).toHaveBeenCalledTimes(1);
    expect(mockOpenRendered.mock.calls[0][0]).toBe(uri);
    expect(window.tabGroups.close).toHaveBeenCalledWith(tab);
  });

  it('carries the cursor line across the swap', async () => {
    const uri = fileUri('/notes/todo.md');
    // The opener placed the cursor on 0-based line 41 (i.e. #L42).
    window.visibleTextEditors = [
      {
        document: { uri },
        selection: new Selection({ line: 41, character: 0 }, { line: 41, character: 0 }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;

    await openTab(makeTab(new TabInputText(uri)));

    expect(mockOpenRendered).toHaveBeenCalledWith(uri, { line: 42 });
  });

  it('does not pass a reveal target when the cursor is at the top', async () => {
    const uri = fileUri('/notes/todo.md');
    window.visibleTextEditors = [
      {
        document: { uri },
        selection: new Selection({ line: 0, character: 0 }, { line: 0, character: 0 }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;

    await openTab(makeTab(new TabInputText(uri)));

    expect(mockOpenRendered).toHaveBeenCalledWith(uri, undefined);
  });

  it('ignores a diff tab', async () => {
    const uri = fileUri('/notes/todo.md');
    await openTab(makeTab(new TabInputTextDiff(uri, uri)));
    expect(mockOpenRendered).not.toHaveBeenCalled();
  });

  it('ignores a tab that is already a custom editor', async () => {
    const uri = fileUri('/notes/todo.md');
    await openTab(makeTab(new TabInputCustom(uri, MARKDOWN_VIEW_TYPE)));
    expect(mockOpenRendered).not.toHaveBeenCalled();
  });

  it('ignores a non-file scheme', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gitUri: any = { scheme: 'git', path: '/notes/todo.md', toString: () => 'git:/todo.md' };
    await openTab(makeTab(new TabInputText(gitUri)));
    expect(mockOpenRendered).not.toHaveBeenCalled();
  });

  it('ignores a non-markdown file', async () => {
    await openTab(makeTab(new TabInputText(fileUri('/notes/todo.txt'))));
    expect(mockOpenRendered).not.toHaveBeenCalled();
  });

  it('ignores a dirty document', async () => {
    // Unsaved raw edits are a signal the user wants the text editor, and
    // closing the tab would prompt to save.
    await openTab(makeTab(new TabInputText(fileUri('/notes/todo.md')), true));
    expect(mockOpenRendered).not.toHaveBeenCalled();
  });

  it('stands down when a source view was deliberately requested', async () => {
    const uri = fileUri('/notes/todo.md');
    markSourceViewIntent(uri);
    await openTab(makeTab(new TabInputText(uri)));
    expect(mockOpenRendered).not.toHaveBeenCalled();
  });

  it('clears the intent when the source tab closes', async () => {
    const uri = fileUri('/notes/todo.md');
    markSourceViewIntent(uri);

    fireTabs({ opened: [], closed: [makeTab(new TabInputText(uri))], changed: [] });

    expect(hasSourceViewIntent(uri)).toBe(false);
  });

  it('does nothing when the mode is never', async () => {
    setConfig({
      'markdownForHumans.reclaimTextEditors': 'never',
      'workbench.editorAssociations': { '*.md': MARKDOWN_VIEW_TYPE },
    });
    await openTab(makeTab(new TabInputText(fileUri('/notes/todo.md'))));
    expect(mockOpenRendered).not.toHaveBeenCalled();
  });

  it('does nothing in auto when the user has not made this the default editor', async () => {
    setConfig({
      'markdownForHumans.reclaimTextEditors': 'auto',
      'workbench.editorAssociations': {},
    });
    await openTab(makeTab(new TabInputText(fileUri('/notes/todo.md'))));
    expect(mockOpenRendered).not.toHaveBeenCalled();
  });

  it('reclaims in always mode even without an association', async () => {
    setConfig({
      'markdownForHumans.reclaimTextEditors': 'always',
      'workbench.editorAssociations': {},
    });
    await openTab(makeTab(new TabInputText(fileUri('/notes/todo.md'))));
    expect(mockOpenRendered).toHaveBeenCalledTimes(1);
  });

  it('does not reclaim the same URI twice in quick succession', async () => {
    const uri = fileUri('/notes/todo.md');
    await openTab(makeTab(new TabInputText(uri)));
    await openTab(makeTab(new TabInputText(uri)));
    expect(mockOpenRendered).toHaveBeenCalledTimes(1);
  });

  describe('activation-time sweep', () => {
    // Activation is async relative to the tab-open event, so the tab that is
    // already focused when the extension wakes up has to be handled directly.
    async function activateWithActiveTab(tab: unknown) {
      clearAllReclaimState();
      mockOpenRendered.mockClear();
      window.tabGroups.activeTabGroup = { activeTab: tab };
      activateReclaimTextEditors(makeContext());
      await jest.advanceTimersByTimeAsync(500);
    }

    it('reclaims a plain text markdown tab that is already focused', async () => {
      const uri = fileUri('/notes/todo.md');
      await activateWithActiveTab(makeTab(new TabInputText(uri)));
      expect(mockOpenRendered).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the focused tab is already a custom editor', async () => {
      const uri = fileUri('/notes/todo.md');
      await activateWithActiveTab(makeTab(new TabInputCustom(uri, MARKDOWN_VIEW_TYPE)));
      expect(mockOpenRendered).not.toHaveBeenCalled();
    });

    it('does nothing when there is no active tab', async () => {
      await activateWithActiveTab(undefined);
      expect(mockOpenRendered).not.toHaveBeenCalled();
    });
  });

  it('leaves the text editor in place when reopening fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockOpenRendered.mockRejectedValueOnce(new Error('boom'));
    const tab = makeTab(new TabInputText(fileUri('/notes/todo.md')));

    await openTab(tab);

    expect(window.tabGroups.close).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
