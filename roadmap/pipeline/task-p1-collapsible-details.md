# Task: Collapsible `<details>` Sections

## 1. Task Metadata

- **Task name:** Collapsible `<details>` Sections
- **Slug:** collapsible-details
- **Status:** planned
- **Created:** 2026-08-08
- **Last updated:** 2026-08-08
- **Shipped:** _(pending)_

---

## 2. Context & Problem

**Current state:**

- `<details>`/`<summary>` is the standard GitHub-flavored way to author collapsible
  sections that render collapsed on GitHub, in READMEs, issues, and most markdown viewers.
- The editor currently **destroys** this markup: on load, the `<details>` and `<summary>`
  tags are dropped (the HTML block is parsed and unknown wrappers unwrapped), leaving the
  summary text as a plain paragraph. Any edit + save silently rewrites the file without
  the tags — **silent data corruption** for documents that use them.
- The only existing support is incidental: `markedLexerNormalizer.ts` lists `details` in
  `MERGEABLE_CONTAINER_TAGS`, so multi-fragment `<details>` HTML blocks at least arrive
  as one token instead of being shredded at the lexer level.

**Pain points:**

- **Silent data loss:** Opening and saving any README that uses `<details>` strips the
  collapsible markup without warning — the worst failure mode for a WYSIWYG editor whose
  document is the source of truth.
- **No collapsible authoring:** Users cannot create GitHub-style collapsed sections
  (FAQ entries, long logs, optional deep-dives) from the editor at all.
- **Reading long documents:** No way to author sections that ship collapsed for readers.

**Why it matters:**

- **Correctness first:** Fixing round-trip preservation is a bug fix, independent of any UI.
- **Industry standard:** GitHub, GitLab, Obsidian, Typora all render `<details>` blocks;
  it is the de-facto markdown idiom for collapsible content.
- **Existing demand:** Upstream issue #72 asks for HTML5 tag rendering generally;
  `roadmap/pipeline/task-p1-collapsible-headers.md` targets the same reader pain
  (long documents) via view-state folding — this task covers the *persisted, portable*
  variant and complements it.

---

## 3. Desired Outcome & Scope

**Success criteria:**

