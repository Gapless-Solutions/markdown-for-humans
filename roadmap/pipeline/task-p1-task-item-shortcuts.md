# Task: Keyboard check/uncheck for task items, with strike-through

## 1. Task Metadata

- **Task name:** Keyboard check/uncheck for task items, with strike-through
- **Slug:** task-item-shortcuts
- **Status:** in-progress
- **Created:** 2026-08-10
- **Last updated:** 2026-08-10
- **Shipped:** _(pending)_

---

## 2. Context & Problem

**Current state:**

- Task lists work. `ListKit.configure({ taskItem: { nested: true } })` in
  `src/webview/editor.ts` registers TipTap's `TaskList`/`TaskItem`, the toolbar can convert a block
  into a checklist (`toggleTaskList()` in `src/webview/BubbleMenuView.ts`), and the rendered
  checkbox is clickable with the mouse.
- **Nothing sets the checked state programmatically.** `toggleTaskList` changes a block's *list
  type*; it does not check or uncheck an item. There is no command, no keybinding, and no
  webview message for it — a repo-wide search for `setChecked` / `checked:` finds only that one
  toolbar call.
- **Checked items are not visually distinguished.** The only `line-through` in `editor.css` is on
  the `<s>` element (the strike mark); nothing keys off `data-checked`.

**Pain points:**

- **Ticking a box requires the mouse.** In a document being worked through as a checklist, that is
  the highest-frequency action there is, and it is the one action that breaks the flow of typing.
- **A completed item looks like an open one.** At a glance down a long list, the checkbox glyph is
  the only difference — there is no typographic signal, which is what the eye actually scans for.

**Why it matters:**

- **Reading experience outranks feature completeness.** A checklist where done and not-done items
  are typographically identical is a reading failure, not a missing feature.
- **The owner uses `Alt+C` / `Alt+X` for exactly this in every other dev environment.** Matching it
  here is worth more than matching any tool-specific convention (GitHub and Obsidian use a single
  toggle chord); making this the one editor that behaves differently is the actual cost to avoid.

---

## 3. Desired Outcome & Scope

**Success criteria:**

- `Alt+C` checks the task item at the cursor; `Alt+X` unchecks it. Both work from the keyboard with
  focus in the rendered editor, and neither requires the mouse.
- A multi-item selection applies to **every** task item it touches, not just the first.
- Checked items render with strike-through by default, with the markdown on disk unchanged.
- A setting switches strike-through to write `~~…~~` into the source instead, or to turn it off.
- Both chords are rebindable through VS Code's normal keybindings UI.
- `copyAiContextRef` still works, on `Alt+Shift+C`, and its toolbar button is untouched.
- No regression: full suite green (1081 tests at time of writing).

**In scope:**

- Two commands + two keybindings, `when`-scoped to this editor.
- Moving `copyAiContextRef` from `Alt+C` to `Alt+Shift+C`.
- Strike-through rendering and its setting.
- Cursor-in-a-task-item and multi-item-selection behavior.

**Out of scope:**

- A *toggle* chord (one key that flips state). Explicit check and uncheck is what was asked for and
  is what makes a multi-item selection well-defined — a toggle over a mixed selection has no
  obvious meaning.
