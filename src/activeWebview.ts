/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import * as vscode from 'vscode';

let activeWebviewPanel: vscode.WebviewPanel | undefined;
let activeWebviewDocument: vscode.TextDocument | undefined;

const activeChangeEmitter = new vscode.EventEmitter<void>();
export const onDidChangeActiveWebview = activeChangeEmitter.event;

function setActiveContext(isActive: boolean) {
  vscode.commands.executeCommand('setContext', 'markdownForHumans.isActive', isActive);
}

export function setActiveWebviewPanel(
  panel: vscode.WebviewPanel | undefined,
  document?: vscode.TextDocument
) {
  activeWebviewPanel = panel;
  activeWebviewDocument = panel ? document : undefined;
  setActiveContext(!!panel);
  activeChangeEmitter.fire();
}

export function getActiveWebviewPanel(): vscode.WebviewPanel | undefined {
  return activeWebviewPanel;
}

export function getActiveWebviewDocument(): vscode.TextDocument | undefined {
  return activeWebviewDocument;
}

/**
 * One-shot "reveal this position once the rendered editor is up" queue, used
 * when opening a markdown document in the rendered view at a specific spot
 * (Open in Rendered View at Cursor, links with #L42 / :42 / #heading
 * targets). Keyed by document URI string. Consumed either by the provider's
 * 'ready' handler (freshly opened webview) or by the opener's timeout
 * fallback for an already-open webview.
 */
export interface RevealTarget {
  line?: number;
  slug?: string;
}

const pendingReveals = new Map<string, RevealTarget>();

export function queuePendingReveal(uriKey: string, target: RevealTarget): void {
  pendingReveals.set(uriKey, target);
}

export function takePendingReveal(uriKey: string): RevealTarget | undefined {
  const target = pendingReveals.get(uriKey);
  pendingReveals.delete(uriKey);
  return target;
}

/**
 * Open a markdown document in the rendered (Markdown for Humans) editor,
 * optionally revealing a line or heading slug. The reveal is queued because a
 * freshly opened webview can only act on it after its 'ready' handshake; the
 * timeout fallback delivers it to an already-open webview.
 */
export async function openRenderedMarkdown(uri: vscode.Uri, target?: RevealTarget): Promise<void> {
  const uriKey = uri.toString();
  const hasTarget = !!target && (target.line !== undefined || target.slug !== undefined);
  if (hasTarget) {
    queuePendingReveal(uriKey, target);
  }
  await vscode.commands.executeCommand('vscode.openWith', uri, 'markdownForHumans.editor');
  if (hasTarget) {
    setTimeout(() => {
      const pending = takePendingReveal(uriKey);
      const panel = getActiveWebviewPanel();
      if (pending && panel) {
        panel.webview.postMessage({ type: 'revealTarget', ...pending });
      }
    }, 300);
  }
}
