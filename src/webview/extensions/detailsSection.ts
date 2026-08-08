/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import type {
  JSONContent,
  MarkdownParseHelpers,
  MarkdownRendererHelpers,
  MarkdownToken,
  RenderContext,
} from '@tiptap/core';
import { normalizeBlankLineGreedyTokens } from '../utils/markedLexerNormalizer';

/**
 * Collapsible sections backed by the GitHub-flavored `<details>`/`<summary>`
 * HTML idiom.
 *
 * Marked ends an HTML block at the first blank line, so a details block whose
 * body is markdown
 *
 *     <details>
 *     <summary>Title</summary>
 *
 *     Body with **markdown**.
 *
 *     </details>
 *
 * arrives as an `html` fragment (`<details>…</summary>`), loose markdown
 * tokens for the body, and a closing `</details>` fragment. The default HTML
 * fallback parses each fragment in isolation: the DOM parser drops the
 * unknown wrapper tags and the collapsible structure is silently destroyed on
 * the next save.
 *
 * `installDetailsBlockMerger` re-joins such a run into ONE `html` token and
 * attaches the pre-parsed pieces (summary inline tokens, body block tokens)
 * so `DetailsSection.parseMarkdown` can rebuild a real node with the body
 * parsed as markdown. It must be installed BEFORE the blank-line lexer
 * normalizer, whose scaffolding filter would otherwise discard the bare
 * `</details>` fragment the merger needs to find the end of the block.
 */

type RawToken = { type?: string; raw?: string; text?: string } & Record<string, unknown>;
type LexFn = (src: string) => RawToken[];

interface DetailsTokenInfo {
  open: boolean;
  /** Inline tokens of the summary; null when the source has no `<summary>`. */
  summaryTokens: RawToken[] | null;
  bodyTokens: RawToken[];
  /** Content that followed `</details>` inside the same html token. */
  trailingTokens: RawToken[];
}

const DETAILS_TOKEN_KEY = '_mdhDetails';
const OPENING_DETAILS = /^\s*<details\b[^>]*>/i;
const DETAILS_TAG = /<(\/?)details\b[^>]*>/gi;
const SUMMARY_OPEN = /^\s*<summary\b[^>]*>/i;
const SUMMARY_CLOSE = /<\/summary\s*>/i;

/**
 * Blank out comments so their content cannot skew tag scanning. The
 * replacement preserves string length, so match indices found on the blanked
 * copy stay valid on the original raw text.
 */
function blankComments(html: string): string {
  return html.replace(/<!--[\s\S]*?(?:-->|$)/g, match => ' '.repeat(match.length));
}

function tokenRaw(token: RawToken): string {
  return typeof token.raw === 'string' ? token.raw : '';
}

/**
 * Lex a summary's inner text and return its inline tokens. Routed through the
 * block lexer so the summary passes the same pipeline as any paragraph.
 */
function lexSummaryInline(src: string, lex: LexFn): RawToken[] {
  if (!src) return [];
  const tokens = lex(src);
  const paragraph = tokens.find(t => t && t.type === 'paragraph');
  const inline = paragraph && (paragraph as { tokens?: RawToken[] }).tokens;
  if (Array.isArray(inline)) return inline;
  return [{ type: 'text', raw: src, text: src } as RawToken];
}

/**
 * Split a balanced `<details>…</details>` raw string into its parts and lex
 * the body (and any trailing content) as markdown. Returns null when the raw
 * text has no balanced details block, so callers can fall back to marked's
 * own tokens.
 */
