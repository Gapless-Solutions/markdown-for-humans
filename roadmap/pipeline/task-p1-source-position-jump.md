# Task: Source Position Jump (WYSIWYG ↔ raw at the same spot)

## 1. Task Metadata

- **Task name:** Source Position Jump
- **Slug:** source-position-jump
- **Status:** in-progress
- **Created:** 2026-08-08
- **Last updated:** 2026-08-08
- **Shipped:** _(pending)_

---

## 2. Context & Problem

**Current state:**

- The toolbar `</>` button opens the raw source in a split view — but at the top,
  with no relationship to where the user was reading/editing.
- `roadmap/pipeline/task-p0-source-view-toggle.md` plans CONTINUOUS cursor/scroll
  sync for the split view; nothing covers a discrete "take me to this exact spot"
  jump, in either direction.
- The block→line mapping needed for this already exists:
  `src/webview/utils/aiContextReference.ts` computes saved-file line ranges for
  editor blocks (built for `Copy as AI Context`), and the mapping is invertible.

**Pain points:**

- **Lost position:** switching to source to fix an edge case means re-finding
  your place by eye in a potentially long file.
- **No way back:** after editing raw markdown, returning to the rendered view
  drops you at the top again.

**Why it matters:**

- Debugging markdown edge cases is THE reason the source view exists (per the
  source-view-toggle plan); landing at the right line removes its main friction.

---

## 3. Desired Outcome & Scope

**Success criteria:**

- From the rendered view, one gesture opens the raw source **with the cursor on
  the line of the block the user pointed at** (split view, existing behavior).
- From the raw editor, one command opens the rendered view **scrolled to the
  block containing the cursor's line**.
- Accuracy: block-level (the block's first line), which is what the existing
  mapping provides. Character-exact mapping is explicitly out of scope for v1.
- No interference with normal double-click word selection.

**In scope:**

- **Rendered → source:** `Alt+Double-Click` on any block jumps to its line in
  the source split. (Plain double-click stays word-selection.) Also exposed as
  a command: `Markdown for Humans: Open Source at This Position`.
- **Source → rendered:** command `Markdown for Humans: Open in Rendered View at
  Cursor` + editor context-menu entry for `.md` files; opens/reveals the MFH
  editor scrolled to the corresponding block, cursor placed there.
- New webview↔host messages: `openSourceAtLine` (webview→host, carries the
  computed line) and `revealLine` (host→webview, carries the target line).

**Out of scope:**

- Continuous cursor/scroll sync (belongs to `task-p0-source-view-toggle.md`;
  this task's messages are building blocks for it).
- Character/word-exact position mapping (serialized markdown ≠ rendered text
  1:1; block granularity is honest and predictable).
- Mouse back/forward navigation (VS Code's editor history already handles it).

---

## 4. UX & Behavior

**Flow 1: rendered → source**

1. User Alt+double-clicks a paragraph in the rendered view.
2. Source split opens (or focuses if already open), cursor on that block's
   first line, line revealed centered.

**Flow 2: source → rendered**

1. User right-clicks in the raw editor → "Open in Rendered View at Cursor"
   (or runs the command / keybinding).
2. MFH editor opens (or focuses), scrolled to the corresponding block; cursor
   placed at its start.

**Behavior rules:**

- Alt+double-click inside interactive elements (links, images, mermaid,
  code-block copy button, details chevron) is ignored — those own their clicks.
- Unsaved changes: line numbers are computed against the serialization pipeline
  (same guarantee as `Copy as AI Context`, which saves first — reuse that).
- If the mapping fails (empty doc, exotic block), fall back to opening the
  source at the top — never error.

---

## 5. Technical Plan

**Surfaces:** webview (gesture + line math), extension host (editor opening,
commands), `package.json` (commands, context-menu contribution).

**Key changes:**

- `src/webview/editor.ts` — `dblclick` listener (Alt only): resolve click pos
  via `view.posAtCoords`, compute the block's line via the
  `aiContextReference.ts` machinery, post `openSourceAtLine`.
- `src/editor/MarkdownEditorProvider.ts` — handle `openSourceAtLine`: save (to
  make lines truthful), `showTextDocument(doc, { viewColumn: Beside })` with
  `selection`/`revealRange`. Handle the reverse command: read active raw
  editor's cursor line, `vscode.openWith` the MFH editor, post `revealLine`.
- `src/webview/editor.ts` — on `revealLine`: invert the block→line mapping,
  scroll + set cursor (reuse `scrollToHeading`-style reveal).
- `package.json` + `src/extension.ts` — two commands; context-menu entry for
  markdown files (`editor/context` with `resourceExtname == .md`).

**Architecture notes:**

- Reuses the block↔line mapping from `aiContextReference.ts` — extract its
  block-walk into a shared helper rather than duplicating.
- Respects the document↔webview sync loop: no document mutation, only view
  actions.

---

## 6. Work Breakdown

- [x] **Phase 1:** block↔line inverse (`findBlockPosForLine`) beside the
      existing forward mapping (+ unit tests both directions)
- [x] **Phase 2:** rendered→source (modifier+dblclick + command + host handler)
- [x] **Phase 3:** source→rendered (command + context menu + revealLine)
- [ ] **Testing:** Jest for mapping + gesture policy done; manual QA pending

---

## 7. Implementation Log

### 2026-08-08 – Implemented (all phases)

- **What:** `findBlockPosForLine` added to `aiContextReference.ts` (inverse of
  the selection→line mapping, gap-snapping + end-clamping).
  `sourceJump.ts` holds the gesture policy: modifier is configurable via
  `markdownForHumans.sourceJump.modifier` (alt default / ctrl / shift / none /
  disabled), exact-match so unrelated chords never fire. Webview posts
  `openSourceView` with a `line`; host opens the split with the cursor there.
  Reverse: `markdownForHumans.openRenderedAtCursor` (command + editor context
  menu) queues a one-shot reveal consumed on the webview's `ready` handshake,
  with a timeout fallback for already-open webviews; the webview handles
  `revealLine` via the inverse mapping.
- **Files:** `src/webview/utils/sourceJump.ts`,
  `src/webview/utils/aiContextReference.ts`, `src/webview/editor.ts`,
  `src/editor/MarkdownEditorProvider.ts`, `src/activeWebview.ts`,
  `src/extension.ts`, `package.json`,
  `src/__tests__/webview/sourceJump.test.ts`.

---

## 8. Decisions & Tradeoffs

- **Alt+double-click by default, modifier configurable (owner decision
  2026-08-08):** plain double-click is word-selection in every editor,
  including this one; overriding it would break text editing. The
  `sourceJump.modifier` setting offers `none` for users who accept that
  tradeoff and `disabled` to turn the gesture off. (Raw-editor side can't hook
  double-click at all — VS Code exposes no such event for text editors — hence
  command + context menu.)
- **Block-level accuracy:** the serialized file and the rendered view don't map
  1:1 below block level; block-start lines are predictable and always correct.

---

## 9. Follow-up & Future Work

- Feeds directly into `task-p0-source-view-toggle.md`'s continuous cursor/scroll
  sync (same messages, applied on selection change instead of on gesture).
- Optional setting to make plain double-click trigger the jump for users who
  accept losing double-click word selection.
