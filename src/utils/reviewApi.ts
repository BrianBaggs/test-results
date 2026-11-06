import type { GhStatus, MergeResult, ReviewDetail, ReviewList, ReviewStatus } from '@/types/review';

/** An error from the local review API, with the conflicting files if any. */
export class ReviewApiError extends Error {
  details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'ReviewApiError';
    this.details = details;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/review${path}`, init);
  } catch {
    throw new ReviewApiError('Could not reach the local review server. Is the dev server (npm run dev) running?');
  }
  let body: { success?: boolean; data?: T; error?: string; details?: string[] };
  try {
    body = await response.json();
  } catch {
    // The Review API only exists in the dev server; anything else answers with HTML.
    throw new ReviewApiError('The review API is not available here. Run the app with `npm run dev`.');
  }
  if (!response.ok || !body.success) {
    throw new ReviewApiError(body.error || `Request failed (${response.status}).`, body.details ?? []);
  }
  return body.data as T;
}

export const fetchReviewStatus = () => call<ReviewStatus>('/status');

export const fetchGhStatus = () => call<GhStatus>('/gh');

export const fetchReviewList = () => call<ReviewList>('/list');

export const fetchReviewDetail = (branch: string) => call<ReviewDetail>(`/detail?branch=${encodeURIComponent(branch)}`);

/** `approved: true` is required by the type and by the server: nothing merges unapproved. */
export const mergeReview = (input: { branch: string; expectedSha: string; moveToDone: boolean; approved: true }) =>
  call<MergeResult>('/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
