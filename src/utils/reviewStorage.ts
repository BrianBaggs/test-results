// Per-session review progress (which files you've viewed, whether you approved).
// Stored in sessionStorage keyed by branch AND commit, so as soon as someone
// pushes new commits the old progress no longer applies. Nothing here is
// persisted beyond the browser session — there is no database by design.

const key = (kind: 'approved' | 'viewed', branch: string, sha: string) => `review-${kind}:${branch}@${sha}`;

export function readApproved(branch: string, sha: string): boolean {
  try {
    return sessionStorage.getItem(key('approved', branch, sha)) === '1';
  } catch {
    return false;
  }
}

export function writeApproved(branch: string, sha: string, approved: boolean): void {
  try {
    if (approved) sessionStorage.setItem(key('approved', branch, sha), '1');
    else sessionStorage.removeItem(key('approved', branch, sha));
  } catch {
    // storage unavailable — approval just won't survive a reload
  }
}

export function readViewed(branch: string, sha: string): string[] {
  try {
    const raw = sessionStorage.getItem(key('viewed', branch, sha));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export function writeViewed(branch: string, sha: string, paths: string[]): void {
  try {
    sessionStorage.setItem(key('viewed', branch, sha), JSON.stringify(paths));
  } catch {
    // storage unavailable — progress just won't survive a reload
  }
}
