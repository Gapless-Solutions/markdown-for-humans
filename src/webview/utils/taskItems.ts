/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 *
 * @fileoverview Check and uncheck task-list items from the keyboard.
 *
 * Checked state is a node attribute, so everything here works through the
 * document model — `setNodeMarkup` for the box, and the existing `strike` mark
 * for the optional strike-through. Nothing splices text, which is what keeps
 * this clear of the debounced-sync loop and its echo-suppression flags.
 */

import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * How a checked item should be struck through.
 *
 * - `visual`   — CSS only; the markdown on disk is unchanged (default).
 * - `markdown` — the item's text is wrapped in `~~…~~` so it renders struck
 *                everywhere, including GitHub.
 * - `off`      — no strike-through at all.
 */
export type TaskStrikeMode = 'visual' | 'markdown' | 'off';

export interface TaskItemMatch {
  /** Position of the `taskItem` node itself. */
  pos: number;
  checked: boolean;
  /** Start of the item's *own* text content, excluding any nested list. */
  ownFrom: number;
  /** End of the item's own text content. */
  ownTo: number;
}

const TASK_ITEM = 'taskItem';

/**
 * Every task item whose **own text** the selection touches.
 *
 * Keying on the item's own first block rather than its whole subtree is what
 * makes nesting behave: a cursor inside a sub-task matches only the sub-task,
 * even though ProseMirror reports every ancestor at that position, while a
 * selection dragged from a parent's text down into a child's still matches
 * both. Sweeping in ancestors would silently tick a parent when you ticked one
 * of its sub-tasks.
 */
export function findTaskItemsInSelection(
  doc: ProseMirrorNode,
  from: number,
  to: number
): TaskItemMatch[] {
  const matches: TaskItemMatch[] = [];

  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== TASK_ITEM) {
      return true;
    }
    const firstChild = node.firstChild;
    if (!firstChild) {
      return true;
    }
    // +1 steps inside the taskItem to its first block; that block's own range
    // is the item's label text, and anything after it is a nested list.
    const ownFrom = pos + 1;
    const ownTo = ownFrom + firstChild.nodeSize;

    if (from <= ownTo && to >= ownFrom) {
      matches.push({ pos, checked: node.attrs.checked === true, ownFrom, ownTo });
    }
    return true;
  });

  return matches;
}

/**
 * Drive every task item in the current selection to `checked`.
 *
 * Explicitly *set*, never toggle — that is what gives a selection covering a
 * mix of checked and unchecked items a well-defined result.
 *
 * Returns whether anything actually changed, so callers can stay silent on a
 * no-op (cursor outside any task item, or every item already in the target
 * state) rather than pushing an empty transaction.
 */
export function setTaskItemsChecked(
  editor: Editor,
  checked: boolean,
  strikeMode: TaskStrikeMode
): boolean {
  const { state } = editor;
  const { from, to } = state.selection;
  const matches = findTaskItemsInSelection(state.doc, from, to);
  if (matches.length === 0) {
    return false;
  }

  const strikeType = strikeMode === 'markdown' ? state.schema.marks.strike : undefined;
  const pending = matches.filter(match => match.checked !== checked);
  if (pending.length === 0) {
    return false;
  }

  const tr = state.tr;
  for (const match of pending) {
    const node = state.doc.nodeAt(match.pos);
    if (!node) {
      continue;
    }
    // Both setNodeMarkup and add/removeMark preserve node size, so the
    // positions collected above stay valid for the whole loop — no mapping.
    tr.setNodeMarkup(match.pos, undefined, { ...node.attrs, checked });

    if (strikeType) {
      // The item's own text only: striking the subtree would strike nested
      // sub-tasks too, which is not what checking a parent means.
      if (checked) {
        tr.addMark(match.ownFrom, match.ownTo, strikeType.create());
      } else {
        tr.removeMark(match.ownFrom, match.ownTo, strikeType);
      }
    }
  }

  if (!tr.docChanged) {
    return false;
  }

  // One dispatch for the whole selection, so a multi-item change is a single
  // undo step.
  editor.view.dispatch(tr);
  return true;
}
