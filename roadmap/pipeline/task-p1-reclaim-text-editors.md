# Task: Reclaim markdown opened as plain text by other extensions

## 1. Task Metadata

- **Task name:** Reclaim markdown opened as plain text by other extensions
- **Slug:** reclaim-text-editors
- **Status:** in-progress
- **Created:** 2026-08-10
- **Last updated:** 2026-08-10
- **Shipped:** _(pending)_

---

## 2. Context & Problem

**Current state:**

- `workbench.editorAssociations: {"*.md": "markdownForHumans.editor"}` is what makes this the
  default `.md` editor (the manifest's `customEditors` priority is `option`, not `default`).
- That association is honored by the Explorer, Quick Open, and `vscode.open` — because all of
  them route through VS Code's editor-resolver.
- It is **not** honored by `vscode.window.showTextDocument(uri)`, which is documented to open the
  resource *in a text editor*. It returns a `TextEditor` and can never resolve a custom editor.
- Any extension that opens a `.md` with `showTextDocument` therefore bypasses the user's stated
  preference entirely, and the file lands in the raw text editor.

**Pain points:**

- **Clicking a file link in the Claude Code chat sidebar opens raw markdown.** Verified in
  `anthropic.claude-code@2.1.226`: its `openFile()` resolves the path and calls
  `ve.window.showTextDocument(n)` unconditionally (it needs a `TextEditor` handle to
  `revealRange()` the `#L42` / searchText anchor). Five other call sites in the same bundle use
  `vscode.open`; this one does not.
- **The user cannot fix it.** No setting changes this — the association is never consulted on that
  code path. It is not a misconfiguration, and not something the association syntax can express.
- **It is a whole category, not one extension.** `showTextDocument` is the most reachable
  file-opening API in the VS Code surface, so any extension linking to a `.md` is a candidate:
  task runners, TODO/bookmark extensions, search-result panels, AI chat sidebars.
- **It splits the experience by entry point.** The same file renders beautifully from the
  Explorer and as raw text from a link, which reads as the extension being unreliable rather than
  as another extension's API choice.

**Why it matters:**

- **Reading experience outranks feature completeness** is this project's first principle. An entry
  point that silently drops the reader into raw markdown defeats it for that file.
- **Upstream issue #23** ("Internal links to .md files open in the standard editor instead of the
  plugin") is open, and the maintainer replied *"I will get it checked"* — no design on record and
  no implementation. This fork already fixed the *inside-the-rendered-view* half of #23
  (`openFileTargetInEditor` routes `.md` link targets to `openRenderedMarkdown`, citing #23). The
  outside-in half — another extension opening the file — is the remaining gap.
- **The building block already exists.** `openRenderedMarkdown(uri, { line, slug })` in
  `src/activeWebview.ts` already does `vscode.openWith` plus a queued line reveal, so the cursor
  position can survive the swap rather than being dropped.

---

## 3. Desired Outcome & Scope

**Success criteria:**

- Clicking a `.md` link in the Claude Code chat sidebar lands in the rendered editor, with the
  `#L42` line revealed, in a single tab (no leftover raw-text tab).
- The swap is invisible in normal use — no flash of a second tab left behind, no focus theft.
- **Zero behavior change for users who have not set the association** — an install that has never
  opted this extension in as the `.md` default behaves exactly as it does today.
- The extension's own deliberate "show me the source" paths keep working untouched: the split
  source view, `openSourceAtCursor`, and the image-references list.
- Diff editors are never reclaimed (git diffs stay diffs).
- No regression: full suite green, including the 1040 existing tests.

**In scope:**

- Detect a `.md`/`.markdown` file opened in a *plain text* editor tab and reopen it rendered.
- Carry the cursor line across the swap.
- A setting to control it, defaulting to a conservative "only when the user already asked for this
  extension by association" mode.
- Suppression so the extension never fights its own source-view features.

**Out of scope:**

- Fixing `anthropic.claude-code` itself (reported separately; this must work regardless).
- Untitled/in-memory markdown buffers — `file:` scheme only for now.
- Notebook cells, virtual filesystems, remote schemes.
- Reclaiming a `.md` the user opened as text *on purpose* via VS Code's own "Reopen Editor With…"
  — indistinguishable from any other text open, and the `never` setting is the escape hatch.

---

## 4. UX & Behavior

**Entry points:**

- None visible. This is ambient behavior governed by one setting,
  `markdownForHumans.reclaimTextEditors`.

**User flows:**

### Flow 1: Chat-sidebar link (the reported case)

1. User clicks `[notes.md:42](notes.md#L42)` in an AI chat sidebar.
2. The other extension calls `showTextDocument` → a raw text tab opens at line 42.
3. This extension sees a new plain-text tab for a `.md` whose association points here.
4. It reads the cursor line from that editor, opens the rendered editor at the same line, and
   closes the text tab.
5. User sees the rendered document, scrolled to the right place. One tab.

### Flow 2: Deliberate source view (must NOT be reclaimed)

1. User is in the rendered editor and hits the split-source toolbar button, or
   `Markdown for Humans: Open Source at This Position`.
2. The extension records a *source-view intent* for that URI, then opens the text editor.
3. The reclaim watcher sees the intent and stands down.
4. The source stays open — and keeps staying open on subsequent focus changes — until the user
   closes that tab, which clears the intent.

### Flow 3: Association not set (must be a no-op)

1. A user without `workbench.editorAssociations` opens a `.md` link from anywhere.
2. Default mode `auto` finds no association pointing here and does nothing.

**Behavior rules:**

- Only `file:`-scheme tabs whose input is a plain text editor. Diff tabs, custom-editor tabs,
  notebook tabs and other schemes are structurally excluded by the tab-input type, not by guesswork.
- Never reclaim a **dirty** document — closing it would prompt to save, and unsaved raw edits are
  a signal the user wants the text editor.
- Never reclaim a URI with an active source-view intent.
- Reclaim each URI at most once per short window, so nothing can ping-pong.
- Any failure is silent and leaves the text editor in place — this must never be able to lose a
  file or trap the user.

---

## 5. Technical Plan

**Surfaces:**

- Extension host only. **No webview changes, so the document-sync loop is not touched at all** —
  this is the main reason the design is low-risk against `common-pitfalls.md`.

**Key changes:**

- `src/features/reclaimTextEditors.ts` – new. The watcher, the association resolver, and the
  source-view-intent registry.
- `src/extension.ts` – activate the watcher, push its disposable.
- `src/editor/MarkdownEditorProvider.ts` – record a source-view intent at the two places that
  deliberately open markdown as text: the `openSourceView` message handler (both the
  line-targeted `showTextDocument` branch and the `vscode.openWith(…, 'default')` branch) and
  `handleOpenFileAtLocation` (the image-references list opens `.md` files at a line as text).
- `package.json` – the `markdownForHumans.reclaimTextEditors` setting.
- `src/__mocks__/vscode.ts` – add `window.tabGroups` plus the `TabInputText` / `TabInputCustom` /
  `TabInputTextDiff` classes; the mock has none today.
- `src/__tests__/features/reclaimTextEditors.test.ts` – new.

**Architecture notes:**

- **Use `window.tabGroups.onDidChangeTabs`, not `onDidChangeVisibleTextEditors`.** The tab API
  reports each tab's *input type*, so "is this a diff?" and "is this already a custom editor?" are
  answered by `instanceof TabInputTextDiff` / `TabInputCustom` rather than by inference. It also
  fires for background tabs, and it gives a `closed` list, which is what expires a source-view
  intent. Available since 1.67; the manifest requires ^1.85.0.
- **No reentrancy risk by construction:** our own reopen produces a `TabInputCustom`, which the
  watcher ignores. The one path that produces a `TabInputText` for a markdown file from inside
  this extension is the deliberate source view, and that is exactly what the intent registry
  covers.
- **Setting `markdownForHumans.reclaimTextEditors`: `auto` (default) | `always` | `never`.**
  `auto` reclaims only when the user's own `workbench.editorAssociations` already resolves this
  file to `markdownForHumans.editor`. That is the principled default: we only take over files the
  user has *already told VS Code* they want here, so this cannot surprise anyone who has not opted
  in, and it needs no new opt-in of its own for those who have.
- **`auto` asks one boolean question, and reads it almost literally out of the config:** *is this
  extension the user's declared default for markdown generally?* An entry in
  `workbench.editorAssociations` counts when its value is `markdownForHumans.editor` **and** its
  pattern is unscoped — `*.md`, `*.markdown`, `**/*.md`, `**/*.markdown`, with no `{scheme}:`
  prefix and no folder scoping.
- **This deliberately replaces an earlier design that glob-matched each URI against the
  association map with specificity ordering.** That version would have been ~60 lines
  reimplementing VS Code's editor-resolver semantics *approximately* — still wrong at the edges,
  just wrong with more code to maintain. The boolean form is ~10 lines and gets three things for
  free: the common `"{git}:/**/*.md": "default"` entry is simply irrelevant (it doesn't name our
  viewType, and git-scheme tabs are excluded by the scheme guard, where that concern belongs); a
  folder-scoped `"docs/*.md"` association correctly does *not* read as "default for everything";
  and an unparseable config degrades to "don't reclaim" rather than to a wrong takeover.
  `always` is the escape hatch for scoped or exotic associations.
- **Reclaim is deferred by one short timer (~150 ms).** `showTextDocument(uri)` resolves *before*
  callers apply their `revealRange`, so reading the cursor line at tab-open time would race and
  usually yield line 1. The delay lets the opener finish positioning, then the line is read from
  the live `TextEditor` and handed to `openRenderedMarkdown`. Reuses the same
  queue-then-reveal mechanism the existing source-position-jump feature already relies on.
- The text tab is closed explicitly via `window.tabGroups.close(tab)` after the rendered editor
  opens, rather than relying on same-group replacement, which VS Code does not guarantee.

**Performance considerations:**

- Not on the typing path; the webview is untouched, so the <16ms typing and <500ms init budgets
  are unaffected.
- Per tab-open cost is a config read plus a handful of regex tests — microseconds, on an event
  that fires at human frequency.
- The one added latency is the deliberate ~150 ms defer before the swap, inside the <500ms
  interaction budget and overlapping the rendered editor's own startup.

---

## 6. Work Breakdown

- [x] **Phase 1: Association check** – is MfH the user's declared default markdown editor?
  - [x] `isDefaultMarkdownEditor()` — unscoped-pattern test over `workbench.editorAssociations`
  - [x] Unit tests: bare `*.md`, `**/*.md`, `{git}:`-prefixed (ignored), folder-scoped
        `docs/*.md` (ignored), value `default` (ignored), empty/missing config
- [x] **Phase 2: Source-view intent registry** – so the feature never fights itself
  - [x] `markSourceViewIntent(uri)` / `hasSourceViewIntent(uri)` / clear-on-tab-close
  - [x] Wire the three deliberate call sites in `MarkdownEditorProvider`
- [x] **Phase 3: The watcher** – `onDidChangeTabs` → guards → deferred reclaim
  - [x] Guards: input type, scheme, extension, dirty, intent, recently-reclaimed
  - [x] Line capture + `openRenderedMarkdown` + close the text tab
- [x] **Phase 4: Setting** – `package.json` contribution, read through the resolver
- [x] **Testing**
  - [x] Extend the vscode mock with `tabGroups` and the three `TabInput` classes
  - [x] Unit tests for every guard, each proving a *non*-reclaim case as well as the happy path
  - [x] Manual checklist in the Extension Development Host:
        chat-sidebar link with `#L42` · Explorer open (unchanged) · split source view ·
        `openSourceAtCursor` · git diff of a `.md` · dirty raw file · `never` setting ·
        a `.md` link from inside the rendered view (existing #23 behavior, must not regress)

---

## 7. Implementation Log

### 2026-08-10 – Feature complete, gate green

- **What:** All four phases implemented TDD-first. 41 new tests; suite went 1040 → 1081 passing,
  80 suites, lint clean at `--max-warnings 0`, both builds clean.
- **Files:** `src/features/reclaimTextEditors.ts` (new), `src/extension.ts`,
  `src/editor/MarkdownEditorProvider.ts` (3 intent call sites), `package.json` (setting +
  activation event), `src/__mocks__/vscode.ts` (tab API), `src/__tests__/features/reclaimTextEditors.test.ts` (new).
- **Notes:** Two things surfaced during implementation that the plan had not anticipated —
  both recorded as decisions below: the cold-start activation gap, and the resulting need for a
  one-shot sweep at activation.

**Cold-start gap (found before commit, would have shipped a half-working feature).** The manifest
declares no `activationEvents`, relying on the ones VS Code auto-generates from contributions:
`onCustomEditor:markdownForHumans.editor`, `onCommand:*`, `onView:markdownForHumansOutline`. None
of those fire when *another* extension opens markdown as plain text. So in a fresh window whose
first action is a chat-sidebar link, the extension is not running, the watcher does not exist, and
the file stays raw — precisely the reported scenario. Fixed by declaring
`"activationEvents": ["onLanguage:markdown"]`, which fires for a markdown document opened in any
editor kind.

---

## 8. Decisions & Tradeoffs

- **Reclaim after the fact, rather than trying to intercept.** VS Code exposes no hook to veto or
  redirect another extension's `showTextDocument`. Reopening after the tab appears is the only
  mechanism available, and its cost is a brief flash of the text editor. Accepted: the alternative
  is not a better implementation, it is no feature.
- **`auto` as the default, not `always`.** Keys the behavior to a preference the user has already
  expressed. Costs nothing for the owner (the association is set) and makes the feature safe to
  upstream, where most installs have not set it.
- **Intent registry over a time-based suppression window.** A timer around the source-view command
  would be a race, and would still fight the user the second time they focused the source tab.
  Tying the intent to the lifetime of the tab makes "I asked for source on this document" a
  durable, observable fact.
- **Tab API over `onDidChangeVisibleTextEditors`.** Diff-editor exclusion becomes structural
  (`TabInputTextDiff`) instead of a heuristic, and tab-close gives the intent registry its
  expiry signal for free.
- **`onLanguage:markdown` activation, accepting a small startup cost.** It activates the extension
  in cases it previously skipped (a user who only ever opens markdown as raw text). That is the
  price of the feature existing at all in a fresh window; activation stays lazy and markdown-only.
- **A one-shot sweep of the focused tab at activation, rather than trusting the event.**
  Even with the activation event, activation is asynchronous relative to the tab-open event, so
  the listener can be registered a beat too late and miss the very tab that woke the extension.
  The sweep closes that race deterministically. Scoped to the active tab of the active group on
  purpose — a wider sweep would rewrite background tabs restored from a previous session, which is
  a different and unrequested behavior.

---

## 9. Follow-up & Future Work

- Report the root cause to `anthropics/claude-code`: `openFile()` should use
  `vscode.open`, which honors editor associations *and* accepts a `selection` in its
  `TextDocumentShowOptions` — the `TextEditor` handle is not actually required.
- Candidate for `/zUpstreamPR` against upstream issue #23, which this completes. The maintainer
  has already signalled interest and there is no competing design to conform to.
- Possible extension to `untitled:` markdown buffers if a real need appears.
