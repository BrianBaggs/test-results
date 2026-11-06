import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { MAX_BODY_BYTES, checkRequestOrigin, createReviewHandler, exposedServerHandler, isLoopbackBind, reviewPlugin, securityHeaders } from './reviewPlugin';
import { ReviewError } from './reviewGit';
import { GitGuardError } from './gitGuard';
import { AcliError } from './acli';
import type { ReviewService } from './reviewGit';

function req(opts: { method?: string; url?: string; host?: string; origin?: string; contentType?: string; body?: string; site?: string }): IncomingMessage {
  const headers: Record<string, string> = { host: opts.host ?? 'localhost:5173' };
  if (opts.origin) headers.origin = opts.origin;
  if (opts.site) headers['sec-fetch-site'] = opts.site;
  if (opts.contentType) headers['content-type'] = opts.contentType;
  const r = {
    method: opts.method ?? 'GET',
    url: opts.url ?? '/status',
    headers,
    on(event: string, cb: (arg?: unknown) => void) {
      if (event === 'data' && opts.body !== undefined) cb(Buffer.from(opts.body));
      if (event === 'end') cb();
      return r;
    },
  };
  return r as unknown as IncomingMessage;
}

function res() {
  const out = { statusCode: 200, headers: {} as Record<string, string>, body: '' };
  const r = {
    get statusCode() {
      return out.statusCode;
    },
    set statusCode(v: number) {
      out.statusCode = v;
    },
    setHeader: (k: string, v: string) => {
      out.headers[k] = v;
    },
    end: (b?: string) => {
      out.body = b ?? '';
    },
  };
  return { raw: r as unknown as ServerResponse, out, json: () => JSON.parse(out.body) };
}

function service(overrides: Partial<ReviewService> = {}): ReviewService {
  return {
    status: vi.fn().mockResolvedValue({ ok: true }),
    ghStatus: vi.fn().mockResolvedValue({ state: 'ready', account: 'BrianBaggs' }),
    list: vi.fn().mockResolvedValue({ tickets: [] }),
    detail: vi.fn().mockResolvedValue({ branch: 'AT-1-x' }),
    merge: vi.fn().mockResolvedValue({ merged: 1 }),
    ...overrides,
  } as unknown as ReviewService;
}

const jsonPost = (body: unknown, extra: Partial<Parameters<typeof req>[0]> = {}) =>
  req({ method: 'POST', url: '/merge', contentType: 'application/json', body: JSON.stringify(body), ...extra });

describe('checkRequestOrigin', () => {
  it('accepts loopback hosts', () => {
    for (const host of ['localhost:5173', '127.0.0.1:3000', '[::1]:5173', 'localhost']) {
      expect(checkRequestOrigin(req({ host }))).toBeNull();
    }
  });

  it('rejects other hosts (DNS rebinding / network exposure)', () => {
    for (const host of ['evil.example.com', '192.168.1.20:5173', 'localhost.evil.com:5173', '']) {
      expect(checkRequestOrigin(req({ host }))).toMatch(/only accepts requests to localhost/);
    }
  });

  it('requires JSON and a matching Origin for POST', () => {
    expect(checkRequestOrigin(req({ method: 'POST', contentType: 'text/plain' }))).toMatch(/application\/json/);
    expect(checkRequestOrigin(req({ method: 'POST' }))).toMatch(/application\/json/);
    expect(checkRequestOrigin(req({ method: 'POST', contentType: 'application/json', origin: 'https://evil.com' }))).toMatch(/Cross-origin/);
    expect(checkRequestOrigin(req({ method: 'POST', contentType: 'application/json', origin: 'not a url' }))).toMatch(/Invalid Origin/);
    expect(checkRequestOrigin(req({ method: 'POST', contentType: 'application/json; charset=utf-8', origin: 'http://localhost:5173' }))).toBeNull();
    expect(checkRequestOrigin(req({ method: 'POST', contentType: 'application/json' }))).toBeNull();
  });
});

