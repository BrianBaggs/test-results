import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import { ALLOWED_PROJECT, createJiraClient } from './acli.ts';
import type { JiraSettings } from './acli.ts';
import { AcliError } from './acli.ts';
import { redactSecrets } from './redact.ts';
import { GitGuardError } from './gitGuard.ts';
import { GhGuardError } from './ghStatus.ts';
import { ReviewError, createReviewService, expandHome } from './reviewGit.ts';
import { OverlayError, recoverStaleOverlays } from './serverOverlay.ts';
import { SpecGuardError } from './specRunner.ts';
import type { ReviewService } from './reviewGit.ts';

export interface ReviewPluginOptions {
  /** Local clone of the repo under review (REVIEW_REPO_PATH). */
  repoPath?: string;
  remote?: string;
  /** The Rails test server's checkout, if it isn't the same as repoPath. */
  serverRepoPath?: string;
  testServerPort?: number;
  jira?: Partial<JiraSettings>;
}

/** Reviewed branches are ALWAYS merged into the QA branch that holds every Playwright spec. */
const QA_BASE_BRANCH = 'playwright-main';

/** Last line of defence: no error text leaves the server with a credential in it. */
function redactErrorBody(body: unknown): unknown {
  if (!body || typeof body !== 'object' || (body as { success?: unknown }).success !== false) return body;
  const b = body as { error?: unknown; details?: unknown };
  return {
    ...b,
    ...(typeof b.error === 'string' ? { error: redactSecrets(b.error) } : {}),
    ...(Array.isArray(b.details) ? { details: b.details.map((d) => (typeof d === 'string' ? redactSecrets(d) : d)) } : {}),
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  // Never let another site embed or sniff these responses.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.end(JSON.stringify(redactErrorBody(body)));
}

/** A merge request is a few hundred bytes; anything bigger is not ours. */
export const MAX_BODY_BYTES = 64 * 1024;

class BodyTooLargeError extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLargeError('Request body is too large.'));
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function hostName(hostHeader: string): string {
  const h = hostHeader.toLowerCase();
  return h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0];
}

/**
 * These routes run git commands and can push to a shared branch, so they're
 * only reachable from a page served by this very machine:
 *  - Host must be a loopback name (blocks DNS-rebinding and `vite --host`
 *    exposure to other machines on the network);
 *  - Sec-Fetch-Site (set by the browser, not forgeable by a page) must say
 *    same-origin / none when present;
 *  - mutating requests must be JSON (forces a CORS preflight a foreign site
 *    can't pass) and, when the browser sends an Origin, it must match Host.
 */
export function checkRequestOrigin(req: IncomingMessage): string | null {
  const host = req.headers.host ?? '';
  if (!LOCAL_HOSTS.has(hostName(host))) return 'The review API only accepts requests to localhost.';
  // Browsers tell us where a request came from and we can't be lied to about
  // it from a web page: only this app's own pages (same-origin) or direct
  // navigation/tools (none / absent) are allowed — never another site, and
  // not even another localhost port ("same-site").
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return 'Cross-site requests are not allowed.';
  if (req.method === 'POST') {
    if (!/^application\/json/i.test(req.headers['content-type'] ?? '')) return 'Request must be application/json.';
    const origin = req.headers.origin;
    if (origin) {
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        return 'Invalid Origin.';
      }
      if (originHost !== host) return 'Cross-origin requests are not allowed.';
    }
  }
  return null;
}

