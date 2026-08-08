/**
 * Link classification and external-scheme policy.
 *
 * Regression context: `vscode://file/<path>:<line>` links did nothing in the
 * editor. The webview dispatcher only recognized http/https/mailto as
 * external, so a vscode: URL fell through to the FILE-link path, where the
 * host resolved it as a relative filesystem path and failed the existence
 * check. The dispatcher now routes any scheme-qualified URL to the external
 * channel, and the host enforces an explicit scheme allowlist.
 */

import { classifyLinkHref } from '../../webview/utils/linkDispatch';
import {
  getUrlScheme,
  isAllowedExternalUrl,
  ALLOWED_EXTERNAL_LINK_SCHEMES,
} from '../../shared/linkSchemes';

describe('classifyLinkHref', () => {
  it.each([
    ['https://example.com', 'external'],
    ['http://example.com/page.md', 'external'],
    ['mailto:someone@example.com', 'external'],
    ['vscode://file/c:/Users/me/AppData/Roaming/Code/User/settings.json:79', 'external'],
    ['vscode-insiders://file/c:/tmp/a.md', 'external'],
    ['ftp://server/file.txt', 'external'],
    ['javascript:alert(1)', 'external'], // routed, then BLOCKED by the host allowlist
    ['#some-heading', 'anchor'],
    ['images/shot.png', 'image'],
    ['./diagram.SVG', 'image'],
    ['docs/other.md', 'file'],
    ['./relative.md', 'file'],
    ['../up/notes.md', 'file'],
    ['c:/Users/me/notes.md', 'file'], // Windows drive prefix is a path, not a scheme
    ['C:\\Users\\me\\notes.md', 'file'],
  ] as const)('classifies %s as %s', (href, expected) => {
    expect(classifyLinkHref(href)).toBe(expected);
  });
});

describe('getUrlScheme', () => {
  it('extracts schemes case-insensitively', () => {
    expect(getUrlScheme('HTTPS://x')).toBe('https');
    expect(getUrlScheme('vscode://file/c:/x.md:12')).toBe('vscode');
  });

  it('treats Windows drive prefixes as pathless', () => {
    expect(getUrlScheme('c:/notes.md')).toBeNull();
    expect(getUrlScheme('C:\\notes.md')).toBeNull();
  });

  it('returns null for schemeless hrefs', () => {
    expect(getUrlScheme('docs/other.md')).toBeNull();
    expect(getUrlScheme('#anchor')).toBeNull();
  });
});

describe('isAllowedExternalUrl', () => {
  it('allows the editor protocol with a file/line target', () => {
    expect(
      isAllowedExternalUrl('vscode://file/c:/Users/me/AppData/Roaming/Code/User/settings.json:79')
    ).toBe(true);
  });

  it('allows http, https and mailto', () => {
    expect(isAllowedExternalUrl('https://example.com')).toBe(true);
    expect(isAllowedExternalUrl('http://example.com')).toBe(true);
    expect(isAllowedExternalUrl('mailto:a@b.c')).toBe(true);
  });

  it('blocks script-ish and unknown schemes', () => {
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalUrl('data:text/html,<b>x</b>')).toBe(false);
    expect(isAllowedExternalUrl('ftp://server/file')).toBe(false);
  });

  it('blocks plain paths', () => {
    expect(isAllowedExternalUrl('docs/other.md')).toBe(false);
    expect(isAllowedExternalUrl('c:/notes.md')).toBe(false);
  });

  it('documents the allowlist', () => {
    expect([...ALLOWED_EXTERNAL_LINK_SCHEMES].sort()).toEqual([
      'http',
      'https',
      'mailto',
      'vscode',
      'vscode-insiders',
    ]);
  });
});