function parseDetailsRaw(raw: string, lex: LexFn): DetailsTokenInfo | null {
  const scannable = blankComments(raw);
  const openMatch = /<details\b([^>]*)>/i.exec(scannable);
  if (!openMatch) return null;

  const openEnd = openMatch.index + openMatch[0].length;
  const open = /(?:^|\s)open(?:\s|=|$)/i.test(openMatch[1] ?? '');

  DETAILS_TAG.lastIndex = openEnd;
  let depth = 1;
  let closeStart = -1;
  let closeEnd = -1;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = DETAILS_TAG.exec(scannable)) !== null) {
    depth += tagMatch[1] === '/' ? -1 : 1;
    if (depth === 0) {
      closeStart = tagMatch.index;
      closeEnd = tagMatch.index + tagMatch[0].length;
      break;
    }
  }
  if (closeStart === -1) return null;

  let inner = raw.slice(openEnd, closeStart);
  const innerScannable = scannable.slice(openEnd, closeStart);

  let summaryTokens: RawToken[] | null = null;
  const summaryOpen = SUMMARY_OPEN.exec(innerScannable);
  if (summaryOpen) {
    const summaryClose = SUMMARY_CLOSE.exec(innerScannable);
    if (summaryClose && summaryClose.index >= summaryOpen[0].length) {
      const summaryRaw = inner.slice(summaryOpen[0].length, summaryClose.index);
      summaryTokens = lexSummaryInline(summaryRaw.trim(), lex);
      inner = inner.slice(summaryClose.index + summaryClose[0].length);
    }
  }

  const bodyRaw = inner.trim();
  const trailingRaw = raw.slice(closeEnd).trim();

  return {
    open,
    summaryTokens,
    bodyTokens: bodyRaw ? lex(`${bodyRaw}\n`) : [],
    trailingTokens: trailingRaw ? lex(`${trailingRaw}\n`) : [],
  };
}

/**
 * Re-join the token run of a `<details>` block that marked split at blank
 * lines into a single tagged `html` token.
 *
 * Only `html` tokens are scanned for details tags, so a literal `</details>`
 * inside a fenced code block in the body cannot end the region. If the block
 * never closes, the original tokens are left untouched — this pass can never
 * make a document worse than marked's own output.
 */