export function createReviewHandler(service: ReviewService) {
  return async function handleReviewRequest(req: IncomingMessage, res: ServerResponse) {
    const denied = checkRequestOrigin(req);
    if (denied) {
      sendJson(res, 403, { success: false, error: denied });
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (req.method === 'GET' && route === '/status') {
        sendJson(res, 200, { success: true, data: await service.status() });
        return;
      }
      if (req.method === 'GET' && route === '/gh') {
        sendJson(res, 200, { success: true, data: await service.ghStatus() });
        return;
      }
      if (req.method === 'GET' && route === '/tests/status') {
        sendJson(res, 200, { success: true, data: await service.testServer() });
        return;
      }
      if (req.method === 'GET' && route === '/tests/job') {
        const since = Number(url.searchParams.get('since') ?? 0);
        sendJson(res, 200, { success: true, data: service.getSpecRun(url.searchParams.get('id'), since) });
        return;
      }
      if (req.method === 'POST' && (route === '/decision' || route === '/tests/run' || route === '/tests/cancel')) {
        let body: Record<string, unknown>;
        try {
          const parsed = JSON.parse(await readBody(req));
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
          body = parsed as Record<string, unknown>;
        } catch (err) {
          if (err instanceof BodyTooLargeError) {
            sendJson(res, 413, { success: false, error: err.message });
            return;
          }
          sendJson(res, 400, { success: false, error: 'Request body must be a JSON object.' });
          return;
        }
        if (route === '/decision') {
          sendJson(res, 200, { success: true, data: await service.submitReview({ branch: body.branch, expectedSha: body.expectedSha, decision: body.decision, info: body.info }) });
        } else if (route === '/tests/run') {
          sendJson(res, 200, { success: true, data: await service.startSpecRun({ branch: body.branch, expectedSha: body.expectedSha, specs: body.specs }) });
        } else {
          sendJson(res, 200, { success: true, data: await service.cancelSpecRun(body.id) });
        }
        return;
      }
      if (req.method === 'GET' && route === '/list') {
        sendJson(res, 200, { success: true, data: await service.list() });
        return;
      }
      if (req.method === 'GET' && route === '/detail') {
        sendJson(res, 200, { success: true, data: await service.detail(url.searchParams.get('branch')) });
        return;
      }
      if (req.method === 'POST' && route === '/merge') {
        let body: Record<string, unknown>;
        try {
          const parsed = JSON.parse(await readBody(req));
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
          body = parsed as Record<string, unknown>;
        } catch (err) {
          if (err instanceof BodyTooLargeError) {
            sendJson(res, 413, { success: false, error: err.message });
            return;
          }
          sendJson(res, 400, { success: false, error: 'Request body must be a JSON object.' });
          return;
        }
        // The page only sends this after the reviewer pressed Approve; requiring
        // it means a stray or scripted request can't merge without it.
        if (body.approved !== true) {
          sendJson(res, 400, { success: false, error: 'The changes must be approved before they can be merged.' });
          return;
        }
        const data = await service.merge({
          branch: body.branch,
          expectedSha: body.expectedSha,
          moveToDone: body.moveToDone,
        });
        sendJson(res, 200, { success: true, data });
        return;
      }
      if (['/status', '/gh', '/list', '/detail', '/merge', '/decision', '/tests/status', '/tests/job', '/tests/run', '/tests/cancel'].includes(route)) {
        sendJson(res, 405, { success: false, error: 'Method not allowed' });
        return;
      }
      sendJson(res, 404, { success: false, error: 'Unknown review endpoint.' });
    } catch (err) {
      if (err instanceof SpecGuardError || err instanceof OverlayError) {
        sendJson(res, err instanceof SpecGuardError ? 403 : 409, { success: false, error: err.message });
        return;
      }
      if (err instanceof ReviewError) {
        sendJson(res, err.status, { success: false, error: err.message, details: err.details });
        return;
      }
      // A guard-rail refusal is a deliberate "no", not a crash.
      if (err instanceof GitGuardError || err instanceof GhGuardError || (err instanceof AcliError && err.kind === 'blocked')) {
        sendJson(res, 403, { success: false, error: err.message });
        return;
      }
      sendJson(res, 500, { success: false, error: err instanceof Error ? err.message : 'Unexpected error.' });
    }
  };
}

/**
 * Headers for EVERY response from the dev server. The page has buttons that
 * push to a shared branch, so other sites must not be able to frame it
 * (clickjacking) or have its responses sniffed.
 */
export function securityHeaders(_req: IncomingMessage, res: ServerResponse, next: () => void) {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}

/** True unless the dev server was told to listen beyond this machine (e.g. `--host`). */
export function isLoopbackBind(host: string | boolean | undefined): boolean {
  if (host === undefined || host === false) return true;
  if (typeof host !== 'string') return false; // `true` = all interfaces
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host.toLowerCase());
}

/** Mounted instead of the API when the dev server is reachable from the network. */
export function exposedServerHandler(_req: IncomingMessage, res: ServerResponse) {
  sendJson(res, 403, {
    success: false,
    error: 'The Review API is disabled because the dev server is exposed beyond this machine (for example `--host`). Restart `npm run dev` without --host.',
  });
}

export function reviewPlugin(options: ReviewPluginOptions = {}): Plugin {
  // Fixed, not configurable: the review tab only ever works with the AT project.
  const projectKey = ALLOWED_PROJECT;
  const jiraOpts = options.jira ?? {};

  return {
    name: 'qa-review',
    configureServer(server) {
      const repoPath = expandHome(options.repoPath || '~/Dev/securicy-app');
      // Jira is mandatory: only tickets in the AT Review column are ever shown.
      const jira = createJiraClient(projectKey, {
        reviewStatus: jiraOpts.reviewStatus || 'Review',
        doneStatus: jiraOpts.doneStatus || 'Done',
        baseUrl: jiraOpts.baseUrl,
      });
      const service = createReviewService(
        {
          repoPath,
          baseBranch: QA_BASE_BRANCH,
          remote: options.remote || 'origin',
          projectKey,
          serverRepoPath: options.serverRepoPath ? expandHome(options.serverRepoPath) : undefined,
          testServerPort: options.testServerPort,
        },
        { jira },
      );
      server.middlewares.use(securityHeaders);
      // These endpoints run git and can push, so they refuse to exist at all if
      // the dev server is listening on anything other than loopback.
      if (!isLoopbackBind(server.config.server.host)) {
        server.middlewares.use('/api/review', exposedServerHandler);
        return;
      }
      // If the dev server died during a spec run, finish restoring the test
      // server's checkout; and on any exit, stop a run in progress and restore it.
      try {
        recoverStaleOverlays();
      } catch {
        // nothing to recover
      }
      process.once('exit', () => service.shutdown());
      server.middlewares.use('/api/review', createReviewHandler(service));
    },
  };
}
