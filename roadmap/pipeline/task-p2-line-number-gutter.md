# Task: Source Line-Number Gutter

## 1. Task Metadata

- **Task name:** Source Line-Number Gutter
- **Slug:** line-number-gutter
- **Status:** planned
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

---

## 6. Work Breakdown

- [ ] **Phase 1:** decoration plugin + setting plumb (TDD on the decoration
      positions via `computeBlockLineRanges` fixtures)
- [ ] **Phase 2:** CSS + toggle command + QA on large documents

---

## 7. Implementation Log

_(To be filled during implementation)_

---

## 8. Decisions & Tradeoffs

- **Block start lines only:** exactness over density — a number that is
  sometimes wrong is worse than a sparser gutter that is always right.
- **Off by default:** reading-first product; the gutter is a power-user aid.

---

## 9. Follow-up & Future Work

- Click a gutter number → source position jump (reuse `openSourceView`+line).
- Show the active block's line in the VS Code status bar.
