/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

/**
 * Reclaim markdown files that other extensions open as plain text.
 *
 * `workbench.editorAssociations` is honored by the Explorer, Quick Open and
 * `vscode.open` — everything that routes through VS Code's editor resolver.
 * It is *not* honored by `window.showTextDocument(uri)`, which is documented to
 * open the resource in a text editor and can never resolve a custom editor.
 * Any extension using that API therefore bypasses the user's stated preference
 * and drops them into raw markdown (AI chat sidebars linking to `file.md#L42`
 * are the common case).
 *
 * VS Code offers no hook to veto or redirect another extension's
 * `showTextDocument`, so the only available mechanism is to notice the text tab
 * after it appears and reopen the document rendered. The cost is a brief flash
 * of the text editor; the alternative is no feature at all.
 *
 * Two things keep this from being intrusive:
 *
 * 1. `auto` mode reclaims only when the user's own settings already name this
 *    editor as their markdown default, so an install that never opted in is
 *    unaffected.
 * 2. Deliberate source views register an *intent* first, so the feature can
 *    never fight this extension's own "show me the raw markdown" paths.
 */

import * as vscode from 'vscode';
import { openRenderedMarkdown } from '../activeWebview';

export const MARKDOWN_VIEW_TYPE = 'markdownForHumans.editor';

export type ReclaimMode = 'auto' | 'always' | 'never';

const CONFIG_KEY = 'markdownForHumans.reclaimTextEditors';
const ASSOCIATIONS_KEY = 'workbench.editorAssociations';

/**
 * How long to wait after a text tab appears before swapping it.
 *
 * `showTextDocument()` resolves *before* its caller applies `revealRange`, so
 * reading the cursor immediately would race and almost always yield line 1 —
 * losing the `#L42` the user clicked. This delay lets the opener finish
 * positioning, and overlaps the rendered editor's own startup.
 */
const RECLAIM_DELAY_MS = 150;

/** Window during which a URI will not be reclaimed again, to prevent ping-pong. */
const RECLAIM_COOLDOWN_MS = 1000;

const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];

/**
 * Association patterns that mean "markdown generally", as opposed to markdown
 * in one folder or on one scheme. Deliberately an exact list rather than a glob
 * engine: the question being answered is a single boolean, and reimplementing
 * VS Code's resolver semantics approximately would be more code and still wrong
 * at the edges. `always` is the escape hatch for exotic associations.
 */
const UNSCOPED_MARKDOWN_PATTERNS = new Set(['*.md', '*.markdown', '**/*.md', '**/*.markdown']);

/** URIs the user deliberately asked to see as source; see {@link markSourceViewIntent}. */
const sourceViewIntents = new Set<string>();

/** URIs reclaimed within the last {@link RECLAIM_COOLDOWN_MS}. */
const recentlyReclaimed = new Set<string>();

interface UriLike {
  scheme: string;
  path: string;
  toString(): string;
}

function key(uri: UriLike): string {
  return uri.toString();
}

export function isUnscopedMarkdownPattern(pattern: string): boolean {
  return UNSCOPED_MARKDOWN_PATTERNS.has(pattern.trim());
}

/**
 * Has the user declared this extension their default markdown editor?
 *
 * True when any unscoped markdown pattern in `workbench.editorAssociations`
 * maps to our view type. A `{git}:`-prefixed or folder-scoped entry is not a
 * general default and does not count; entries pointing elsewhere (typically
 * `"{git}:/**\/*.md": "default"`, which keeps diffs readable) are irrelevant to
 * this question and are handled by the scheme guard instead.
 */
export function isDefaultMarkdownEditor(associations?: Record<string, string>): boolean {
  if (!associations) {
    return false;
  }
  return Object.entries(associations).some(
    ([pattern, viewType]) => viewType === MARKDOWN_VIEW_TYPE && isUnscopedMarkdownPattern(pattern)
  );
}

