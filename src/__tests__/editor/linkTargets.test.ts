/**
 * File-link position targets: #L42 anchors, :42 suffixes, heading slugs, and
 * the vscode://file protocol. Regression context: links like
 * `[settings.json:79](settings.json#L79)` failed because the suffix stayed
 * glued to the filename and the existence check failed.
 */

import { parseFileLinkHref, parseVsCodeFileUrl } from '../../shared/linkTargets';

describe('parseFileLinkHref', () => {
  it('passes plain paths through', () => {
    expect(parseFileLinkHref('docs/other.md')).toEqual({
      path: 'docs/other.md',
      line: undefined,
      column: undefined,
      slug: undefined,
    });
  });

  it('parses GitHub-style line anchors', () => {
    expect(parseFileLinkHref('settings.json#L79').path).toBe('settings.json');
    expect(parseFileLinkHref('settings.json#L79').line).toBe(79);
    expect(parseFileLinkHref('a.md#L42-L50').line).toBe(42);
    expect(parseFileLinkHref('a.md#l7').line).toBe(7);
  });

  it('parses editor-style :line and :line:column suffixes', () => {
    expect(parseFileLinkHref('src/app.ts:42')).toMatchObject({ path: 'src/app.ts', line: 42 });
    expect(parseFileLinkHref('src/app.ts:42:7')).toMatchObject({
      path: 'src/app.ts',
      line: 42,
      column: 7,
    });
  });

  it('never mistakes a Windows drive colon for a line suffix', () => {
    expect(parseFileLinkHref('c:/notes/readme.md')).toMatchObject({
      path: 'c:/notes/readme.md',
      line: undefined,
    });
    expect(parseFileLinkHref('c:/notes/readme.md:12')).toMatchObject({
      path: 'c:/notes/readme.md',
      line: 12,
    });
    expect(parseFileLinkHref('C:\\notes\\readme.md')).toMatchObject({
      path: 'C:\\notes\\readme.md',
      line: undefined,
    });
  });

  it('treats non-line fragments as heading slugs', () => {
    expect(parseFileLinkHref('other.md#my-heading')).toMatchObject({
      path: 'other.md',
      slug: 'my-heading',
    });
    expect(parseFileLinkHref('other.md#my%20heading').slug).toBe('my heading');
  });

  it('handles paths with spaces plus targets', () => {
    expect(parseFileLinkHref('my notes.md#L3')).toMatchObject({ path: 'my notes.md', line: 3 });
  });
});

describe('parseVsCodeFileUrl', () => {
  it('parses path, line, and column', () => {
    expect(
      parseVsCodeFileUrl('vscode://file/c:/Users/me/AppData/Roaming/Code/User/settings.json:79')
    ).toEqual({
      path: 'c:/Users/me/AppData/Roaming/Code/User/settings.json',
      line: 79,
      column: undefined,
    });
    expect(parseVsCodeFileUrl('vscode://file/c:/x/a.ts:12:5')).toMatchObject({
      line: 12,
      column: 5,
    });
  });

  it('handles the /c:/ URL path form and encoded characters', () => {
    expect(parseVsCodeFileUrl('vscode://file//c:/x/a.md')).toMatchObject({ path: 'c:/x/a.md' });
    expect(parseVsCodeFileUrl('vscode://file/c:/my%20docs/a.md:3')).toMatchObject({
      path: 'c:/my docs/a.md',
      line: 3,
    });
  });

  it('accepts vscode-insiders', () => {
    expect(parseVsCodeFileUrl('vscode-insiders://file/c:/x/a.md')).toMatchObject({
      path: 'c:/x/a.md',
    });
  });

  it('returns null for non-file vscode URLs and other schemes', () => {
    expect(parseVsCodeFileUrl('vscode://settings/editor.fontSize')).toBeNull();
    expect(parseVsCodeFileUrl('https://example.com/a.md')).toBeNull();
    expect(parseVsCodeFileUrl('docs/a.md#L4')).toBeNull();
  });
});
