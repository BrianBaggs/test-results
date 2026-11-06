import { describe, it, expect, vi, afterEach } from 'vitest';
import { ReviewApiError, fetchGhStatus, fetchReviewDetail, fetchReviewList, fetchReviewStatus, mergeReview } from '../utils/reviewApi';

const respond = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reviewApi', () => {
  it('fetchReviewList unwraps the data envelope', async () => {
    const fetchMock = respond(200, { success: true, data: { tickets: [], baseBranch: 'playwright-main' } });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchReviewList()).resolves.toEqual({ tickets: [], baseBranch: 'playwright-main' });
    expect(fetchMock).toHaveBeenCalledWith('/api/review/list', undefined);
  });

  it('fetchReviewStatus and fetchGhStatus hit their own endpoints', async () => {
    const fetchMock = respond(200, { success: true, data: { ok: true, state: 'ready' } });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchReviewStatus()).resolves.toMatchObject({ ok: true });
    await expect(fetchGhStatus()).resolves.toMatchObject({ state: 'ready' });

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/review/status', '/api/review/gh']);
  });

  it('fetchReviewDetail encodes the branch name in the query string', async () => {
    const fetchMock = respond(200, { success: true, data: { branch: 'AT-1-x' } });
    vi.stubGlobal('fetch', fetchMock);

    await fetchReviewDetail('AT-1-a b&c=d');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/review/detail?branch=AT-1-a%20b%26c%3Dd');
  });

  it('mergeReview POSTs JSON with exactly the reviewed sha', async () => {
    const fetchMock = respond(200, { success: true, data: { merged: 1 } });
    vi.stubGlobal('fetch', fetchMock);

    await mergeReview({ branch: 'AT-1-x', expectedSha: 'abc1234', moveToDone: true, approved: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/review/merge');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ branch: 'AT-1-x', expectedSha: 'abc1234', moveToDone: true, approved: true });
  });

  it('turns an error envelope into a ReviewApiError, keeping the conflicting files', async () => {
    vi.stubGlobal('fetch', respond(409, { success: false, error: 'hit conflicts', details: ['a.txt', 'b.txt'] }));

    const err = await mergeReview({ branch: 'AT-1-x', expectedSha: 'abc1234', moveToDone: false, approved: true }).catch((e) => e);

    expect(err).toBeInstanceOf(ReviewApiError);
    expect(err.message).toBe('hit conflicts');
    expect(err.details).toEqual(['a.txt', 'b.txt']);
  });

  it('falls back to a generic message when the server gives none', async () => {
    vi.stubGlobal('fetch', respond(500, { success: false }));
    await expect(fetchReviewList()).rejects.toThrow('Request failed (500).');
  });

  it('treats success:false on a 200 as an error', async () => {
    vi.stubGlobal('fetch', respond(200, { success: false, error: 'nope' }));
    const err = await fetchReviewList().catch((e) => e);
    expect(err.message).toBe('nope');
    expect(err.details).toEqual([]);
  });

  it('explains when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchReviewList()).rejects.toThrow(/Is the dev server .* running\?/);
  });

  it('explains when the response is not JSON (e.g. a static build with no API)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('Unexpected token <')) }));
    await expect(fetchReviewList()).rejects.toThrow(/npm run dev/);
  });
});