/** Is this a document we could reclaim at all? File-scheme markdown only. */
export function isReclaimableMarkdownUri(uri: { scheme: string; path: string }): boolean {
  if (uri.scheme !== 'file') {
    return false;
  }
  const lower = uri.path.toLowerCase();
  return MARKDOWN_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export function resolveReclaimEnabled(
  mode: ReclaimMode,
  associations?: Record<string, string>
): boolean {
  if (mode === 'never') {
    return false;
  }
  if (mode === 'always') {
    return true;
  }
  return isDefaultMarkdownEditor(associations);
}

/**
 * Record that a source (raw text) view of this document was deliberately
 * requested, so the watcher stands down for it.
 *
 * The intent lives until the text tab closes rather than for a fixed window: a
 * timer would race with the editor opening, and would still fight the user the
 * second time they focused the source tab.
 */
export function markSourceViewIntent(uri: UriLike): void {
  sourceViewIntents.add(key(uri));
}

export function hasSourceViewIntent(uri: UriLike): boolean {
  return sourceViewIntents.has(key(uri));
}

export function clearSourceViewIntent(uri: UriLike): void {
  sourceViewIntents.delete(key(uri));
}

/** Test seam — drops all intents and cooldowns. */
export function clearAllReclaimState(): void {
  sourceViewIntents.clear();
  recentlyReclaimed.clear();
}

function currentMode(): ReclaimMode {
  return vscode.workspace.getConfiguration().get<ReclaimMode>(CONFIG_KEY, 'auto');
}

function currentAssociations(): Record<string, string> | undefined {
  return vscode.workspace.getConfiguration().get<Record<string, string>>(ASSOCIATIONS_KEY);
}

/** The URI of a tab that is a *plain text* editor, or undefined for anything else. */
function plainTextUriOf(tab: vscode.Tab): UriLike | undefined {
  // Diff tabs (TabInputTextDiff), custom editors (TabInputCustom — including
  // our own, which is what makes reentrancy impossible), notebooks and
  // webviews all fail this check structurally rather than by heuristic.
  if (tab.input instanceof vscode.TabInputText) {
    return tab.input.uri;
  }
  return undefined;
}

/** The 1-based cursor line for a URI, if it is showing in a visible text editor. */
function cursorLineOf(uri: UriLike): number | undefined {
  const editor = vscode.window.visibleTextEditors.find(
    candidate => candidate.document.uri.toString() === uri.toString()
  );
  if (!editor) {
    return undefined;
  }
  const line = editor.selection.active.line + 1;
  // Line 1 is where the rendered view lands anyway — no need for a reveal.
  return line > 1 ? line : undefined;
}

function markReclaimed(uriKey: string): void {
  recentlyReclaimed.add(uriKey);
  setTimeout(() => recentlyReclaimed.delete(uriKey), RECLAIM_COOLDOWN_MS);
}

async function considerReclaim(tab: vscode.Tab, uri: UriLike): Promise<void> {
  if (!isReclaimableMarkdownUri(uri)) {
    return;
  }
  // Unsaved raw edits are a signal the user wants the text editor, and closing
  // the tab would prompt to save.
  if (tab.isDirty) {
    return;
  }
  if (hasSourceViewIntent(uri)) {
    return;
  }
  if (!resolveReclaimEnabled(currentMode(), currentAssociations())) {
    return;
  }

  const uriKey = key(uri);
  if (recentlyReclaimed.has(uriKey)) {
    return;
  }
  markReclaimed(uriKey);

  await new Promise(resolve => setTimeout(resolve, RECLAIM_DELAY_MS));

  // The world may have moved while we waited.
  if (tab.isDirty || hasSourceViewIntent(uri)) {
    return;
  }

  try {
    const line = cursorLineOf(uri);
    await openRenderedMarkdown(uri as vscode.Uri, line !== undefined ? { line } : undefined);
  } catch (error) {
    // Leave the text editor in place — this must never be able to lose a file
    // or trap the user in a half-swapped state.
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[MD4H] Could not reclaim markdown editor:', message);
    return;
  }

  try {
    await vscode.window.tabGroups.close(tab);
  } catch {
    // The tab was already replaced or closed; nothing to do.
  }
}

/**
 * Reclaim the tab that is already focused at activation time.
 *
 * The contributed activation events (`onCustomEditor`, `onCommand`, `onView`)
 * do not fire when another extension opens markdown as plain text, so
 * `onLanguage:markdown` is declared to cover that case — but activation is
 * asynchronous, and the tab-open event can fire before this listener is
 * registered. Sweeping the focused tab once closes that race deterministically.
 *
 * Scoped to the active tab of the active group on purpose: that is where a
 * just-clicked link lands, and a wider sweep would rewrite background tabs
 * restored from a previous session.
 */
function sweepActiveTab(): void {
  const tab = vscode.window.tabGroups.activeTabGroup?.activeTab;
  if (!tab) {
    return;
  }
  const uri = plainTextUriOf(tab);
  if (uri) {
    void considerReclaim(tab, uri);
  }
}

/**
 * Start watching for markdown opened as plain text. Returns nothing; the
 * listener is pushed onto the extension's subscriptions.
 */
export function activateReclaimTextEditors(context: vscode.ExtensionContext): void {
  sweepActiveTab();

  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(event => {
      // A closed source tab means the user is done with the raw view.
      for (const tab of event.closed) {
        const uri = plainTextUriOf(tab);
        if (uri) {
          clearSourceViewIntent(uri);
        }
      }

      for (const tab of event.opened) {
        const uri = plainTextUriOf(tab);
        if (uri) {
          void considerReclaim(tab, uri);
        }
      }
    })
  );
}
