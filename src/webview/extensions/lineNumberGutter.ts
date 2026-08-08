/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 *
 * @fileoverview Optional left gutter showing each top-level block's start line in
 * the saved markdown file, so the rendered view can be cross-referenced with the
 * raw source, diagnostics, or `@file#42` style AI references.
 *
 * Granularity is deliberately per-block, not per visual line: a soft-wrapped
 * paragraph occupies one source line but many visual lines, and serialization
 * (list markers, code fences) shifts columns. Block start lines are exact; a
 * finer gutter would routinely lie.
 *
 * The numbers come from the same math as Copy as AI Context
 * (`computeBlockLineRanges`), which mirrors `getEditorMarkdownForSync` — so a
 * number in the gutter is the line the block occupies once the file is saved.
 *
 * Cost: the math serializes every block, so it never runs on the typing path —
 * edits mark the numbers stale and a debounced recompute dispatches the new
 * decorations. Between the edit and the recompute the existing decorations are
 * mapped through the transactions, so they stay attached to their blocks.
 */

import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { BlankLineMode } from '../../shared/blankLinePolicy';
import { computeBlockLineRanges, resolveMarkdownSerialize } from '../utils/aiContextReference';

/** Class put on the editable element while the gutter is on (reserves the margin). */
export const GUTTER_ACTIVE_CLASS = 'md-line-numbers';
/** Class put on every numbered block; the number itself is a CSS `::before`. */
export const GUTTER_BLOCK_CLASS = 'md-line-number-block';
/** Attribute carrying the number — read by CSS via `content: attr(...)`. */
export const GUTTER_LINE_ATTR = 'data-source-line';

const DEFAULT_DEBOUNCE_MS = 200;

export interface LineNumberGutterOptions {
  /** Initial enabled state; toggled at runtime via `setLineNumbersEnabled`. */
  enabled: boolean;
  /**
   * Read the live blank-line policy. Blank-line mode changes the saved file's
   * line count, so the gutter has to follow the same setting the saver uses.
   */
  getBlankLineMode: () => BlankLineMode;
  /** Quiet period after the last edit before the numbers are recomputed. */
  debounceMs: number;
}

interface LineNumberGutterState {
  enabled: boolean;
  decorations: DecorationSet;
}

interface LineNumberGutterMeta {
  enabled?: boolean;
  /** Block index → start line. `null` clears the gutter (nothing mappable). */
  lines?: Map<number, number> | null;
}

interface LineNumberGutterStorage {
  getBlankLineMode: () => BlankLineMode;
  debounceMs: number;
}

declare module '@tiptap/core' {
  interface Storage {
    lineNumberGutter: LineNumberGutterStorage;
  }
}

export const lineNumberGutterPluginKey = new PluginKey<LineNumberGutterState>('lineNumberGutter');

/**
 * Map each top-level block index to its start line in the saved file.
 *
 * Returns null when the document cannot be mapped at all (no serializer, empty
 * doc, or a JSON/doc shape mismatch that would make the indices lie). Blocks
 * that carry no content — empty paragraphs standing in for blank lines — are
 * simply absent from the map: there is no source line to point at.
 */
export function computeGutterLineNumbers(
  editor: Editor,
  blankLineMode: BlankLineMode
): Map<number, number> | null {
  const serialize = resolveMarkdownSerialize(editor);
  if (!serialize || typeof editor.getJSON !== 'function') return null;

  const liveJson = editor.getJSON();
  const content = liveJson.content;
  if (!Array.isArray(content) || content.length === 0) return null;
  // The JSON children must align 1:1 with the doc's top-level nodes, otherwise
  // `jsonIdx` would address the wrong block and every number would be wrong.
  if (content.length !== editor.state.doc.childCount) return null;

  try {
    const ranges = computeBlockLineRanges(content, serialize, blankLineMode);
    const lines = new Map<number, number>();
    for (const range of ranges) {
      lines.set(range.jsonIdx, range.startLine);
    }
    return lines;
  } catch (error) {
    console.warn('[MD4H][lineNumbers] Failed to compute source lines:', error);
    return null;
  }
}

/**
 * Turn a block-index → line map into node decorations on the matching blocks.
 * Indices with no entry are skipped, so an unmappable block shows no number
 * rather than a wrong one.
 */
export function buildGutterDecorations(
  doc: ProseMirrorNode,
  lines: Map<number, number>
): DecorationSet {
  const decorations: Decoration[] = [];
  let index = 0;
  doc.forEach((node, offset) => {
    const line = lines.get(index);
    index++;
    if (typeof line !== 'number') return;
    decorations.push(
      Decoration.node(offset, offset + node.nodeSize, {
        class: GUTTER_BLOCK_CLASS,
        [GUTTER_LINE_ATTR]: String(line),
      })
    );
  });
  return DecorationSet.create(doc, decorations);
}

