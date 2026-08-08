/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import { getUrlScheme } from '../../shared/linkSchemes';

/**
 * Classify a clicked link's href for the webview dispatcher.
 *
 * - `external`: any scheme-qualified URL (`https:`, `mailto:`, `vscode:`, …).
 *   The extension host enforces which schemes actually open — the webview
 *   only routes. A Windows drive path (`c:/notes.md`) is NOT a scheme.
 * - `anchor`: in-document heading link (`#slug`).
 * - `image`: local image path, opened in VS Code's image preview.
 * - `file`: any other local path, resolved by the host.
 */
export type LinkKind = 'external' | 'anchor' | 'image' | 'file';

const IMAGE_PATTERN = /\.(png|jpe?g|gif|svg|webp|bmp|ico|tiff?)$/i;

export function classifyLinkHref(href: string): LinkKind {
  if (href.startsWith('#')) return 'anchor';
  if (getUrlScheme(href) !== null) return 'external';
  if (IMAGE_PATTERN.test(href)) return 'image';
  return 'file';
}
