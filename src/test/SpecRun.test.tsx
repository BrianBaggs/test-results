import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { SpecResults } from '../components/Review/SpecResults';
import { OutputLog, SpecRunModal } from '../components/Review/SpecRunModal';
import { SpecsPanel, TestServerBadge } from '../components/Review/SpecsPanel';
import type { SpecRunState, TestServerState } from '../components/Review/useSpecRun';
import { SPEC_A, SPEC_B, detail, failedSpecResult, specJob, specResult, testServer } from './reviewFixtures';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const writeText = vi.fn();
Object.assign(navigator, { clipboard: { writeText } });

const runState = (over: Partial<SpecRunState> = {}): SpecRunState => ({
  job: null,
  output: '',
  starting: false,
  error: null,
  fileStates: {},
  running: false,
  start: vi.fn().mockResolvedValue(true),
  cancel: vi.fn().mockResolvedValue(undefined),
  clearError: vi.fn(),
  ...over,
});

const serverState = (over: Partial<TestServerState> = {}): TestServerState => ({ status: testServer(), checking: false, error: null, up: true, recheck: vi.fn().mockResolvedValue(undefined), ...over });
const activeJob = (status: 'preparing' | 'syncing' | 'running' | 'cleaning') => specJob({ status, finishedAt: null, results: null, exitCode: null, elapsedMs: 3000, output: '' });

