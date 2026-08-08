# Task: Source Line-Number Gutter

## 1. Task Metadata

- **Task name:** Source Line-Number Gutter
- **Slug:** line-number-gutter
- **Status:** in-progress
- **Created:** 2026-08-08
- **Last updated:** 2026-08-08
- **Shipped:** _(pending)_

---

## 2. Context & Problem

**Current state:**

- The rendered view shows no relationship to source line numbers; users
  cross-referencing with the raw file, diagnostics, or AI tools (`@file#42`
  references) must open the source split to see where they are.
- The block→line mapping already exists and is live-computable:
  `computeBlockLineRanges` in `src/webview/utils/aiContextReference.ts` (used
  by Copy as AI Context and the source position jump).

**Why block granularity (and not per visual line):**

- A rendered block does not map 1:1 to source lines below block level:
  soft-wrapped paragraphs occupy one source line but many visual lines, and
  serialization (list markers, code fences) shifts columns. Block start lines
  are exact and honest; anything finer would routinely lie.

---

## 3. Desired Outcome & Scope

**Success criteria:**

- Optional left gutter showing each top-level block's source start line,
  matching the saved file (same math as Copy as AI Context).
- Numbers update as the user edits (debounced, no typing lag).
- Off by default; toggled by a setting and a command.

**In scope:**

- Setting `markdownForHumans.lineNumbers.enabled` (default false) + command
  `Markdown for Humans: Toggle Source Line Numbers`.
- ProseMirror decoration-based gutter: each top-level block gets a
  `data-source-line` widget/attribute rendered in a reserved left margin.
- Recompute on doc change, debounced (~200ms), and on settings change.
- Muted styling consistent with the editor chrome; numbers are not selectable
  and never enter the document.

**Out of scope:**

- Per-visual-line numbering (see above — would be wrong by construction).
- Line numbers inside code blocks (separate concern, code-block-local).
- Click-on-number actions (could later trigger the source jump — follow-up).

---

## 4. UX & Behavior

1. User enables the setting (or runs the toggle command).
2. A quiet gutter appears left of the content; each block's first source line
   is shown aligned with the block's top.
3. Editing shifts numbers live (debounced); collapsed details sections show
   the number of the section block itself.

**Behavior rules:**

- Blank-line-only gaps get no number (nothing to point at).
- When the mapping fails for a block (exotic nodes), its number is omitted —
  never wrong.

---

## 5. Technical Plan

**Surfaces:** webview only (+ setting plumb through the provider like
`sourceJump.modifier`).

**Key changes:**

- `src/webview/extensions/lineNumberGutter.ts` — new extension: ProseMirror
  plugin computing `computeBlockLineRanges` per doc version (debounced),
  emitting widget decorations at each top-level block start; enabled state
  from a configurable option updated via `settingsUpdate`.
- `src/webview/editor.ts` — register + plumb the setting.
- `src/webview/editor.css` — gutter margin on `.markdown-editor`, number
  styling (muted, monospace, non-selectable).
- `src/editor/MarkdownEditorProvider.ts` + `package.json` — setting +
  command + settingsUpdate payloads.

**Performance considerations:**

- `computeBlockLineRanges` serializes every block; on large docs this must
  stay off the typing path — debounce and reuse the serializer cache where
  possible. Budget: no perceptible typing lag on 1000-block documents.
- **Measured 2026-08-08:** a full recompute over a 1000-block document (mixed
  headings/paragraphs, jsdom + ts-jest) takes ~9ms, and it only runs 200ms
  after the last keystroke — comfortably inside the budget, no caching needed.

---

## 6. Work Breakdown

- [x] **Phase 1:** decoration plugin + setting plumb (TDD on the decoration
      positions via `computeBlockLineRanges` fixtures)
- [x] **Phase 2:** CSS + toggle command + QA on large documents
      _(automated tests pass; manual QA in the dev host still pending)_

---

## 7. Implementation Log

### 2026-08-08 – Implemented (both phases)

- **What:** `lineNumberGutter.ts` holds a ProseMirror plugin whose state is
  `{ enabled, decorations }`. Numbers come from `computeBlockLineRanges` (the
  Copy-as-AI-Context math, now exported), mapped block-index → start line and
  turned into `Decoration.node` attributes (`data-source-line` +
  `md-line-number-block`); the number itself is a CSS `::before`, so it never
  enters the document or the selection. The plugin also contributes a
  `md-line-numbers` class to the editable via `props.attributes`, which reserves
  the gutter's left padding — only while the gutter is on.
- **Recompute:** debounced 200ms in the plugin's `view.update`; between the edit
  and the recompute the existing decorations are mapped through the
  transactions, so they stay pinned to their blocks (stale for one interval,
  never detached). Enabling and blank-line-mode changes refresh immediately.
- **Shared math:** `aiContextReference.ts` now exports `computeBlockLineRanges`,
  `resolveMarkdownSerialize`, and `collectTopLevelBlockPositions`; the two
  existing consumers were switched onto the helpers, removing the duplicated
  serializer-resolution blocks.
- **Files:** `src/webview/extensions/lineNumberGutter.ts` (new),
  `src/webview/utils/aiContextReference.ts`, `src/webview/editor.ts`,
  `src/webview/editor.css`, `src/editor/MarkdownEditorProvider.ts`,
  `src/extension.ts`, `package.json`,
  `src/__tests__/webview/lineNumberGutter.test.ts` (new, 13 tests),
  `src/__tests__/editor/undoSync.test.ts` (payload assertions).

---

## 8. Decisions & Tradeoffs

- **Block start lines only:** exactness over density — a number that is
  sometimes wrong is worse than a sparser gutter that is always right.
- **Off by default:** reading-first product; the gutter is a power-user aid.
- **Node decorations, not widgets:** a widget between blocks is positioned at
  its static position, which sits inside the next block's collapsed top margin —
  headings would visibly drift. An attribute on the block plus an absolutely
  positioned `::before` aligns with the block's own box, exactly.
- **Clipping blocks handled explicitly:** the number is drawn outside the
  block's box, so any block that clips its overflow would swallow it. Tables
  (`.tableWrapper`, `overflow-x: auto` for wide-table scrolling) get a negative
  margin + matching padding, so the number lands inside the padding box — same
  content position, still scrollable. Mermaid wrappers swap `overflow: hidden`
  for `clip` + `overflow-clip-margin`. Both rules apply only while the gutter is
  on. A future block type that clips and is neither of these shows no number —
  degraded, never wrong.
- **Gutter lives in padding, not margin:** the drag handle is positioned at
  `editorRect.left - 32`, i.e. in the editable's margin, so putting the numbers
  in the padding keeps the two from colliding.

---

## 9. Follow-up & Future Work

- Click a gutter number → source position jump (reuse `openSourceView`+line).
- Show the active block's line in the VS Code status bar.
