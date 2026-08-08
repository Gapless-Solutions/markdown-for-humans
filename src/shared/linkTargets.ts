/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

/**
 * Parsing for file-link targets that carry a position:
 *
 *   docs/a.md#L42        GitHub-style line anchor (also #L42-L50 ranges)
 *   docs/a.md#heading    heading slug (markdown targets only)
 *   src/app.ts:42        editor-style line suffix (also :42:7 with column)
 *   vscode://file/c:/x/settings.json:79   the editor's own file protocol
 *
 * A Windows drive colon (`c:/…`) is never mistaken for a line suffix.
 */

export interface FileLinkTarget {
  path: string;
  line?: number;
  column?: number;
  slug?: string;
}

const LINE_ANCHOR = /^L(\d+)(?:-L?\d+)?$/i;
const LINE_SUFFIX = /^(.*?):(\d+)(?::(\d+))?$/;

/** Strip a trailing `:line(:column)` suffix, protecting the drive colon. */
function splitLineSuffix(path: string): { path: string; line?: number; column?: number } {
  const match = LINE_SUFFIX.exec(path);
  if (!match) return { path };
  const base = match[1];
  // `c:` alone (or empty) before the colon means we matched the drive colon
  // of something like `c:/…` — not a line suffix.
  if (base.length <= 1) return { path };
  const line = parseInt(match[2], 10);
  if (!Number.isFinite(line) || line < 1) return { path };
  const column = match[3] ? parseInt(match[3], 10) : undefined;
  return { path: base, line, column };
}

/**
 * Split a markdown link href into its filesystem path and position parts.
 * The href must already be classified as a file link (no scheme).
 */
export function parseFileLinkHref(href: string): FileLinkTarget {
  let path = href;
  let line: number | undefined;
  let column: number | undefined;
  let slug: string | undefined;

  const hashIndex = path.indexOf('#');
  if (hashIndex >= 0) {
    const fragment = path.slice(hashIndex + 1);
    path = path.slice(0, hashIndex);
    const anchorMatch = LINE_ANCHOR.exec(fragment);
    if (anchorMatch) {
      line = parseInt(anchorMatch[1], 10);
    } else if (fragment.length > 0) {
      try {
        slug = decodeURIComponent(fragment);
      } catch {
        slug = fragment;
      }
    }
  }

  if (line === undefined) {
    const suffix = splitLineSuffix(path);
    path = suffix.path;
    line = suffix.line;
    column = suffix.column;
  }

  return { path, line, column, slug };
}

const VSCODE_FILE_URL = /^vscode(?:-insiders)?:\/\/file\/(.+)$/i;

/**
 * Parse a `vscode://file/<path>(:line(:column))` URL into a local target.
 * Returns null for anything else (other schemes, other vscode authorities),
 * so callers can fall back to `vscode.env.openExternal`.
 */
export function parseVsCodeFileUrl(url: string): FileLinkTarget | null {
  const match = VSCODE_FILE_URL.exec(url);
  if (!match) return null;

  let rest: string;
  try {
    rest = decodeURIComponent(match[1]);
  } catch {
    rest = match[1];
  }

  // Normalize `/c:/…` (URL path form) to `c:/…`.
  if (/^\/[a-zA-Z]:/.test(rest)) {
    rest = rest.slice(1);
  }

  const { path, line, column } = splitLineSuffix(rest);
  if (!path) return null;
  return { path, line, column };
}
