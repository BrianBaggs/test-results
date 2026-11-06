import { describe, it, expect } from 'vitest';
import { buildHunk, defaultDiffMode, langFor, plural, safeHref, timeAgo } from '../utils/reviewFormat';
import { file } from './reviewFixtures';

describe('timeAgo', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it.each([
    [5_000, 'just now'],
    [59_000, 'just now'],
    [60_000, '1 minute ago'],
    [5 * 60_000, '5 minutes ago'],
    [3_600_000, '1 hour ago'],
    [3 * 3_600_000, '3 hours ago'],
    [86_400_000, '1 day ago'],
    [3 * 86_400_000, '3 days ago'],
    [7 * 86_400_000, '1 week ago'],
    [21 * 86_400_000, '3 weeks ago'],
    [35 * 86_400_000, '1 month ago'],
    [70 * 86_400_000, '2 months ago'],
  ])('formats %i ms as "%s"', (ms, expected) => {
    expect(timeAgo(ago(ms), now)).toBe(expected);
  });

  it('never shows a negative time for a date slightly in the future', () => {
    expect(timeAgo(new Date(now + 60_000).toISOString(), now)).toBe('just now');
  });

  it('returns an empty string for an invalid date', () => {
    expect(timeAgo('not a date', now)).toBe('');
    expect(timeAgo('', now)).toBe('');
  });

  it('defaults to the current time', () => {
    expect(timeAgo(new Date().toISOString())).toBe('just now');
  });
});

describe('plural', () => {
  it('pluralises', () => {
    expect(plural(0, 'file')).toBe('0 files');
    expect(plural(1, 'file')).toBe('1 file');
    expect(plural(2, 'commit')).toBe('2 commits');
  });
});

describe('langFor', () => {
  it.each([
    ['spec/a.spec.ts', 'typescript'],
    ['src/App.tsx', 'typescript'],
    ['x.js', 'javascript'],
    ['app/models/user.rb', 'ruby'],
    ['config/ci.yml', 'yaml'],
    ['data.json', 'json'],
    ['README.md', 'markdown'],
    ['style.css', 'css'],
    ['run.sh', 'bash'],
    ['UPPER.TS', 'typescript'],
  ])('maps %s to %s', (path, lang) => {
    expect(langFor(path)).toBe(lang);
  });

  it('returns undefined for unknown or extension-less files', () => {
    expect(langFor('Makefile')).toBeUndefined();
    expect(langFor('image.png')).toBeUndefined();
    expect(langFor('dir.with.dots/Dockerfile')).toBeUndefined();
  });
});

describe('buildHunk', () => {
  it('adds ---/+++ headers for a modified file', () => {
    expect(buildHunk(file({ status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' }))).toBe('--- a/spec/recurring.spec.ts\n+++ b/spec/recurring.spec.ts\n@@ -1 +1 @@\n-a\n+b');
  });

  it('uses /dev/null for added and deleted files', () => {
    expect(buildHunk(file({ status: 'added', patch: '@@' }))).toMatch(/^--- \/dev\/null\n\+\+\+ b\/spec\/recurring\.spec\.ts\n/);
    expect(buildHunk(file({ status: 'deleted', patch: '@@' }))).toMatch(/^--- a\/spec\/recurring\.spec\.ts\n\+\+\+ \/dev\/null\n/);
  });

  it('uses the old path for renames', () => {
    expect(buildHunk(file({ status: 'renamed', oldPath: 'old.ts', path: 'new.ts', patch: '@@' }))).toMatch(/^--- a\/old\.ts\n\+\+\+ b\/new\.ts\n/);
  });
});

describe('defaultDiffMode', () => {
  it('shows the unified view on phones and split on wider screens', () => {
    expect(defaultDiffMode(375)).toBe('unified');
    expect(defaultDiffMode(767)).toBe('unified');
    expect(defaultDiffMode(768)).toBe('split');
    expect(defaultDiffMode(1440)).toBe('split');
  });

  it('defaults to the window width', () => {
    expect(defaultDiffMode()).toBe(window.innerWidth < 768 ? 'unified' : 'split');
  });
});

describe('safeHref', () => {
  it('allows only http and https links', () => {
    expect(safeHref('https://securicyapp.atlassian.net/browse/AT-1')).toBe('https://securicyapp.atlassian.net/browse/AT-1');
    expect(safeHref('http://localhost:3000/x')).toBe('http://localhost:3000/x');
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'jav\tascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    'ftp://example.com',
    '//evil.example.com',
    '/relative/path',
    'not a url',
    '',
  ])('refuses %j', (url) => {
    expect(safeHref(url)).toBeUndefined();
  });

  it('refuses null and undefined', () => {
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});
