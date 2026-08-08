/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

/**
 * Shared link-scheme policy for the webview link dispatcher and the
 * extension-host external-link handler.
 *
 * The webview routes ANY scheme-qualified URL to the host's external-link
 * channel; the host then enforces this allowlist. `vscode:`/`vscode-insiders:`
 * are included because `vscode.env.openExternal` handles the editor's own
 * protocol natively — `vscode://file/<path>:<line>` opens the file at the
 * line in the running window. Dangerous script-ish schemes (`javascript:`,
 * `data:`) are excluded by not being listed.
 */
export const ALLOWED_EXTERNAL_LINK_SCHEMES = new Set([
  'http',
  'https',
  'mailto',
  'vscode',
  'vscode-insiders',
]);

/**
 * Extract a URL's scheme, or null when the string has none. A Windows drive
 * prefix (`c:/`, `C:\`) is NOT a scheme — single-letter "schemes" followed by
 * a path separator are treated as local paths.
 */
export function getUrlScheme(url: string): string | null {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  if (!match) return null;
  const scheme = match[1];
  if (scheme.length === 1 && /^[a-zA-Z]:[\\/]/.test(url)) return null;
  return scheme.toLowerCase();
}

/** Whether the host may hand this URL to `vscode.env.openExternal`. */
export function isAllowedExternalUrl(url: string): boolean {
  const scheme = getUrlScheme(url);
  return scheme !== null && ALLOWED_EXTERNAL_LINK_SCHEMES.has(scheme);
}
