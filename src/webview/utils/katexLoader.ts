/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import type katexModule from 'katex';

type Katex = typeof katexModule;

/**
 * KaTeX is a fifth of the webview's startup code and only documents with math
 * need it, so it is fetched on the first math render rather than at load.
 * Once loaded, `getKatex()` returns it synchronously so re-renders never flash.
 */
let katex: Katex | null = null;
let loading: Promise<Katex> | null = null;

export function getKatex(): Katex | null {
  return katex;
}

export function loadKatex(): Promise<Katex> {
  if (!loading) {
    loading = import('katex').then(m => {
      katex = (m.default ?? m) as Katex;
      return katex;
    });
    // A failed chunk load must not poison every later render.
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}