describe('createReviewHandler', () => {
  it('serves the gh status light', async () => {
    const svc = service();
    const r = res();
    await createReviewHandler(svc)(req({ url: '/gh' }), r.raw);
    expect(r.out.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ state: 'ready' });
    const w = res();
    await createReviewHandler(svc)(req({ method: 'DELETE', url: '/gh', contentType: 'application/json' }), w.raw);
    expect(w.out.statusCode).toBe(405);
  });

  it('serves status, list and detail', async () => {
    const svc = service();
    const handler = createReviewHandler(svc);
    for (const [url, fn] of [
      ['/status', 'status'],
      ['/list', 'list'],
      ['/detail?branch=AT-1-x', 'detail'],
    ] as const) {
      const r = res();
      await handler(req({ url }), r.raw);
      expect(r.out.statusCode).toBe(200);
      expect(r.out.headers['Cache-Control']).toBe('no-store');
      expect(r.json().success).toBe(true);
      expect(svc[fn]).toHaveBeenCalled();
    }
    expect(svc.detail).toHaveBeenCalledWith('AT-1-x');
  });

  it('merges with only the whitelisted fields', async () => {
    const svc = service();
    const r = res();
    await createReviewHandler(svc)(jsonPost({ branch: 'AT-1-x', expectedSha: 'abc1234', approved: true, deleteBranch: true, moveToDone: true, baseBranch: 'master', evil: 1 }), r.raw);
    expect(r.out.statusCode).toBe(200);
    expect(svc.merge).toHaveBeenCalledExactlyOnceWith({ branch: 'AT-1-x', expectedSha: 'abc1234', moveToDone: true });
  });

  it('rejects foreign hosts and cross-origin posts before touching the service', async () => {
    const svc = service();
    const handler = createReviewHandler(svc);
    const a = res();
    await handler(req({ host: 'evil.com' }), a.raw);
    expect(a.out.statusCode).toBe(403);
    const b = res();
    await handler(jsonPost({ branch: 'AT-1-x' }, { origin: 'https://evil.com' }), b.raw);
    expect(b.out.statusCode).toBe(403);
    expect(svc.status).not.toHaveBeenCalled();
    expect(svc.merge).not.toHaveBeenCalled();
  });

  it('answers 400 for a bad body, 405 for the wrong verb and 404 for unknown routes', async () => {
    const svc = service();
    const handler = createReviewHandler(svc);
    for (const body of ['not json', '[]', 'null']) {
      const r = res();
      await handler(req({ method: 'POST', url: '/merge', contentType: 'application/json', body }), r.raw);
      expect(r.out.statusCode).toBe(400);
    }
    const m = res();
    await handler(req({ method: 'DELETE', url: '/merge', contentType: 'application/json' }), m.raw);
    expect(m.out.statusCode).toBe(405);
    const g = res();
    await handler(req({ url: '/merge' }), g.raw);
    expect(g.out.statusCode).toBe(405);
    const n = res();
    await handler(req({ url: '/nope' }), n.raw);
    expect(n.out.statusCode).toBe(404);
    expect(svc.merge).not.toHaveBeenCalled();
  });

  it('passes ReviewError status and details through, and hides nothing else behind 500', async () => {
    const r1 = res();
    await createReviewHandler(service({ merge: vi.fn().mockRejectedValue(new ReviewError(409, 'conflicts', ['a.txt'])) }))(jsonPost({ branch: 'AT-1-x', approved: true }), r1.raw);
    expect(r1.out.statusCode).toBe(409);
    expect(r1.json()).toEqual({ success: false, error: 'conflicts', details: ['a.txt'] });

    const r2 = res();
    await createReviewHandler(service({ list: vi.fn().mockRejectedValue(new Error('kaboom')) }))(req({ url: '/list' }), r2.raw);
    expect(r2.out.statusCode).toBe(500);
    expect(r2.json().error).toBe('kaboom');

    const r3 = res();
    await createReviewHandler(service({ list: vi.fn().mockRejectedValue('weird') }))(req({ url: '/list' }), r3.raw);
    expect(r3.json().error).toBe('Unexpected error.');
  });

  it('answers 403 (a deliberate refusal) when a guard rail blocks something', async () => {
    const r1 = res();
    await createReviewHandler(service({ merge: vi.fn().mockRejectedValue(new GitGuardError('"git reset" is not allowed.')) }))(jsonPost({ branch: 'AT-1-x', approved: true }), r1.raw);
    expect(r1.out.statusCode).toBe(403);
    expect(r1.json().error).toMatch(/Blocked by the git guard rail/);

    const r2 = res();
    await createReviewHandler(service({ list: vi.fn().mockRejectedValue(new AcliError('Blocked by the AT-only guard rail: nope', 'blocked')) }))(req({ url: '/list' }), r2.raw);
    expect(r2.out.statusCode).toBe(403);

    // an ordinary acli failure is not a guard refusal
    const r3 = res();
    await createReviewHandler(service({ list: vi.fn().mockRejectedValue(new AcliError('acli is not logged in')) }))(req({ url: '/list' }), r3.raw);
    expect(r3.out.statusCode).toBe(500);
  });

  it('treats a missing url and trailing slashes sanely', async () => {
    const svc = service();
    const r = res();
    await createReviewHandler(svc)(req({ url: '/status/' }), r.raw);
    expect(r.out.statusCode).toBe(200);
    const bare = { method: 'GET', headers: { host: 'localhost' }, on: () => bare } as unknown as IncomingMessage;
    const r2 = res();
    await createReviewHandler(svc)(bare, r2.raw);
    expect(r2.out.statusCode).toBe(404);
  });
});

