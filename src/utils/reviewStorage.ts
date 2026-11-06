// Per-session review progress (which files you've viewed). The approval itself lives in Jira.
// Stored in sessionStorage keyed by branch AND commit, so as soon as someone
// pushes new commits the old progress no longer applies. Nothing here is
// persisted beyond the browser session — there is no database by design.

const key = (branch: string, sha: string) => `review-viewed:${branch}@${sha}`;

export function readViewed(branch: string, sha: string): string[] {
  try {
    const raw = sessionStorage.getItem(key(branch, sha));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export function writeViewed(branch: string, sha: string, paths: string[]): void {
  try {
    sessionStorage.setItem(key(branch, sha), JSON.stringify(paths));
  } catch {
    // storage unavailable — progress just won't survive a reload
  }
}
