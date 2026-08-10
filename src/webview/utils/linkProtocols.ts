/**
 * Custom URL schemes this editor treats as first-class links.
 *
 * Two different allowlists have to know about them, and only one of them is
 * TipTap's:
 *
 *   1. TipTap's Link mark sanitises hrefs against its own protocol allowlist
 *      (`isAllowedUri`), which is what keeps `[label](vscode://file/…)` from
 *      being stripped as an unknown scheme.
 *   2. linkifyjs, which TipTap uses to *detect* URLs in plain text, compiles a
 *      scanner state machine that only recognises schemes registered before it
 *      is first used.
 *
 * The Link extension tries to cover (2) by calling `registerCustomProtocol` in
 * its `onCreate` hook — but `onCreate` is emitted from a `setTimeout(…, 0)`
 * after the editor mounts, and this editor sets its initial content
 * synchronously right after construction. Any document with more than one block
 * makes TipTap's autolink plugin tokenize that content immediately, which
 * compiles linkify's scanner before `onCreate` ever runs. The registration is
 * then discarded with a console warning ("linkifyjs: already initialized"), and
 * bare `vscode://…` URLs stop autolinking.
 *
 * So we register the schemes ourselves, before the editor exists.
 */

import { init, registerCustomProtocol, reset } from 'linkifyjs';

/** Schemes the editor accepts in hrefs and detects in plain text. */
export const CUSTOM_LINK_PROTOCOLS = ['vscode', 'vscode-insiders'];

/**
 * Teach linkifyjs about {@link CUSTOM_LINK_PROTOCOLS}. Call before creating an
 * editor — and before anything else can tokenize text in this realm.
 *
 * Idempotent, and self-healing if linkify has already been initialised or was
 * reset behind our back (the Link extension calls `reset()` when an editor is
 * destroyed). `registerCustomProtocol` refuses, loudly, once the scanner is
 * compiled, so re-registering means clearing first — safe here because nothing
 * in this bundle registers linkify plugins, only these schemes.
 */
export function registerCustomLinkProtocols(): void {
  const registered = new Set(init().customSchemes.map((entry: [string, boolean]) => entry[0]));
  if (CUSTOM_LINK_PROTOCOLS.every(scheme => registered.has(scheme))) {
    return;
  }

  reset();
  for (const scheme of CUSTOM_LINK_PROTOCOLS) {
    registerCustomProtocol(scheme);
  }
  // Compile now rather than leaving it to whoever tokenizes first — that race
  // is the bug this module exists for.
  init();
}