beforeEach(() => {
  vi.clearAllMocks();
  writeText.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------

describe('TestServerBadge', () => {
  it('is green with the port when the server is up', () => {
    render(<TestServerBadge server={serverState()} />);
    expect(screen.getByTestId('test-server-badge')).toHaveAttribute('data-state', 'ok');
    expect(screen.getByTestId('test-server-badge')).toHaveTextContent('Running on :5017');
  });

  it('is red when it is down', () => {
    render(<TestServerBadge server={serverState({ up: false, status: testServer({ up: false }) })} />);
    expect(screen.getByTestId('test-server-badge')).toHaveAttribute('data-state', 'bad');
    expect(screen.getByTestId('test-server-badge')).toHaveTextContent('Not running');
  });

  it('is grey and pulsing while it has not been checked yet', () => {
    render(<TestServerBadge server={serverState({ status: null, checking: true, up: false })} />);
    expect(screen.getByTestId('test-server-badge')).toHaveAttribute('data-state', 'checking');
    expect(screen.getByTestId('test-server-badge').querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows red (not stuck on grey) when the check itself failed', () => {
    render(<TestServerBadge server={serverState({ status: null, checking: false, up: false, error: 'unreachable' })} />);
    expect(screen.getByTestId('test-server-badge')).toHaveAttribute('data-state', 'bad');
  });
});

describe('SpecsPanel', () => {
  const d = () => detail({ specs: [SPEC_A, SPEC_B], serverCodeChanged: [] });
  const panel = (over: { run?: Partial<SpecRunState>; server?: Partial<TestServerState>; detail?: ReturnType<typeof detail> } = {}) => {
    const onRun = vi.fn();
    const onOpenOutput = vi.fn();
    const run = runState(over.run);
    const server = serverState(over.server);
    const utils = render(<SpecsPanel detail={over.detail ?? d()} run={run} server={server} onRun={onRun} onOpenOutput={onOpenOutput} />);
    return { ...utils, onRun, onOpenOutput, run, server };
  };
  const rows = () => screen.getAllByTestId('spec-row');

  it('lists the PR\'s specs with the folder muted and the file name bold, in aligned columns', () => {
    panel();
    expect(screen.getByText('2 spec files', { exact: false })).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
    expect(within(rows()[0]).getByText('tasks/show/admin/')).toBeInTheDocument();
    expect(within(rows()[0]).getByText('recurring_comments_completed.spec.ts')).toBeInTheDocument();
    expect(rows()[0].className).toContain('grid-cols-[1.25rem_minmax(0,1fr)_auto_2.25rem]');
    expect(rows()[0]).toHaveAttribute('data-state', 'idle');
    expect(within(rows()[0]).getByTestId('spec-meta')).toHaveTextContent('—');
  });

  it('play buttons run one spec; Run all runs them all', () => {
    const { onRun } = panel();
    const play = screen.getAllByRole('button', { name: 'Run recurring_comments_completed.spec.ts' });
    expect(play).toHaveLength(2);
    fireEvent.click(play[1]);
    expect(onRun).toHaveBeenLastCalledWith([SPEC_B]);
    fireEvent.click(screen.getByRole('button', { name: 'Run all (2)' }));
    expect(onRun).toHaveBeenLastCalledWith('all');
  });

  it('with the server up, everything is enabled and there is no warning', () => {
    panel();
    expect(screen.getByTestId('run-all-specs')).toBeEnabled();
    for (const b of screen.getAllByRole('button', { name: /^Run recurring/ })) expect(b).toBeEnabled();
    expect(screen.queryByTestId('test-server-down')).not.toBeInTheDocument();
  });

  describe('when the test server is not running (red light)', () => {
    const down = () => ({ server: { up: false, status: testServer({ up: false }) } });

    it('disables every play button and Run all, with a tooltip that says what to do', () => {
      panel(down());
      expect(screen.getByTestId('run-all-specs')).toBeDisabled();
      expect(screen.getByTestId('run-all-specs')).toHaveAttribute('title', expect.stringContaining('yarn test:server'));
      for (const b of screen.getAllByRole('button', { name: /^Run recurring/ })) {
        expect(b).toBeDisabled();
        expect(b).toHaveAttribute('title', expect.stringContaining('start it with yarn test:server'));
      }
    });

    it('explains how to start it (the app never does) and offers a copyable command', () => {
      panel(down());
      const box = screen.getByTestId('test-server-down');
      expect(box).toHaveTextContent("The test server isn't running");
      expect(box).toHaveTextContent('this app never starts it for you');
      expect(within(box).getByText('yarn test:server')).toBeInTheDocument();
      expect(within(box).getByRole('button', { name: 'Copy test server command' })).toBeInTheDocument();
    });

    it('Check again re-probes the server', () => {
      const { server } = panel(down());
      fireEvent.click(screen.getByRole('button', { name: /Check again/ }));
      expect(server.recheck).toHaveBeenCalledTimes(1);
    });

    it('Check again stays visible, disabled and spinning while it re-checks', () => {
      panel({ server: { up: false, status: testServer({ up: false }), checking: true } });
      const again = screen.getByRole('button', { name: /Check again/ });
      expect(again).toBeDisabled();
      expect(again.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('uses the start command the server reports', () => {
      panel({ server: { up: false, status: testServer({ up: false, startCommand: 'yarn other:server' }) } });
      expect(within(screen.getByTestId('test-server-down')).getByText('yarn other:server')).toBeInTheDocument();
    });
  });

  it('does not claim the server is down while it is still being checked', () => {
    panel({ server: { up: false, status: null, checking: true } });
    expect(screen.queryByTestId('test-server-down')).not.toBeInTheDocument();
    expect(screen.getByTestId('run-all-specs')).toBeDisabled();
    expect(screen.getByTestId('run-all-specs')).toHaveAttribute('title', 'Checking the test server…');
  });

  it('while a run is in progress: one run at a time, the running file spins, and the button says so', () => {
    panel({ run: { running: true, job: activeJob('running'), fileStates: { [SPEC_A]: 'running', [SPEC_B]: 'idle' } } });
    expect(screen.getByTestId('run-all-specs')).toBeDisabled();
    expect(screen.getByTestId('run-all-specs')).toHaveAttribute('title', 'A run is already in progress');
    for (const b of screen.getAllByRole('button', { name: /^Run recurring/ })) expect(b).toBeDisabled();
    expect(rows()[0]).toHaveAttribute('data-state', 'running');
    expect(within(rows()[0]).getByTestId('spec-meta')).toHaveTextContent('Running…');
    expect(within(rows()[0]).getByLabelText('Running')).toHaveClass('animate-spin');
    expect(screen.getByRole('button', { name: 'Live output' })).toBeInTheDocument();
  });

  it('shows Starting… on the button while the request is in flight', () => {
    panel({ run: { starting: true, running: true } });
    expect(screen.getByTestId('run-all-specs')).toHaveTextContent('Starting…');
    expect(screen.getByTestId('run-all-specs')).toBeDisabled();
  });

  it('after a run: a green check or red X per file, test count and duration, and a summary line', () => {
    panel({
      run: {
        job: specJob({ status: 'failed', specs: [SPEC_A, SPEC_B], results: [specResult(SPEC_A), failedSpecResult(SPEC_B)], elapsedMs: 12_400 }),
        fileStates: { [SPEC_A]: 'passed', [SPEC_B]: 'failed' },
      },
    });
    expect(within(rows()[0]).getByLabelText('Passed')).toBeInTheDocument();
    expect(within(rows()[0]).getByTestId('spec-meta')).toHaveTextContent('1 test · 4.2s');
    expect(within(rows()[1]).getByLabelText('Failed')).toBeInTheDocument();
    expect(within(rows()[1]).getByTestId('spec-meta')).toHaveTextContent('2 tests · 4.2s');
    const last = screen.getByTestId('specs-last-run');
    expect(last).toHaveTextContent('✓ 2 passed');
    expect(last).toHaveTextContent('✗ 1 failed');
    expect(last).toHaveTextContent('12.4s');
    expect(screen.getByRole('button', { name: 'Last output' })).toBeInTheDocument();
  });

  it('Live output / Last output reopens the modal', () => {
    const { onOpenOutput } = panel({ run: { job: specJob() } });
    fireEvent.click(screen.getByRole('button', { name: 'Last output' }));
    expect(onOpenOutput).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['cancelled', 'Cancelled', 'Cancelled'],
    ['error', 'Could not run', 'Could not run'],
    ['skipped', 'Skipped', '—'],
  ] as const)('shows the %s state', (state, label, meta) => {
    panel({ run: { fileStates: { [SPEC_A]: state } } });
    expect(within(rows()[0]).getByLabelText(label)).toBeInTheDocument();
    expect(within(rows()[0]).getByTestId('spec-meta')).toHaveTextContent(meta);
  });

  it('shows a start error with a Dismiss button', () => {
    const { run } = panel({ run: { error: "The test server isn't running on 127.0.0.1:5017. Start it with `yarn test:server` in securicy-app, then try again." } });
    expect(screen.getByTestId('specs-error')).toHaveTextContent('yarn test:server');
    fireEvent.click(within(screen.getByTestId('specs-error')).getByRole('button', { name: 'Dismiss' }));
    expect(run.clearError).toHaveBeenCalledTimes(1);
  });

  it('warns about changed server-side files that are not copied, naming one', () => {
    panel({ detail: detail({ specs: [SPEC_A], serverCodeChanged: ['spec/playwright/playwright/app_commands/x.rb', 'app/models/user.rb'] }) });
    const warn = screen.getByTestId('server-code-warning');
    expect(warn).toHaveTextContent('changes 2 files that run inside the test server');
    expect(warn).toHaveTextContent('app_commands/x.rb');
    expect(warn).toHaveTextContent('restart your test server from the PR branch');
  });

  it('explains what happens to fixtures and cassettes, and that your checkout is untouched', () => {
    panel();
    expect(screen.getByText(/copied into your test server's checkout while the specs run, then restored exactly as they were/)).toBeInTheDocument();
    expect(screen.getByText(/your own checkout is never touched/)).toBeInTheDocument();
    expect(screen.queryByTestId('server-code-warning')).not.toBeInTheDocument();
  });

  it('singular wording for a single spec', () => {
    panel({ detail: detail({ specs: [SPEC_A] }) });
    expect(screen.getByRole('button', { name: 'Run all (1)' })).toBeInTheDocument();
    expect(screen.getByText('1 spec file', { exact: false })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe('SpecResults', () => {
  it('lists failed files first, expanded, with the error message, code frame and stack trace', () => {
    render(<SpecResults results={[specResult(SPEC_A), failedSpecResult(SPEC_B)]} />);
    const files = screen.getAllByTestId('result-file');
    expect(files.map((f) => f.getAttribute('data-status'))).toEqual(['failed', 'passed']);

    const failed = within(files[0]);
    expect(failed.getByText('1 failed · 2 tests')).toBeInTheDocument();
    const error = failed.getByTestId('spec-error');
    expect(error).toHaveTextContent('expect(locator).toContainText(expected)');
    expect(error).toHaveTextContent('Expected substring: "Evidence for this"');
    expect(error).toHaveTextContent("> 57 | await expect(page.locator('.comments'))");
    expect(failed.getByTestId('spec-stack')).toHaveTextContent('at recurring_comments_completed.spec.ts:57:9');
  });

  it('shows pass and fail icons, test titles with line numbers and durations', () => {
    render(<SpecResults results={[failedSpecResult(SPEC_B)]} />);
    const tests = screen.getAllByTestId('result-test');
    expect(tests.map((t) => t.getAttribute('data-status'))).toEqual(['passed', 'failed']);
    expect(within(tests[0]).getByLabelText('Passed')).toBeInTheDocument();
    expect(within(tests[1]).getByLabelText('Failed')).toBeInTheDocument();
    expect(tests[1]).toHaveTextContent('Recurring task comments › Evidence is copied');
    expect(tests[1]).toHaveTextContent(':55');
    expect(tests[1]).toHaveTextContent('3.2s');
  });

  it('collapses passing files when there are many, and expands them on click', () => {
    const results = ['a', 'b', 'c', 'd'].map((n) => specResult(`spec/playwright/playwright/e2e/${n}.spec.ts`));
    render(<SpecResults results={results} />);
    expect(screen.queryAllByTestId('result-test')).toHaveLength(0);
    const first = screen.getAllByRole('button', { expanded: false })[0];
    fireEvent.click(first);
    expect(screen.getAllByTestId('result-test')).toHaveLength(1);
    fireEvent.click(screen.getAllByRole('button', { expanded: true })[0]);
    expect(screen.queryAllByTestId('result-test')).toHaveLength(0);
  });

  it('shows timed out, skipped and interrupted tests', () => {
    render(
      <SpecResults
        results={[
          specResult(SPEC_A, {
            status: 'failed',
            tests: [
              { title: 'slow one', line: 3, status: 'timedOut', durationMs: 30_000, error: { message: 'Timeout 30000ms exceeded.', stack: '', snippet: '' } },
              { title: 'skipped one', line: 9, status: 'skipped', durationMs: 0, error: null },
              { title: 'interrupted one', line: 12, status: 'interrupted', durationMs: 5, error: null },
            ],
          }),
        ]}
      />,
    );
    const tests = screen.getAllByTestId('result-test');
    expect(tests[0]).toHaveTextContent('timed out');
    expect(tests[0]).toHaveTextContent('30.0s');
    expect(within(tests[1]).getByLabelText('Skipped')).toBeInTheDocument();
    expect(within(tests[2]).getByLabelText('Failed')).toBeInTheDocument();
  });

  it('copies a failure (message, code frame and stack) for pasting into a ticket', async () => {
    render(<SpecResults results={[failedSpecResult(SPEC_A)]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy error' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('Expected substring');
    expect(copied).toContain('> 57 |');
    expect(copied).toContain('at recurring_comments_completed.spec.ts:57:9');
  });

  it('handles an error with only a message', () => {
    render(<SpecResults results={[specResult(SPEC_A, { status: 'failed', tests: [{ title: 't', line: null, status: 'failed', durationMs: 1, error: { message: 'boom', stack: 'boom', snippet: '' } }] })]} />);
    expect(screen.getByTestId('spec-error')).toHaveTextContent('boom');
    expect(screen.queryByTestId('spec-stack')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe('OutputLog', () => {
  it('colours pass, fail and skip lines', () => {
    render(<OutputLog output={'Running 3 tests\n  ✓  1 ok one\n  ✘  2 bad one\n  -  3 skipped one\n'} running={false} />);
    const kinds = screen.getByRole('log').querySelectorAll('[data-kind]');
    expect([...kinds].map((k) => k.getAttribute('data-kind'))).toEqual(['plain', 'pass', 'fail', 'skip', 'plain']);
  });

  it('says what it is waiting for, with a spinner, while running; and when there is no output', () => {
    const { rerender } = render(<OutputLog output="" running />);
    expect(screen.getByRole('log')).toHaveTextContent('Waiting for output…');
    expect(screen.getByRole('log').querySelector('.animate-spin')).toBeInTheDocument();
    rerender(<OutputLog output="" running={false} />);
    expect(screen.getByRole('log')).toHaveTextContent('No output.');
    expect(screen.getByRole('button', { name: 'Copy output' })).toBeDisabled();
  });

  it('copies everything', async () => {
    render(<OutputLog output={'line 1\nline 2'} running={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy output' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('line 1\nline 2'));
    expect(toast.success).toHaveBeenCalledWith('Output copied.');
  });

  it('says so when copying fails', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    render(<OutputLog output="x" running={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy output' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('copy it manually')));
  });

  it('keeps only the last 2,000 lines on screen and says how many are hidden', () => {
    const output = Array.from({ length: 2500 }, (_, i) => `row ${i}`).join('\n');
    render(<OutputLog output={output} running={false} />);
    expect(screen.getByRole('log')).toHaveTextContent('500 earlier lines hidden');
    expect(screen.getByRole('log')).toHaveTextContent('row 2499');
    expect(screen.getByRole('log')).not.toHaveTextContent('row 0 ');
  });

  it('follows the end of the output unless you turn Follow off', () => {
    const { rerender } = render(<OutputLog output="a" running />);
    const box = screen.getByRole('log');
    Object.defineProperty(box, 'scrollHeight', { value: 500, configurable: true });
    rerender(<OutputLog output={'a\nb'} running />);
    expect(box.scrollTop).toBe(500);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Follow output' }));
    box.scrollTop = 10;
    Object.defineProperty(box, 'scrollHeight', { value: 900, configurable: true });
    rerender(<OutputLog output={'a\nb\nc'} running />);
    expect(box.scrollTop).toBe(10);
  });
});

// ---------------------------------------------------------------------------

describe('SpecRunModal', () => {
  const modal = (run: SpecRunState, over: { testServerUp?: boolean; open?: boolean } = {}) => {
    const onOpenChange = vi.fn();
    const onRerun = vi.fn();
    const utils = render(<SpecRunModal open={over.open ?? true} onOpenChange={onOpenChange} run={run} ticketKey="AT-727" testServerUp={over.testServerUp ?? true} onRerun={onRerun} />);
    return { ...utils, onOpenChange, onRerun };
  };
  const dialog = () => screen.getByTestId('spec-run-modal');
  const tab = (name: string) => within(dialog()).getByRole('tab', { name });

  it('renders nothing when closed', () => {
    modal(runState(), { open: false });
    expect(screen.queryByTestId('spec-run-modal')).not.toBeInTheDocument();
  });

  describe('while starting (no job yet)', () => {
    it('shows a spinner and "Starting…", with the live output tab ready', () => {
      modal(runState({ starting: true, running: true }));
      expect(within(dialog()).getByRole('heading', { name: 'Starting…' })).toBeInTheDocument();
      expect(tab('Output')).toHaveAttribute('aria-selected', 'true');
      expect(within(dialog()).getByRole('log')).toHaveTextContent('Waiting for output…');
      fireEvent.click(tab('Summary'));
      expect(within(dialog()).getByTestId('run-progress')).toHaveTextContent('Starting…');
      expect(within(dialog()).getByTestId('run-progress').querySelector('.animate-spin')).toBeInTheDocument();
      expect(within(dialog()).getByTestId('phase-preparing')).toHaveAttribute('data-state', 'active');
      expect(within(dialog()).queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
    });
  });

  describe('while running', () => {
    it.each([
      ['preparing', ['active', 'todo', 'todo', 'todo'], 'Preparing'],
      ['syncing', ['done', 'active', 'todo', 'todo'], 'Syncing fixtures'],
      ['running', ['done', 'done', 'active', 'todo'], 'Running specs'],
      ['cleaning', ['done', 'done', 'done', 'active'], 'Cleaning up'],
    ] as const)('%s: shows the stepper at the right place with a spinner', (status, states, label) => {
      modal(runState({ running: true, job: activeJob(status) }));
      fireEvent.click(tab('Summary'));
      const states_ = ['preparing', 'syncing', 'running', 'cleaning'].map((p) => within(dialog()).getByTestId(`phase-${p}`).getAttribute('data-state'));
      expect(states_).toEqual(states);
      expect(within(dialog()).getByTestId('run-progress')).toHaveTextContent(label);
      expect(within(dialog()).getByTestId('run-progress').querySelector('.animate-spin')).toBeInTheDocument();
      expect(within(dialog()).getByRole('heading', { name: 'Running specs' })).toBeInTheDocument();
    });

    it('streams output on the Output tab, which is the default while running', () => {
      modal(runState({ running: true, job: activeJob('running'), output: 'Running 2 tests using 1 worker\n  ✓  1 first\n' }));
      expect(tab('Output')).toHaveAttribute('aria-selected', 'true');
      expect(within(dialog()).getByRole('log')).toHaveTextContent('Running 2 tests using 1 worker');
    });

    it('shows the ticket, the number of spec files and the elapsed time', () => {
      modal(runState({ running: true, job: { ...activeJob('running'), specs: [SPEC_A, SPEC_B], elapsedMs: 3000, startedAt: new Date(Date.now() - 3000).toISOString() } }));
      expect(dialog()).toHaveTextContent('AT-727 · 2 spec files · 3.0s');
    });

    it('lets you cancel, and says closing the window does not stop the run', () => {
      const run = runState({ running: true, job: activeJob('running') });
      modal(run);
      expect(dialog()).toHaveTextContent('Closing this window does not stop the run');
      fireEvent.click(within(dialog()).getByRole('button', { name: /Cancel run/ }));
      expect(run.cancel).toHaveBeenCalledTimes(1);
    });

    it('cannot be cancelled while it is already cleaning up', () => {
      modal(runState({ running: true, job: activeJob('cleaning') }));
      expect(within(dialog()).getByRole('button', { name: /Cancel run/ })).toBeDisabled();
    });

    it('has no "Run again" while running', () => {
      modal(runState({ running: true, job: activeJob('running') }));
      expect(within(dialog()).queryByRole('button', { name: /Run again/ })).not.toBeInTheDocument();
    });
  });

  describe('when the run passes', () => {
    const passed = () => runState({ job: specJob({ status: 'passed', specs: [SPEC_A, SPEC_B], results: [specResult(SPEC_A), specResult(SPEC_B)], elapsedMs: 12_400 }) });

    it('shows a green check, "All specs passed", counts and the Summary tab', () => {
      modal(passed());
      expect(tab('Summary')).toHaveAttribute('aria-selected', 'true');
      expect(within(dialog()).getByRole('heading', { name: 'Specs passed' })).toBeInTheDocument();
      expect(within(dialog()).getByTestId('run-banner')).toHaveAttribute('data-status', 'passed');
      expect(within(dialog()).getByTestId('run-banner')).toHaveTextContent('All specs passed');
      expect(within(dialog()).getByTestId('run-banner')).toHaveTextContent('2 tests in 2 files · 12.4s');
      expect(within(dialog()).getByTestId('run-counts')).toHaveTextContent('✓ 2 passed');
      expect(within(dialog()).getByTestId('run-counts')).not.toHaveTextContent('failed');
      expect(dialog()).toHaveTextContent('Your checkout and test server files have been restored.');
      expect(within(dialog()).getAllByTestId('result-file')).toHaveLength(2);
    });

    it('Run again re-runs the same specs, and Close closes', () => {
      const { onRerun, onOpenChange } = modal(passed());
      fireEvent.click(within(dialog()).getByRole('button', { name: /Run again/ }));
      expect(onRerun).toHaveBeenCalledExactlyOnceWith([SPEC_A, SPEC_B]);
      fireEvent.click([...within(dialog()).getAllByRole('button', { name: 'Close' })].pop()!);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('Run again is disabled when the test server went down, with the reason', () => {
      modal(passed(), { testServerUp: false });
      const again = within(dialog()).getByRole('button', { name: /Run again/ });
      expect(again).toBeDisabled();
      expect(again).toHaveAttribute('title', expect.stringContaining('yarn test:server'));
    });

    it('mentions skipped tests', () => {
      modal(runState({ job: specJob({ status: 'passed', results: [specResult(SPEC_A, { tests: [{ title: 'a', line: 1, status: 'passed', durationMs: 1, error: null }, { title: 'b', line: 2, status: 'skipped', durationMs: 0, error: null }] })] }) }));
      expect(within(dialog()).getByTestId('run-banner')).toHaveTextContent('1 skipped');
      expect(within(dialog()).getByTestId('run-counts')).toHaveTextContent('1 skipped');
    });
  });

  describe('when specs fail', () => {
    const failed = () =>
      runState({
        job: specJob({ status: 'failed', exitCode: 1, specs: [SPEC_A, SPEC_B], results: [specResult(SPEC_A), failedSpecResult(SPEC_B)], elapsedMs: 9_000 }),
      });

    it('shows a red X, how many failed, and the failing test\'s error and stack trace right away', () => {
      modal(failed());
      expect(within(dialog()).getByRole('heading', { name: 'Specs failed' })).toBeInTheDocument();
      expect(within(dialog()).getByTestId('run-banner')).toHaveAttribute('data-status', 'failed');
      expect(within(dialog()).getByTestId('run-banner')).toHaveTextContent('1 test failed');
      expect(within(dialog()).getByTestId('run-banner')).toHaveTextContent('2 passed · 1 failed');
      expect(within(dialog()).getByTestId('run-banner')).toHaveTextContent('exit code 1');
      expect(within(dialog()).getByTestId('run-counts')).toHaveTextContent('✗ 1 failed');
      expect(within(dialog()).getByTestId('spec-error')).toHaveTextContent('expect(locator).toContainText');
      expect(within(dialog()).getByTestId('spec-stack')).toHaveTextContent('recurring_comments_completed.spec.ts:57:9');
    });

    it('the Output tab keeps the full output for what the summary does not show', () => {
      modal(runState({ ...failed(), output: 'Error: something only in the raw output\n' }));
      fireEvent.click(tab('Output'));
      expect(within(dialog()).getByRole('log')).toHaveTextContent('something only in the raw output');
      fireEvent.click(tab('Summary'));
      expect(within(dialog()).getByTestId('spec-results')).toBeInTheDocument();
    });
  });

  it('a crash with no structured results points to the output', () => {
    modal(runState({ job: specJob({ status: 'failed', exitCode: 2, results: null }) }));
    expect(within(dialog()).getByTestId('run-banner')).toHaveTextContent('The run failed');
    expect(within(dialog()).getByTestId('no-structured-results')).toHaveTextContent('No structured results were produced');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'See the output' }));
    expect(tab('Output')).toHaveAttribute('aria-selected', 'true');
  });

  it('a cancelled run says everything was restored', () => {
    modal(runState({ job: specJob({ status: 'cancelled', results: null }) }));
    expect(within(dialog()).getByRole('heading', { name: 'Run cancelled' })).toBeInTheDocument();
    expect(within(dialog()).getByTestId('run-banner')).toHaveAttribute('data-status', 'cancelled');
    expect(within(dialog()).getByTestId('run-banner')).toHaveTextContent('Your checkout and test server files were restored.');
    expect(within(dialog()).queryByTestId('no-structured-results')).not.toBeInTheDocument();
  });

  it('a run that could not finish shows why and that it cleaned up', () => {
    modal(runState({ job: specJob({ status: 'error', results: null, error: '`yarn` was not found. Install it (`brew install yarn`), then try again.' }) }));
    expect(within(dialog()).getByRole('heading', { name: 'Run could not finish' })).toBeInTheDocument();
    expect(within(dialog()).getByTestId('run-banner')).toHaveTextContent('`yarn` was not found');
    expect(within(dialog()).getByTestId('run-banner')).toHaveTextContent('Everything was cleaned up');
  });

  it('lists warnings, such as the fixtures that were copied for the run', () => {
    modal(runState({ job: specJob({ warnings: ['Copied 2 fixture/cassette files from this PR into your test server checkout for the run. They are restored when it finishes.'] }) }));
    expect(within(dialog()).getByTestId('run-warnings')).toHaveTextContent('Copied 2 fixture/cassette files');
  });

  it('shows a problem starting the run inside the modal', () => {
    modal(runState({ error: "The test server isn't running" }));
    expect(within(dialog()).getByTestId('run-start-error')).toHaveTextContent("Couldn't start the specs");
    expect(within(dialog()).getByTestId('run-start-error')).toHaveTextContent("The test server isn't running");
  });

  it('remembers the tab you chose for this run, and starts from the default again for the next one', () => {
    const { rerender } = modal(runState({ running: true, job: activeJob('running') }));
    fireEvent.click(tab('Summary'));
    expect(tab('Summary')).toHaveAttribute('aria-selected', 'true');
    rerender(<SpecRunModal open onOpenChange={vi.fn()} run={runState({ job: specJob({ id: 'job-2', status: 'passed' }) })} ticketKey="AT-727" testServerUp onRerun={vi.fn()} />);
    expect(tab('Summary')).toHaveAttribute('aria-selected', 'true'); // new run, finished: default is the summary
    fireEvent.click(tab('Output'));
    expect(tab('Output')).toHaveAttribute('aria-selected', 'true');
  });

  it('ticks the elapsed time while a run is active', async () => {
    vi.useFakeTimers();
    try {
      modal(runState({ running: true, job: { ...activeJob('running'), startedAt: new Date(Date.now() - 1000).toISOString(), elapsedMs: 1000 } }));
      expect(dialog()).toHaveTextContent('1.0s');
      await vi.advanceTimersByTimeAsync(3000);
      expect(dialog()).toHaveTextContent('4.0s');
    } finally {
      vi.useRealTimers();
    }
  });
});
