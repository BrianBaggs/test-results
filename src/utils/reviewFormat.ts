// Pure helpers for the Review tab.

import type { ReviewFile } from '@/types/review';

export type DiffMode = 'split' | 'unified';

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const units: Array<[number, string]> = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
    [2629800, 'month'],
  ];
  let best: [number, string] = units[0];
  for (const u of units) if (s >= u[0]) best = u;
  const n = Math.floor(s / best[0]);
  return `${n} ${best[1]}${n === 1 ? '' : 's'} ago`;
}

const LANGS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  rb: 'ruby',
  yml: 'yaml',
  yaml: 'yaml',
  json: 'json',
  md: 'markdown',
  css: 'css',
  scss: 'scss',
  html: 'xml',
  erb: 'erb',
  sh: 'bash',
  py: 'python',
  sql: 'sql',
  csv: 'plaintext',
};

/** Syntax-highlighting language for a file name, or undefined if unknown. */
export function langFor(path: string): string | undefined {
  const ext = path.split('/').pop()?.split('.').pop()?.toLowerCase();
  return ext && path.includes('.') ? LANGS[ext] : undefined;
}

/**
 * The per-file unified diff the viewer expects: ---/+++ headers followed by
 * the hunks the server sent.
 */
export function buildHunk(file: ReviewFile): string {
  const from = file.status === 'added' ? '/dev/null' : `a/${file.oldPath ?? file.path}`;
  const to = file.status === 'deleted' ? '/dev/null' : `b/${file.path}`;
  return `--- ${from}\n+++ ${to}\n${file.patch}`;
}

/** Split view needs room; phones get the unified view by default. */
export function defaultDiffMode(width: number = typeof window === 'undefined' ? 1024 : window.innerWidth): DiffMode {
  return width < 768 ? 'unified' : 'split';
}

/**
 * Only plain web links are ever rendered as links. Anything else (javascript:,
 * data:, file:, malformed) becomes undefined so the UI shows plain text.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}
