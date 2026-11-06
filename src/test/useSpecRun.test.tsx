import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ReviewApiError, cancelSpecRun, fetchSpecJob, fetchTestServer, startSpecRun } from '../utils/reviewApi';
import { useSpecRun, useTestServer } from '../components/Review/useSpecRun';
import { SHA, SPEC_A, SPEC_B, failedSpecResult, specJob, specResult, testServer } from './reviewFixtures';

vi.mock('../utils/reviewApi', async (importActual) => {
  const actual = await importActual<typeof import('../utils/reviewApi')>();
  return { ...actual, startSpecRun: vi.fn(), fetchSpecJob: vi.fn(), cancelSpecRun: vi.fn(), fetchTestServer: vi.fn() };
});

const startMock = vi.mocked(startSpecRun);
const jobMock = vi.mocked(fetchSpecJob);
const cancelMock = vi.mocked(cancelSpecRun);
const serverMock = vi.mocked(fetchTestServer);

const hook = (specs = [SPEC_A, SPEC_B]) => renderHook(() => useSpecRun('AT-727-add-test', SHA, specs, 800));
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  startMock.mockResolvedValue({ id: 'job-1' });
  jobMock.mockResolvedValue(specJob({ status: 'running', output: '', nextOffset: 0, results: null, finishedAt: null, exitCode: null }));
  cancelMock.mockResolvedValue(specJob({ status: 'cleaning' }));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useSpecRun', () => {
  it('starts a run for the reviewed commit and marks the chosen file as running', async () => {
    const { result } = hook();
    let ok = false;
    await act(async () => {
      ok = await result.current.start([SPEC_A]);
    });

    expect(ok).toBe(true);
    expect(startMock).toHaveBeenCalledExactlyOnceWith({ branch: 'AT-727-add-test', expectedSha: SHA, specs: [SPEC_A] });
    expect(result.current.fileStates).toEqual({ [SPEC_A]: 'running' });
    expect(result.current.running).toBe(true);
  });

  it('"all" marks every spec in the PR as running', async () => {
    const { result } = hook([SPEC_A, SPEC_B]);
    await act(async () => void (await result.current.start('all')));
    expect(startMock).toHaveBeenCalledWith(expect.objectContaining({ specs: 'all' }));
    expect(result.current.fileStates).toEqual({ [SPEC_A]: 'running', [SPEC_B]: 'running' });
  });

  it('polls right away, then every interval, and only asks for output it has not seen', async () => {
    jobMock
      .mockResolvedValueOnce(specJob({ status: 'running', output: 'line 1\n', nextOffset: 7, results: null, finishedAt: null }))
      .mockResolvedValueOnce(specJob({ status: 'running', output: 'line 2\n', nextOffset: 14, results: null, finishedAt: null }))
      .mockResolvedValue(specJob({ status: 'passed', output: 'done\n', nextOffset: 19 }));
    const { result } = hook();
    await act(async () => void (await result.current.start([SPEC_A])));

    expect(jobMock).toHaveBeenNthCalledWith(1, 'job-1', 0);
    expect(result.current.output).toBe('line 1\n');
    await tick(800);
    expect(jobMock).toHaveBeenNthCalledWith(2, 'job-1', 7);
    expect(result.current.output).toBe('line 1\nline 2\n');
    await tick(800);
    expect(jobMock).toHaveBeenNthCalledWith(3, 'job-1', 14);
    expect(result.current.output).toBe('line 1\nline 2\ndone\n');
  });

  it('stops polling when the run finishes, and turns results into per-file states', async () => {
    jobMock.mockResolvedValue(specJob({ status: 'failed', specs: [SPEC_A, SPEC_B], results: [specResult(SPEC_A), failedSpecResult(SPEC_B)] }));
    const { result } = hook();
    await act(async () => void (await result.current.start('all')));

    expect(result.current.fileStates).toEqual({ [SPEC_A]: 'passed', [SPEC_B]: 'failed' });
    expect(result.current.running).toBe(false);
    const calls = jobMock.mock.calls.length;
    await tick(5000);
    expect(jobMock).toHaveBeenCalledTimes(calls);
  });

  it.each([
    ['cancelled', null, 'cancelled'],
    ['error', null, 'error'],
    ['failed', null, 'failed'],
    ['passed', null, 'idle'],
  ] as const)('a %s run without results marks files %s', async (status, results, expected) => {
    jobMock.mockResolvedValue(specJob({ status, results }));
    const { result } = hook();
    await act(async () => void (await result.current.start([SPEC_A])));
    expect(result.current.fileStates[SPEC_A]).toBe(expected);
  });

  it('a second run overrides only the files it ran', async () => {
    jobMock.mockResolvedValue(specJob({ status: 'passed', specs: [SPEC_A, SPEC_B], results: [specResult(SPEC_A), specResult(SPEC_B)] }));
    const { result } = hook();
    await act(async () => void (await result.current.start('all')));
    jobMock.mockResolvedValue(specJob({ id: 'job-2', status: 'failed', specs: [SPEC_B], results: [failedSpecResult(SPEC_B)] }));
    startMock.mockResolvedValue({ id: 'job-2' });
    await act(async () => void (await result.current.start([SPEC_B])));
    expect(result.current.fileStates).toEqual({ [SPEC_A]: 'passed', [SPEC_B]: 'failed' });
    expect(result.current.output).not.toContain('earlier run'); // output restarts for each run
  });

  it('reports a failure to start (e.g. the test server is down) without a run', async () => {
    startMock.mockRejectedValue(new ReviewApiError("The test server isn't running on 127.0.0.1:5017. Start it with `yarn test:server` in securicy-app, then try again."));
    const { result } = hook();
    let ok = true;
    await act(async () => {
      ok = await result.current.start([SPEC_A]);
    });
    expect(ok).toBe(false);
    expect(result.current.error).toContain('yarn test:server');
    expect(result.current.running).toBe(false);
    expect(result.current.job).toBeNull();
    expect(jobMock).not.toHaveBeenCalled();
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it('uses a generic message when the start failure has none', async () => {
    startMock.mockRejectedValue('weird');
    const { result } = hook();
    await act(async () => void (await result.current.start([SPEC_A])));
    expect(result.current.error).toBe('Could not start the specs.');
  });

  it('a second click while starting can never start a second run', async () => {
    let resolve!: (v: { id: string }) => void;
    startMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = hook();
    let first!: Promise<boolean>;
    let second = true;
    await act(async () => {
      first = result.current.start([SPEC_A]);
      second = await result.current.start([SPEC_A]);
    });
    expect(second).toBe(false);
    expect(result.current.starting).toBe(true);
    expect(result.current.running).toBe(true);
    await act(async () => {
      resolve({ id: 'job-1' });
      await first;
    });
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it('retries a few failed polls, resets the count on success, and gives up with a clear message', async () => {
    jobMock.mockRejectedValue(new Error('socket hang up'));
    const { result } = hook();
    await act(async () => void (await result.current.start([SPEC_A])));
    for (let i = 0; i < 4; i++) await tick(800);
    expect(result.current.error).toMatch(/Lost contact with the local server: socket hang up/);
    const calls = jobMock.mock.calls.length;
    await tick(5000);
    expect(jobMock).toHaveBeenCalledTimes(calls); // stopped
  });

  it('a successful poll in between resets the failure count', async () => {
    jobMock
      .mockRejectedValueOnce(new Error('blip'))
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce(specJob({ status: 'running', output: 'ok\n', nextOffset: 3, results: null, finishedAt: null }))
      .mockRejectedValueOnce(new Error('blip'))
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue(specJob({ status: 'passed' }));
    const { result } = hook();
    await act(async () => void (await result.current.start([SPEC_A])));
    for (let i = 0; i < 6; i++) await tick(800);
    expect(result.current.error).toBeNull();
    expect(result.current.job?.status).toBe('passed');
  });

  it('a non-Error poll failure still gives up with the generic message', async () => {
    jobMock.mockRejectedValue('weird');
    const { result } = hook();
    await act(async () => void (await result.current.start([SPEC_A])));
    for (let i = 0; i < 5; i++) await tick(800);
    expect(result.current.error).toBe('Lost contact with the local server.');
  });

  it('cancels the run and keeps following it until the server says it is over', async () => {
    const { result } = hook();
    await act(async () => void (await result.current.start([SPEC_A])));
    await act(async () => void (await result.current.cancel()));
    expect(cancelMock).toHaveBeenCalledExactlyOnceWith('job-1');
    expect(result.current.job?.status).toBe('cleaning');

    jobMock.mockResolvedValue(specJob({ status: 'cancelled', results: null }));
    await tick(800);
    expect(result.current.job?.status).toBe('cancelled');
    expect(result.current.fileStates[SPEC_A]).toBe('cancelled');
  });

  it('cancelling with no run is a no-op, and a failed cancel is reported', async () => {
    const { result } = hook();
    await act(async () => void (await result.current.cancel()));
    expect(cancelMock).not.toHaveBeenCalled();

    await act(async () => void (await result.current.start([SPEC_A])));
    cancelMock.mockRejectedValue(new ReviewApiError('That spec run was not found'));
    await act(async () => void (await result.current.cancel()));
    expect(result.current.error).toBe('That spec run was not found');
    cancelMock.mockRejectedValue('weird');
    await act(async () => void (await result.current.cancel()));
    expect(result.current.error).toBe('Could not cancel the run.');
  });

  it('stops polling when the page is left (the run itself carries on in the server)', async () => {
    const { result, unmount } = hook();
    await act(async () => void (await result.current.start([SPEC_A])));
    const calls = jobMock.mock.calls.length;
    unmount();
    await tick(5000);
    expect(jobMock).toHaveBeenCalledTimes(calls);
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('ignores a start that resolves after unmount', async () => {
    let resolve!: (v: { id: string }) => void;
    startMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result, unmount } = hook();
    let p!: Promise<boolean>;
    act(() => {
      p = result.current.start([SPEC_A]);
    });
    unmount();
    resolve({ id: 'late' });
    await expect(p).resolves.toBe(true);
    expect(jobMock).not.toHaveBeenCalled();
  });
});

describe('useTestServer', () => {
  beforeEach(() => {
    serverMock.mockResolvedValue(testServer());
  });

  it('checks on mount: grey first, then up', async () => {
    const { result } = renderHook(() => useTestServer(8000));
    expect(result.current.checking).toBe(true);
    expect(result.current.status).toBeNull();
    await flush();
    expect(result.current.checking).toBe(false);
    expect(result.current.up).toBe(true);
    expect(result.current.status?.port).toBe(5017);
  });

  it('keeps checking on an interval, so the light follows the server being started or stopped', async () => {
    serverMock.mockResolvedValueOnce(testServer({ up: false }));
    const { result } = renderHook(() => useTestServer(8000));
    await flush();
    expect(result.current.up).toBe(false);
    serverMock.mockResolvedValue(testServer({ up: true }));
    await tick(8000);
    expect(result.current.up).toBe(true);
    serverMock.mockResolvedValue(testServer({ up: false }));
    await tick(8000);
    expect(result.current.up).toBe(false);
    expect(serverMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('does nothing at all when disabled (a PR with no specs needs no test server)', async () => {
    const { result } = renderHook(() => useTestServer(8000, false));
    await flush();
    await tick(60_000);
    expect(serverMock).not.toHaveBeenCalled();
    expect(result.current.checking).toBe(false);
    expect(result.current.status).toBeNull();
  });

  it('does not poll at all when asked not to', async () => {
    renderHook(() => useTestServer(0));
    await flush();
    await tick(60_000);
    expect(serverMock).toHaveBeenCalledTimes(1);
  });

  it('recheck shows "checking" and refreshes', async () => {
    const { result } = renderHook(() => useTestServer(0));
    await flush();
    serverMock.mockResolvedValue(testServer({ up: false }));
    let p!: Promise<void>;
    act(() => {
      p = result.current.recheck();
    });
    expect(result.current.checking).toBe(true);
    await act(async () => {
      await p;
    });
    expect(result.current.checking).toBe(false);
    expect(result.current.up).toBe(false);
  });

  it('treats an unreachable dev server as unknown/down, with the reason', async () => {
    serverMock.mockRejectedValue(new ReviewApiError('Could not reach the local review server.'));
    const { result } = renderHook(() => useTestServer(0));
    await flush();
    expect(result.current.status).toBeNull();
    expect(result.current.up).toBe(false);
    expect(result.current.error).toBe('Could not reach the local review server.');
    serverMock.mockRejectedValue('weird');
    await act(async () => void (await result.current.recheck()));
    expect(result.current.error).toBe('Could not check the test server.');
  });

  it('stops polling on unmount', async () => {
    const { unmount } = renderHook(() => useTestServer(8000));
    await flush();
    unmount();
    const calls = serverMock.mock.calls.length;
    await tick(60_000);
    expect(serverMock).toHaveBeenCalledTimes(calls);
  });
});
