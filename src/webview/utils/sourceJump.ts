/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

/**
 * Gesture policy for the "jump to source at this position" double-click.
 *
 * Plain double-click is word selection in every editor, so the jump defaults
 * to Alt+double-click; the modifier is a user setting
 * (`markdownForHumans.sourceJump.modifier`), including `none` for users who
 * accept losing double-click word selection, and `disabled` to turn the
 * gesture off entirely (the command palette entry keeps working).
 */

export type SourceJumpModifier = 'alt' | 'ctrl' | 'shift' | 'none' | 'disabled';

const VALID_MODIFIERS: readonly SourceJumpModifier[] = ['alt', 'ctrl', 'shift', 'none', 'disabled'];

export function normalizeSourceJumpModifier(value: unknown): SourceJumpModifier {
  return VALID_MODIFIERS.includes(value as SourceJumpModifier)
    ? (value as SourceJumpModifier)
    : 'alt';
}

export interface ModifierKeys {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * Whether a double-click with these modifier keys should trigger the jump.
 * Exactly the configured modifier must be held (Cmd counts as Ctrl on macOS);
 * extra modifiers cancel the gesture so it never fires on unrelated chords.
 */
export function matchesSourceJumpGesture(
  keys: ModifierKeys,
  modifier: SourceJumpModifier
): boolean {
  const ctrlLike = keys.ctrlKey || keys.metaKey;
  switch (modifier) {
    case 'alt':
      return keys.altKey && !ctrlLike && !keys.shiftKey;
    case 'ctrl':
      return ctrlLike && !keys.altKey && !keys.shiftKey;
    case 'shift':
      return keys.shiftKey && !keys.altKey && !ctrlLike;
    case 'none':
      return !keys.altKey && !ctrlLike && !keys.shiftKey;
    case 'disabled':
      return false;
  }
}