- A document containing `<details>`/`<summary>` blocks round-trips **byte-preserving**
  (modulo the editor's existing normalization rules) through load → edit elsewhere → save.
- `<details>` blocks render in the editor as native-feeling collapsible sections:
  clickable summary row with chevron, body hidden when collapsed.
- Markdown content inside the body (lists, bold, code blocks, images) renders and is
  editable exactly like top-level content.
- The `open` attribute is respected both ways: `<details open>` loads expanded and
  serializes back with `open`.
- Users can insert a new collapsible section from the toolbar.
- No regression in existing HTML handling (tables, alerts) — full Jest suite stays green.

**In scope:**

- New TipTap node pair: `detailsSection` (block container) + `detailsSummary`
  (inline-content title row), in one self-contained extension file.
- Markdown parse: recognize a merged `html` token whose root is `<details>`, extract the
  `<summary>` inline content, and parse the body as markdown (GitHub semantics: markdown
  in the body renders when separated by blank lines).
- Markdown serialize: emit canonical GitHub-compatible form —
  `<details>` / `<summary>…</summary>` / blank line / body markdown / blank line /
  `</details>`, preserving `open`.
- Editor UX:
  - Chevron + summary row; click toggles collapse (view-only by default — toggling does
    **not** dirty the document).
  - `<details open>` ↔ default-expanded; an explicit control (context of the section)
    toggles the persisted `open` attribute as a document edit.
  - Summary text is editable inline; body is a normal editable block region when expanded.
- Toolbar button in `BubbleMenuView.ts` to wrap the current selection / insert a new
  collapsible section with placeholder summary.
- Paste: keep `<details>`/`<summary>` structure when pasting HTML that contains it
  (turndown keep-rule, same pattern as tables).
- HTML export: emit native `<details>` so exports stay collapsible.
- Tests with the feature (TDD): round-trip preservation (the exact corruption scenario),
  nested details, `open` attribute, markdown body content, summary formatting, paste,
  insert command.

**Out of scope:**

- Header-based folding (separate planned task: `task-p1-collapsible-headers.md`).
- Generic HTML5 tag rendering (`<video>` etc. — issue #72); this task deliberately
  handles only `details`/`summary`.
- Inline `<details>` inside a paragraph (GitHub treats block-level usage; inline stays
  raw text as today).
- Collapse animations; remembering per-file view state across sessions.

---

## 4. UX & Behavior

**Entry points:**

- Toolbar (bubble menu): "Collapsible section" button — wraps selection or inserts empty.
- Existing documents: any `<details>` block renders collapsible automatically.

**User flows:**

### Flow 1: Opening a document that uses `<details>` (bug-fix path)

1. User opens a README containing a `<details>`/`<summary>` block.
2. Block renders as a collapsible section (collapsed unless `open` is present).
3. User edits unrelated text and saves.
4. The `<details>` markup is intact in the file — byte-preserving round-trip.

### Flow 2: Authoring a new collapsible section

1. User selects a few paragraphs, clicks "Collapsible section" in the toolbar.
2. Selection becomes the body; a summary row with placeholder text ("Details") appears.
3. User types the summary title, saves.
4. File contains canonical `<details><summary>…</summary>\n\n…\n\n</details>`.

### Flow 3: Toggling while reading/editing

1. User clicks the summary row (or chevron) of a collapsed section → body expands.
2. Click again → collapses. Document stays clean (no dirty marker) — toggle is view state.
3. To make a section load expanded for everyone, user uses the explicit
   "expanded by default" control → writes/removes the `open` attribute (document edit).

**Behavior rules:**

- Cursor/typing inside the summary edits inline content only; Enter from summary moves
  into the body (does not split the summary).
- Collapsing a section containing the cursor moves the cursor to the summary.
- A `<details>` without `<summary>` gets an empty summary node (serializes back without
  inventing one — only emit `<summary>` if it has content, matching GitHub's optionality).
- Malformed/unclosed `<details>` falls back to current behavior (raw text), never crashes.
- Nested `<details>` supported (GitHub supports nesting).
- Search/outline: body content of collapsed sections is still part of the document; no
  special handling in v1 beyond "expand on click".

---

## 5. Technical Plan

**Surfaces:**

- Webview (TipTap editor) — all core logic.
- No extension-host changes required (no new commands/settings in v1); `package.json`
  untouched unless a review decides a "insert collapsible section" palette command is wanted.

**Key changes:**

- `src/webview/extensions/detailsSection.ts` — new self-contained extension defining:
  - `detailsSection` node: `group: 'block'`, `content: 'detailsSummary block+'`,
    `defining: true`, `isolating: true`; attrs `{ open: boolean }` (persisted),
    plus view-collapsed state kept in the NodeView (not an attr, so toggling is not a
    document change).
  - `detailsSummary` node: `content: 'inline*'`, rendered as the clickable title row.
  - `parseMarkdown` on the `html` token type: detect root `<details>`, DOM-parse the
    merged token (fragments already merged by `markedLexerNormalizer` —
    `details` is in `MERGEABLE_CONTAINER_TAGS`), extract summary, re-lex inner body
    markdown via `helpers`/marked, build nodes.
  - `renderMarkdown`: canonical serialization with blank lines around the body
    (required for GitHub to render body markdown), preserving `open`.
  - NodeView: div-based (not native `<details>`, to keep toggle behavior under
    ProseMirror's control) — chevron + summary contentDOM + body contentDOM; follows
    the `githubAlerts.ts` NodeView pattern (`contentDOM`, `ignoreMutation`, `update`).
- `src/webview/editor.ts` — register the extension.
- `src/webview/editor.css` — chevron, summary row, collapsed state styling (VS Code
  theme variables, consistent with `github-alert` styling).
- `src/webview/BubbleMenuView.ts` — "Collapsible section" button (wrap/insert command).
- `src/webview/utils/pasteHandler.ts` — turndown `keep`/rule for `details`/`summary`
  (same approach as the existing table keep-rules).
- `src/webview/utils/exportContent.ts` — verify native `<details>` output in HTML export
  (expected to work via `renderHTML`; add test).

**Architecture notes:**

- Runs entirely in the webview; respects the document↔webview sync loop untouched
  (serialization changes flow through the existing debounced sync).
- Follows the established pattern: `githubAlerts.ts` is the closest precedent
  (custom block with markdown round-trip + NodeView); `htmlPreservingTable.ts` is the
  precedent for HTML-block ingestion.
- Key risk: parsing markdown *inside* an `html` token — needs the body re-lexed with the
  editor's marked instance (including the blank-line normalizer). Prototype this first
  (Phase 1 spike) since it drives the parse design.

**Performance considerations:**

- Parse cost only on load/paste of documents containing `<details>`; no per-keystroke
  work. Toggle is a class flip in the NodeView — no transaction.

---

## 6. Work Breakdown

- [ ] **Phase 1: Round-trip core (bug fix)** — parse + serialize with tests; no UI polish
  - [ ] Failing tests first: load→serialize preservation, `open` attr, nested, no-summary
  - [ ] `detailsSection`/`detailsSummary` nodes + `parseMarkdown` (html token)
  - [ ] `renderMarkdown` canonical form; blank-line policy compliance
- [ ] **Phase 2: Editor UX** — NodeView, chevron toggle, CSS, summary editing rules
- [ ] **Phase 3: Authoring** — toolbar wrap/insert command; `open` attribute control
- [ ] **Phase 4: Boundaries** — paste keep-rule; HTML export test
- [ ] **Testing** — Jest throughout (TDD); manual QA in Extension Development Host
  - [ ] Round-trip suite (corruption regression)
  - [ ] NodeView interaction tests (toggle, editability)
  - [ ] Paste + export tests

---

## 7. Implementation Log

_(To be filled during implementation)_

---

## 8. Decisions & Tradeoffs

- **View-state toggle vs persisted toggle:** clicking a section toggles view state only
  (no document dirty); the `open` attribute is changed only by an explicit control.
  Rationale: readers collapse/expand constantly — that must not churn the file or git diffs.
- **Div-based NodeView over native `<details>`:** native toggle fires on any summary
  click, fighting text editing; a controlled NodeView keeps editing and toggling separable.

---

## 9. Follow-up & Future Work

- Generic HTML5 block preservation (issue #72 — `<video>` etc.) could reuse the merged
  html-token ingestion built here.
- Slash command (`/details`) once a slash-command framework lands
  (`task-p0-slash-commands.md`).
- Interplay with `task-p1-collapsible-headers.md` (shared chevron styling/UX language).
- Remember view-collapsed state per file across sessions.
