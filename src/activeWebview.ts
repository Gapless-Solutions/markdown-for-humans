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
 * One-shot "reveal this line once the rendered editor is up" queue, used by
 * the Open in Rendered View at Cursor command. Keyed by document URI string.
 * Consumed either by the provider's 'ready' handler (freshly opened webview)
 * or by the command's own fallback for an already-open webview.
 */
const pendingReveals = new Map<string, number>();

export function queuePendingReveal(uriKey: string, line: number): void {
  pendingReveals.set(uriKey, line);
}

export function takePendingReveal(uriKey: string): number | undefined {
  const line = pendingReveals.get(uriKey);
  pendingReveals.delete(uriKey);
  return line;
}