describe('reviewPlugin', () => {
  function mount(options: Parameters<typeof reviewPlugin>[0], host?: string | boolean) {
    const use = vi.fn();
    const plugin = reviewPlugin(options);
    (plugin.configureServer as (s: unknown) => void)({ middlewares: { use }, config: { server: { host } } });
    return { plugin, use };
  }

  it('mounts the handler at /api/review (with defaults), after the security headers', () => {
    const { plugin, use } = mount({});
    expect(plugin.name).toBe('qa-review');
    expect(use.mock.calls[0][0]).toBe(securityHeaders);
    expect(use).toHaveBeenCalledWith('/api/review', expect.any(Function));
    expect(use.mock.calls[1][1]).not.toBe(exposedServerHandler);
  });

  it.each([true, '0.0.0.0', '192.168.1.20', '::', 'my-laptop.local'])('does NOT expose the review API when the dev server listens on %j', (host) => {
    const { use } = mount({}, host);
    const api = use.mock.calls.find((c) => c[0] === '/api/review')!;
    expect(api[1]).toBe(exposedServerHandler);
  });

  it.each([undefined, false, 'localhost', '127.0.0.1', '::1', 'LOCALHOST'])('serves the review API when the dev server listens on %j', (host) => {
    const { use } = mount({}, host);
    const api = use.mock.calls.find((c) => c[0] === '/api/review')!;
    expect(api[1]).not.toBe(exposedServerHandler);
  });

  it('mounts with explicit settings', () => {
    expect(mount({ repoPath: '~/x', remote: 'o', jira: { reviewStatus: 'Review', doneStatus: 'Completed' } }).use).toHaveBeenCalled();
  });

  it('rejects an unsafe Done status at startup', () => {
    expect(() => mount({ jira: { doneStatus: 'Cancelled' } })).toThrow(/Done or Completed/);
  });
});