- Changing how task lists parse, serialize, or nest (upstream issue #14 territory).
- A toolbar button for check/uncheck; the checkbox itself is already the mouse affordance.

---

## 4. UX & Behavior

**Entry points:**

- `Alt+C` / `Alt+X` in the rendered editor; both also in the command palette as
  *Markdown for Humans: Check Task Item* / *Uncheck Task Item*.

**User flows:**

### Flow 1: Tick the item you are typing on

1. Cursor is anywhere inside a task item's text.
2. `Alt+C` → the box becomes checked and the text renders struck through.
3. `Alt+X` → unchecked, strike removed.

### Flow 2: Tick a run of items

1. Select across five task items (partial selection at either end is fine).
2. `Alt+C` → all five become checked.

### Flow 3: Not in a task item

1. Cursor is in a paragraph or heading.
2. `Alt+C` does nothing — no error dialog, no document change.

**Behavior rules:**

- Checking an already-checked item is a no-op, not a toggle. Same for unchecking.
- A selection touching both checked and unchecked items drives them all to the requested state.
- Nested task items are treated individually; checking a parent does not cascade to children.
- The strike-through setting applies live to already-open documents, via the existing
  `onDidChangeConfiguration` → `postMessage` sync path.

---

## 5. Technical Plan

**Surfaces:**

- Extension host: two thin command registrations.
- Webview: the actual node manipulation, because the webview owns the selection.
- CSS: the default strike-through.

**Key changes:**

- `package.json` – two `commands`, two `keybindings`, the `Alt+Shift+C` move, one new setting.
- `src/extension.ts` – register `checkTaskItem` / `uncheckTaskItem` as thin triggers that
  `postMessage` to the active webview panel.
- `src/webview/utils/taskItems.ts` – **new.** Pure helpers: find every `taskItem` node intersecting
  a selection range, and decide what changes.
- `src/webview/editor.ts` – handle the two messages; apply the changes; handle the setting.
- `src/webview/editor.css` – strike-through for `li[data-checked="true"]`, gated by a root class so
  the setting can switch it off without a reload.
- `src/__tests__/webview/taskItems.test.ts` – **new.**

**Architecture notes:**

- **Commands as thin host triggers, work in the webview.** This is the established shape in this
  codebase — `copyAiContextRef` and `openSourceAtCursor` are both commented as "the webview owns
  the selection state, so the host command stays a thin trigger". Following it means the new
  chords are ordinary VS Code keybindings.
- **That is also what makes them rebindable, and why they need no enable/disable setting.**
  Compare `formattingShortcuts.enabled`, which exists *because* `Mod+B/I/U` are bound inside TipTap
  as webview keymaps and therefore cannot be reached from `keybindings.json` at all. Ours are
  contributed keybindings, so VS Code's own UI is the escape hatch. Adding a redundant setting
  would be cargo-culting the earlier one.
- **Both chords clear the bar set by upstream issue #17** (*"Hijacking VScode Keychord"*, closed —
  the extension had claimed `Ctrl+K` and blocked every VS Code chord starting with it). `Alt+C` and
  `Alt+X` are not chord prefixes, are not VS Code defaults, and do not collide with a menu-bar
  mnemonic (File/Edit/Selection/View/Go/Run/Terminal/Help — no C or X). They are additionally
  `when`-scoped to `activeCustomEditorId == 'markdownForHumans.editor'`, so they do not exist
  outside this editor.
- **`Alt+C` is currently `copyAiContextRef`, in exactly the same `when` context.** Two commands on
  one chord in one context resolve last-registered-wins, so this is a real conflict, not a
  theoretical one — hence the move to `Alt+Shift+C` (free in VS Code defaults and in this
  extension, which otherwise uses only `Ctrl+Alt+B`). `copyAiContextRef` keeps its ✨ toolbar
  button, so nothing becomes undiscoverable.
- **Checked state is a node attribute, so use the document model, not text surgery:**
  `updateAttributes('taskItem', { checked })` over each matching node inside one chained
  transaction — one undo step for a multi-item selection.
- **`markdown` strike mode reuses the existing `strike` mark rather than editing text.** Applying
  and removing TipTap's `Strike` over the item's inline range serializes to `~~…~~` for free, keeps
  the change inside the document model, and therefore respects the debounced-sync loop without
  special handling. String-splicing `~~` into the source would not.

**Performance considerations:**

- One transaction per keypress over a bounded node range; nowhere near the <16ms typing budget.
- The `visual` strike-through is a static CSS rule keyed on an attribute already in the DOM — zero
  runtime cost, and no reflow beyond the text decoration itself.

---

## 6. Work Breakdown

- [x] **Phase 1: Selection → task items** – pure, fully testable
  - [x] `findTaskItemsInSelection(doc, from, to)` returning node positions
  - [x] Tests: cursor inside one item, selection spanning several, partial selections at the
        ends, nested items, cursor outside any task item, empty document
- [x] **Phase 2: Check / uncheck** – apply state in one transaction
  - [x] Already-checked stays checked (no accidental toggle); mixed selection drives to target
  - [x] Real-editor tests, following `aiContextReference.realEditor.test.ts`