export function mergeDetailsBlocks(tokens: RawToken[], lex: LexFn): RawToken[] {
  const out: RawToken[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (!token || token.type !== 'html' || !OPENING_DETAILS.test(blankComments(tokenRaw(token)))) {
      out.push(token);
      continue;
    }

    let depth = 0;
    let end = -1;
    for (let j = i; j < tokens.length; j++) {
      const candidate = tokens[j];
      if (candidate && candidate.type === 'html') {
        const scannable = blankComments(tokenRaw(candidate));
        DETAILS_TAG.lastIndex = 0;
        let tagMatch: RegExpExecArray | null;
        while ((tagMatch = DETAILS_TAG.exec(scannable)) !== null) {
          depth += tagMatch[1] === '/' ? -1 : 1;
          if (depth === 0) break;
        }
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }

    if (end === -1) {
      out.push(token);
      continue;
    }

    const combined = tokens
      .slice(i, end + 1)
      .map(tokenRaw)
      .join('');
    const info = parseDetailsRaw(combined, lex);
    if (!info) {
      out.push(token);
      continue;
    }

    out.push({
      ...token,
      raw: combined,
      text: combined,
      [DETAILS_TOKEN_KEY]: info,
    } as RawToken);
    i = end;
  }

  return out;
}

/**
 * Wrap a marked instance's `lexer` so details runs are merged before any
 * other processing. Install BEFORE `installBlankLineLexerNormalizer` — its
 * scaffolding filter drops bare `</details>` fragments, after which the end
 * of a split block can no longer be found. Idempotent per instance.
 */
export function installDetailsBlockMerger(markedInstance: unknown): void {
  const inst = markedInstance as {
    lexer?: (src: string, options?: unknown) => RawToken[];
    __mdhDetailsMergerInstalled?: boolean;
  };
  if (!inst || typeof inst.lexer !== 'function') return;
  if (inst.__mdhDetailsMergerInstalled) return;

  const original = inst.lexer.bind(inst);
  // Nested bodies get the full treatment the top level gets: details merging
  // first, then the blank-line normalization the outer pipeline would apply.
  const recursiveLex: LexFn = src =>
    normalizeBlankLineGreedyTokens(mergeDetailsBlocks(original(src), recursiveLex));
  inst.lexer = function patchedLexer(src: string, options?: unknown): RawToken[] {
    return mergeDetailsBlocks(original(src, options), recursiveLex);
  };
  inst.__mdhDetailsMergerInstalled = true;
}

/** The clickable title row of a collapsible section. */
export const DetailsSummary = Node.create({
  name: 'detailsSummary',

  content: 'inline*',

  defining: true,

  selectable: false,

  parseHTML() {
    return [{ tag: 'summary' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['summary', mergeAttributes(HTMLAttributes, { class: 'details-summary' }), 0];
  },

  renderMarkdown: ((node: JSONContent, helpers: MarkdownRendererHelpers) => {
    if (node.type !== 'detailsSummary') return null;
    return helpers.renderChildren(node.content || [], '');
  }) as unknown as (
    node: JSONContent,
    helpers: MarkdownRendererHelpers,
    ctx: RenderContext
  ) => string,
});

/** Collapsible `<details>` section; first child is the summary row. */
export const DetailsSection = Node.create({
  name: 'detailsSection',

  group: 'block',

  content: 'detailsSummary block+',

  defining: true,

  isolating: true,

  addAttributes() {
    return {
      open: {
        default: false,
        parseHTML: element => element.hasAttribute('open'),
        renderHTML: attributes => (attributes.open ? { open: '' } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'details' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['details', mergeAttributes(HTMLAttributes, { class: 'details-section' }), 0];
  },

  markdownTokenName: 'html',

  parseMarkdown: ((token: MarkdownToken, helpers: MarkdownParseHelpers) => {
    const info = (token as unknown as Record<string, unknown>)[DETAILS_TOKEN_KEY] as
      DetailsTokenInfo | undefined;
    // Not a merged details block — return nothing so the default HTML
    // fallback (and any other html handler) still runs.
    if (!info) return [];

    const parseInline = (
      helpers as unknown as { parseInline?: (tokens: RawToken[]) => JSONContent[] }
    ).parseInline;
    const summaryContent =
      info.summaryTokens && typeof parseInline === 'function'
        ? parseInline(info.summaryTokens)
        : [];
    const summaryNode = helpers.createNode('detailsSummary', {}, summaryContent);

    const bodyNodes = helpers.parseChildren(info.bodyTokens as unknown as MarkdownToken[]);
    const body = bodyNodes.length > 0 ? bodyNodes : [helpers.createNode('paragraph', {}, [])];

    const sectionNode = helpers.createNode('detailsSection', { open: info.open }, [
      summaryNode,
      ...body,
    ]);

    const trailing =
      info.trailingTokens.length > 0
        ? helpers.parseChildren(info.trailingTokens as unknown as MarkdownToken[])
        : [];
    return [sectionNode, ...trailing];
  }) as unknown as (token: MarkdownToken, helpers: MarkdownParseHelpers) => JSONContent[],

  renderMarkdown: ((node: JSONContent, helpers: MarkdownRendererHelpers) => {
    if (node.type !== 'detailsSection') return null;

    const children = Array.isArray(node.content) ? node.content : [];
    const summaryNode = children[0]?.type === 'detailsSummary' ? children[0] : null;
    const bodyNodes = summaryNode ? children.slice(1) : children;

    const summary = summaryNode ? helpers.renderChildren(summaryNode.content || [], '').trim() : '';

    // Join body blocks the way the doc-level serializer does: '\n\n' between
    // blocks, plus one extra '\n' per empty paragraph (intentional blank
    // line). A plain join would emit two separators around each blank.
    let body = '';
    let pendingBlanks = 0;
    for (const child of bodyNodes) {
      const rendered = helpers.renderChildren([child], '').trim();
      if (rendered === '') {
        pendingBlanks++;
        continue;
      }
      if (body !== '') {
        body += '\n\n' + '\n'.repeat(pendingBlanks);
      }
      body += rendered;
      pendingBlanks = 0;
    }

    const lines: string[] = [node.attrs?.open ? '<details open>' : '<details>'];
    // An empty summary is omitted rather than serialized as `<summary></summary>`,
    // so a source without one never gains an invented element.
    if (summary) lines.push(`<summary>${summary}</summary>`);
    if (body) lines.push('', body, '');
    lines.push('</details>');
    return lines.join('\n');
  }) as unknown as (
    node: JSONContent,
    helpers: MarkdownRendererHelpers,
    ctx: RenderContext
  ) => string,
});