describe('security hardening', () => {
  describe('cross-site protection', () => {
    it.each(['cross-site', 'same-site'])('rejects Sec-Fetch-Site: %s (even another localhost port)', (site) => {
      expect(checkRequestOrigin(req({ site }))).toMatch(/Cross-site requests are not allowed/);
      expect(checkRequestOrigin(req({ method: 'POST', contentType: 'application/json', site }))).toMatch(/Cross-site/);
    });

    it.each([undefined, 'same-origin', 'none'])('allows Sec-Fetch-Site: %s', (site) => {
      expect(checkRequestOrigin(req({ site }))).toBeNull();
    });

    it('applies to reads too, so a foreign page cannot trigger fetches or read branch contents', async () => {
      const svc = service();
      const r = res();
      await createReviewHandler(svc)(req({ url: '/detail?branch=AT-1-x', site: 'cross-site' }), r.raw);
      expect(r.out.statusCode).toBe(403);
      expect(svc.detail).not.toHaveBeenCalled();
    });

    it('treats the Host header case-insensitively but still only loopback names', () => {
      expect(checkRequestOrigin(req({ host: 'LocalHost:5173' }))).toBeNull();
      expect(checkRequestOrigin(req({ host: 'LOCALHOST.evil.com' }))).toMatch(/only accepts requests to localhost/);
      expect(checkRequestOrigin(req({ host: '127.0.0.1.nip.io:5173' }))).toMatch(/only accepts requests to localhost/);
      expect(checkRequestOrigin(req({ host: '[::1]:5173' }))).toBeNull();
    });
  });

  describe('merge requires explicit approval', () => {
    it.each([{}, { approved: false }, { approved: 'true' }, { approved: 1 }, { approved: null }])('refuses a merge body with %j and never calls the service', async (extra) => {
      const svc = service();
      const r = res();
      await createReviewHandler(svc)(jsonPost({ branch: 'AT-1-x', expectedSha: 'abc1234', ...extra }), r.raw);
      expect(r.out.statusCode).toBe(400);
      expect(r.json().error).toMatch(/must be approved/);
      expect(svc.merge).not.toHaveBeenCalled();
    });

    it('accepts a merge only with approved === true', async () => {
      const svc = service();
      const r = res();
      await createReviewHandler(svc)(jsonPost({ branch: 'AT-1-x', expectedSha: 'abc1234', approved: true }), r.raw);
      expect(r.out.statusCode).toBe(200);
      expect(svc.merge).toHaveBeenCalledTimes(1);
    });
  });

  describe('request size', () => {
    it('rejects an oversized body with 413 without reading it all or calling the service', async () => {
      const svc = service();
      const r = res();
      const huge = JSON.stringify({ branch: 'AT-1-x', approved: true, junk: 'x'.repeat(MAX_BODY_BYTES + 10) });
      await createReviewHandler(svc)(jsonPost(JSON.parse(huge)), r.raw);
      expect(r.out.statusCode).toBe(413);
      expect(svc.merge).not.toHaveBeenCalled();
    });

    it('accepts a body right under the limit', async () => {
      const svc = service();
      const r = res();
      const pad = 'x'.repeat(MAX_BODY_BYTES - 200);
      await createReviewHandler(svc)(jsonPost({ branch: 'AT-1-x', expectedSha: 'abc1234', approved: true, pad }), r.raw);
      expect(r.out.statusCode).toBe(200);
    });
  });

  describe('response headers', () => {
    it('API responses cannot be embedded, sniffed or read cross-origin', async () => {
      const r = res();
      await createReviewHandler(service())(req({ url: '/status' }), r.raw);
      expect(r.out.headers).toMatchObject({
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Cache-Control': 'no-store',
      });
    });

    it('every dev-server response forbids being framed by other sites (clickjacking) and leaks no referrer', () => {
      const r = res();
      const next = vi.fn();
      securityHeaders(req({}), r.raw, next);
      expect(r.out.headers).toMatchObject({
        'X-Frame-Options': 'SAMEORIGIN',
        'Content-Security-Policy': "frame-ancestors 'self'",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('never exposed on the network', () => {
    it.each([
      [undefined, true],
      [false, true],
      ['localhost', true],
      ['127.0.0.1', true],
      ['::1', true],
      ['[::1]', true],
      [true, false],
      ['0.0.0.0', false],
      ['::', false],
      ['192.168.0.5', false],
      ['example.com', false],
    ])('isLoopbackBind(%j) is %s', (host, expected) => {
      expect(isLoopbackBind(host as string | boolean | undefined)).toBe(expected);
    });

    it('answers 403 to everything when the server is exposed', () => {
      const r = res();
      exposedServerHandler(req({}), r.raw);
      expect(r.out.statusCode).toBe(403);
      expect(r.json().error).toMatch(/exposed beyond this machine/);
    });
  });
});