- [x] **Phase 3: Commands, keybindings, and the `Alt+Shift+C` move**
  - [x] `package.json` + `src/extension.ts`; verify `copyAiContextRef` still fires on its new chord
- [x] **Phase 4: Strike-through**
  - [x] `visual` — CSS on `li[data-checked="true"]`, root class driven by the setting
  - [x] `markdown` — apply/remove the `strike` mark over the item's inline range
  - [x] `off`
  - [x] Live setting changes reach open documents
- [x] **Testing**
  - [x] Manual checklist in the Extension Development Host: single item · multi-item selection ·
        nested items · not-in-a-task-item · all three strike modes · live setting change ·
        `Alt+Shift+C` still copies · undo restores in one step · light and dark

---

## 7. Implementation Log

### 2026-08-10 – Feature complete, gate green

- **What:** All four phases implemented TDD-first. 23 new tests; suite went 1081 → 1104 passing,
  81 suites, lint clean at `--max-warnings 0`, both builds clean.
- **Files:** `src/webview/utils/taskItems.ts` (new), `src/webview/editor.ts`,
  `src/webview/editor.css`, `src/extension.ts`, `src/editor/MarkdownEditorProvider.ts`,
  `package.json`, `src/__tests__/webview/taskItems.realEditor.test.ts` (new),
  `src/__tests__/editor/undoSync.test.ts` (payload assertions).
- **Notes:** The design survived contact intact — no rework, and the position math worked first
  time. Three things worth recording:

**The "own text" rule is what makes nesting correct, and it is subtler than it looks.**
ProseMirror's `nodesBetween` reports *every* ancestor at a position, so a cursor inside a sub-task
reports the sub-task **and** its parent. Matching on the item's own first block rather than its
subtree gives the right answer in all three cases: cursor in a child matches only the child, cursor
in the parent matches only the parent, and a selection dragged from parent text into child text
matches both. Tested from all three directions.

**Two existing tests in `undoSync.test.ts` assert the settings payload with `toEqual`**, so adding
a field to it broke them. Updated rather than loosened — an exact-shape assertion on that payload
is worth keeping, since it is the contract between host and webview.

**A scripted edit to `MarkdownEditorProvider.ts` double-applied** because the 6-space settings-payload
pattern is a substring of the 10-space one, inserting two stray lines. Caught by reading the diff
before committing, not by the gate — the duplicate was syntactically valid TypeScript and every test
passed. Worth remembering that "tests green" does not mean "diff clean".

---

## 8. Decisions & Tradeoffs

- **Explicit check and uncheck, not one toggle.** Matches the owner's cross-environment muscle
  memory, and gives a multi-item selection a well-defined result — a toggle over a mixed selection
  does not have one.
- **Moved `copyAiContextRef` rather than sharing `Alt+C` behind a context key.** The shared-chord
  design needed the webview to push a `markdownForHumans.inTaskItem` context key on every selection
  change; a keypress arriving before that round-trip completes fires the wrong command. Trading an
  intermittent wrong-action bug for one saved modifier is a bad trade. The context ref also keeps a
  toolbar affordance, which the checkbox chord does not have.
- **`visual` as the default strike mode.** Rendering is a view concern; writing `~~` into the file
  changes what every *other* tool sees, and unchecking then has to remove markers it cannot prove
  it added. Default to the reversible one.
- **`markdown` mode is deliberately not strike-aware.** In that mode, unchecking removes the strike
  mark across the item's text, including a `~~…~~` the user typed themselves. Detecting authorship
  is not possible from the document, and the alternative — never removing — is worse. Documented in
  the setting description rather than engineered around.
- **No enable/disable setting for the shortcuts**, unlike `formattingShortcuts.enabled`. That
  setting exists only because TipTap-internal keymaps are unreachable from `keybindings.json`;
  contributed keybindings already have VS Code's own UI as the escape hatch.

---

## 9. Follow-up & Future Work

- A `Alt+Shift+X`-style "uncheck all in document" if the need appears; deliberately not built now.
- Cascading check to nested children could be a setting later; the flat behavior is the safer
  default and matches how GitHub renders nested task lists.