/** Whether the gutter is currently showing. */
export function areLineNumbersEnabled(editor: Editor): boolean {
  return lineNumberGutterPluginKey.getState(editor.state)?.enabled ?? false;
}

/**
 * Turn the gutter on or off. Enabling schedules an immediate recompute; the
 * numbers appear on the next tick rather than synchronously so the caller is
 * never re-entered from inside a ProseMirror update.
 */
export function setLineNumbersEnabled(editor: Editor, enabled: boolean): void {
  const state = lineNumberGutterPluginKey.getState(editor.state);
  if (!state || state.enabled === enabled) return;
  const meta: LineNumberGutterMeta = enabled ? { enabled } : { enabled, lines: null };
  editor.view.dispatch(editor.state.tr.setMeta(lineNumberGutterPluginKey, meta));
}

/**
 * Recompute the numbers now and dispatch them. Safe to call when the gutter is
 * off (it does nothing) — used by the debounced recompute, and directly when a
 * setting that shifts line numbers (blank-line mode) changes.
 */
export function refreshLineNumbers(editor: Editor, blankLineMode?: BlankLineMode): void {
  const state = lineNumberGutterPluginKey.getState(editor.state);
  if (!state?.enabled) return;
  const storage = editor.storage?.lineNumberGutter as LineNumberGutterStorage | undefined;
  const mode = blankLineMode ?? storage?.getBlankLineMode?.() ?? 'preserve';
  const lines = computeGutterLineNumbers(editor, mode);
  const meta: LineNumberGutterMeta = { lines };
  editor.view.dispatch(editor.state.tr.setMeta(lineNumberGutterPluginKey, meta));
}

export const LineNumberGutter = Extension.create<LineNumberGutterOptions, LineNumberGutterStorage>({
  name: 'lineNumberGutter',

  addOptions() {
    return {
      enabled: false,
      getBlankLineMode: () => 'preserve' as BlankLineMode,
      debounceMs: DEFAULT_DEBOUNCE_MS,
    };
  },

  addStorage() {
    return {
      getBlankLineMode: () => 'preserve' as BlankLineMode,
      debounceMs: DEFAULT_DEBOUNCE_MS,
    };
  },

  onCreate() {
    // Mirror the options into storage so the module-level helpers above can
    // reach them from callers that only hold an `Editor`.
    this.storage.getBlankLineMode = this.options.getBlankLineMode;
    this.storage.debounceMs = this.options.debounceMs;
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const editorRef = this.editor;

    return [
      new Plugin<LineNumberGutterState>({
        key: lineNumberGutterPluginKey,
        state: {
          init: () => ({
            enabled: options.enabled,
            decorations: DecorationSet.empty,
          }),
          apply(tr, previous, _oldState, newState): LineNumberGutterState {
            const meta = tr.getMeta(lineNumberGutterPluginKey) as LineNumberGutterMeta | undefined;
            const enabled = typeof meta?.enabled === 'boolean' ? meta.enabled : previous.enabled;
            if (!enabled) {
              return { enabled, decorations: DecorationSet.empty };
            }
            if (meta && 'lines' in meta) {
              return {
                enabled,
                decorations: meta.lines
                  ? buildGutterDecorations(newState.doc, meta.lines)
                  : DecorationSet.empty,
              };
            }
            // No fresh numbers yet: keep the decorations attached to their
            // blocks by mapping them through this transaction. They may be
            // stale for one debounce interval, never detached.
            return { enabled, decorations: previous.decorations.map(tr.mapping, tr.doc) };
          },
        },
        props: {
          decorations(state) {
            return lineNumberGutterPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
          attributes(state): { [name: string]: string } {
            return lineNumberGutterPluginKey.getState(state)?.enabled
              ? { class: GUTTER_ACTIVE_CLASS }
              : {};
          },
        },
        view: view => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const schedule = (delay: number) => {
            if (timer !== undefined) clearTimeout(timer);
            timer = setTimeout(() => {
              timer = undefined;
              if (!editorRef.isDestroyed) refreshLineNumbers(editorRef);
            }, delay);
          };
          const cancel = () => {
            if (timer !== undefined) clearTimeout(timer);
            timer = undefined;
          };

          if (lineNumberGutterPluginKey.getState(view.state)?.enabled) {
            schedule(0);
          }

          return {
            update(updatedView, previousState) {
              const current = lineNumberGutterPluginKey.getState(updatedView.state);
              const previous = lineNumberGutterPluginKey.getState(previousState);
              if (!current?.enabled) {
                cancel();
                return;
              }
              if (!previous?.enabled) {
                // Just switched on — paint as soon as the current update settles.
                schedule(0);
              } else if (updatedView.state.doc !== previousState.doc) {
                schedule(options.debounceMs);
              }
            },
            destroy: cancel,
          };
        },
      }),
    ];
  },
});
