import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ReviewPage } from '../components/Review/ReviewPage';
import {
  ReviewApiError,
  cancelSpecRun,
  fetchGhStatus,
  fetchReviewDetail,
  fetchReviewList,
  fetchReviewStatus,
  fetchSpecJob,
  fetchTestServer,
  startSpecRun,
} from '../utils/reviewApi';
import { stubCanvas } from './canvasStub';
import { SHA, SPEC_A, SPEC_B, detail, failedSpecResult, gh, list, specJob, specResult, status, testServer } from './reviewFixtures';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/reviewApi', async (importActual) => {
  const actual = await importActual<typeof import('../utils/reviewApi')>();
  return {
    ...actual,
    fetchReviewStatus: vi.fn(),
    fetchGhStatus: vi.fn(),
    fetchTestServer: vi.fn(),
    fetchReviewList: vi.fn(),
    fetchReviewDetail: vi.fn(),
    mergeReview: vi.fn(),
    submitReviewDecision: vi.fn(),
    startSpecRun: vi.fn(),
    fetchSpecJob: vi.fn(),
    cancelSpecRun: vi.fn(),
  };
});

const serverMock = vi.mocked(fetchTestServer);
const startMock = vi.mocked(startSpecRun);
const jobMock = vi.mocked(fetchSpecJob);
const cancelMock = vi.mocked(cancelSpecRun);

beforeAll(stubCanvas);

const running = (over = {}) => specJob({ status: 'running', finishedAt: null, results: null, exitCode: null, output: 'Running 1 test using 1 worker\n', nextOffset: 30, elapsedMs: 2000, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.mocked(fetchReviewStatus).mockResolvedValue(status());
  vi.mocked(fetchGhStatus).mockResolvedValue(gh());
  vi.mocked(fetchReviewList).mockResolvedValue(list());
  vi.mocked(fetchReviewDetail).mockResolvedValue(
    detail({ specs: [SPEC_A, SPEC_B], serverCodeChanged: [], ticket: { ...detail().ticket, approval: 'approved' } }),
  );
  serverMock.mockResolvedValue(testServer());
  startMock.mockResolvedValue({ id: 'job-1' });
  jobMock.mockResolvedValue(specJob());
  cancelMock.mockResolvedValue(specJob({ status: 'cleaning' }));
});

async function openSpecsTab() {
  render(<ReviewPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review AT-727' }));
  await screen.findByTestId('merge-box');
  fireEvent.click(screen.getByRole('tab', { name: /^Specs/ }));
  return screen.findByTestId('specs-panel');
}
const rows = () => screen.getAllByTestId('spec-row');
const mergeButton = () => within(screen.getByTestId('merge-box')).getByRole('button', { name: /Rebase and merge/ });

describe('the Specs tab', () => {
  it('only appears when the PR adds or changes Playwright specs, with the count', async () => {
    vi.mocked(fetchReviewDetail).mockResolvedValue(detail({ specs: [] }));
    render(<ReviewPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review AT-727' }));
    await screen.findByTestId('merge-box');
    expect(screen.queryByRole('tab', { name: /^Specs/ })).not.toBeInTheDocument();
    expect(serverMock).toHaveBeenCalledTimes(1); // only the list page's check; no polling for a PR with no specs
  });

  it('lists the specs, and checks the test server', async () => {
    vi.mocked(fetchReviewDetail).mockResolvedValue(detail({ specs: [SPEC_A, SPEC_B] }));
    const panel = await openSpecsTab();
    expect(screen.getByRole('tab', { name: 'Specs (2)' })).toHaveAttribute('aria-selected', 'true');
    expect(rows()).toHaveLength(2);
    await waitFor(() => expect(within(panel).getByTestId('test-server-badge')).toHaveAttribute('data-state', 'ok'));
    expect(within(panel).getByTestId('run-all-specs')).toBeEnabled();
  });

  it('red light: the play buttons are disabled and the page says to run yarn test:server', async () => {
    serverMock.mockResolvedValue(testServer({ up: false }));
    const panel = await openSpecsTab();
    await waitFor(() => expect(within(panel).getByTestId('test-server-badge')).toHaveAttribute('data-state', 'bad'));
    expect(within(panel).getByTestId('test-server-down')).toHaveTextContent('yarn test:server');
    expect(within(panel).getByTestId('run-all-specs')).toBeDisabled();
    for (const b of within(panel).getAllByRole('button', { name: /^Run recurring/ })) expect(b).toBeDisabled();
    expect(startMock).not.toHaveBeenCalled();
  });

  it('comes alive when the server is started: Check again turns the light green and enables the buttons', async () => {
    serverMock.mockResolvedValue(testServer({ up: false }));
    const panel = await openSpecsTab();
    await within(panel).findByTestId('test-server-down');

    serverMock.mockResolvedValue(testServer({ up: true }));
    fireEvent.click(within(panel).getByRole('button', { name: /Check again/ }));

    await waitFor(() => expect(within(panel).getByTestId('test-server-badge')).toHaveAttribute('data-state', 'ok'));
    expect(within(panel).queryByTestId('test-server-down')).not.toBeInTheDocument();
    expect(within(panel).getByTestId('run-all-specs')).toBeEnabled();
  });

  it('reports a start refusal from the server (it went down since the last check) without opening the modal', async () => {
    startMock.mockRejectedValue(new ReviewApiError("The test server isn't running on 127.0.0.1:5017. Start it with `yarn test:server` in securicy-app, then try again."));
    const panel = await openSpecsTab();
    await waitFor(() => expect(within(panel).getByTestId('run-all-specs')).toBeEnabled());
    fireEvent.click(within(panel).getByTestId('run-all-specs'));

    expect(await within(panel).findByTestId('specs-error')).toHaveTextContent('yarn test:server');
    expect(screen.queryByTestId('spec-run-modal')).not.toBeInTheDocument();
    expect(within(panel).getByTestId('run-all-specs')).toBeEnabled(); // can try again
  });
});

describe('a PR that only changes Playwright support files', () => {
  const P = 'spec/playwright/playwright';
  const supportOnly = (over = {}) =>
    detail({
      specs: [],
      supportFiles: [`${P}/support/helpers.ts`, `${P}/pages/login_page.ts`, `${P}/fixtures/vcr_cassettes/tasks.yml`, 'spec/fixtures/users.yml'],
      ticket: { ...detail().ticket, approval: 'approved' },
      ...over,
    });

  async function openSupportOnly(d = supportOnly()) {
    vi.mocked(fetchReviewDetail).mockResolvedValue(d);
    render(<ReviewPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review AT-727' }));
    await screen.findByTestId('merge-box');
  }

  it('labels the tab "Support files (N)" instead of "Specs", and explains there is nothing to run', async () => {
    await openSupportOnly();
    const tab = screen.getByRole('tab', { name: 'Support files (4)' });
    expect(screen.queryByRole('tab', { name: /^Specs/ })).not.toBeInTheDocument();
    fireEvent.click(tab);

    const panel = await screen.findByTestId('support-only-panel');
    expect(within(panel).getByRole('heading', { name: 'No specs in this PR' })).toBeInTheDocument();
    expect(panel).toHaveTextContent('changes 4 Playwright support files');
  });

  it('groups the files by kind with counts', async () => {
    await openSupportOnly();
    fireEvent.click(screen.getByRole('tab', { name: /^Support files/ }));
    const panel = await screen.findByTestId('support-only-panel');

    for (const [kind, label] of [
      ['helpers', 'Helpers and support code (1)'],
      ['pages', 'Page objects (1)'],
      ['fixtures', 'Fixtures (1)'],
      ['cassettes', 'VCR cassettes (1)'],
    ] as const) {
      expect(within(within(panel).getByTestId(`support-group-${kind}`)).getByText(label)).toBeInTheDocument();
    }
    expect(within(panel).getByTitle(`${P}/support/helpers.ts`)).toBeInTheDocument();
  });

  it('offers nothing to run: no play buttons, no Run all, no test-server badge or polling', async () => {
    await openSupportOnly();
    fireEvent.click(screen.getByRole('tab', { name: /^Support files/ }));
    const panel = await screen.findByTestId('support-only-panel');

    expect(within(panel).queryByTestId('run-all-specs')).not.toBeInTheDocument();
    expect(within(panel).queryByTestId('test-server-badge')).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /^Run / })).not.toBeInTheDocument();
    expect(serverMock).toHaveBeenCalledTimes(1); // the list page's check only
    expect(startMock).not.toHaveBeenCalled();
  });

  it('is still reviewable and mergeable once approved (support-only is a normal PR)', async () => {
    await openSupportOnly();
    expect(mergeButton()).toBeEnabled();
  });

  it('warns when it also changes code that runs inside the test server', async () => {
    await openSupportOnly(supportOnly({ serverCodeChanged: ['spec/e2e/app_commands/seed.rb'] }));
    fireEvent.click(screen.getByRole('tab', { name: /^Support files/ }));
    expect(await screen.findByTestId('server-code-warning')).toHaveTextContent('spec/e2e/app_commands/seed.rb');
  });

  it('a PR with neither specs nor support files has no tab at all', async () => {
    await openSupportOnly(supportOnly({ supportFiles: [] }));
    expect(screen.queryByRole('tab', { name: /^Support files/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^Specs/ })).not.toBeInTheDocument();
  });

  it('a PR with specs AND support files lists the support files in a collapsed note under the specs', async () => {
    await openSupportOnly(supportOnly({ specs: [SPEC_A] }));
    fireEvent.click(screen.getByRole('tab', { name: /^Specs/ }));
    const panel = await screen.findByTestId('specs-panel');

    expect(screen.queryByTestId('support-only-panel')).not.toBeInTheDocument();
    const note = within(panel).getByTestId('support-note');
    expect(note).not.toHaveAttribute('open');
    expect(note).toHaveTextContent('This PR also changes 4 support files');
    expect(within(note).getByTestId('support-group-cassettes')).toBeInTheDocument();
  });
});

describe('running specs', () => {
  it('play on one spec: starts that spec for the reviewed commit and opens the progress modal', async () => {
    jobMock.mockResolvedValue(running({ status: 'syncing', output: '' }));
    const panel = await openSpecsTab();
    await waitFor(() => expect(within(panel).getByTestId('run-all-specs')).toBeEnabled());

    fireEvent.click(within(panel).getAllByRole('button', { name: /^Run recurring/ })[1]);

    expect(startMock).toHaveBeenCalledExactlyOnceWith({ branch: 'AT-727-add-test', expectedSha: SHA, specs: [SPEC_B] });
    const modal = await screen.findByTestId('spec-run-modal');
    await waitFor(() => expect(within(modal).getByRole('heading', { name: 'Running specs' })).toBeInTheDocument());
    fireEvent.click(within(modal).getByRole('tab', { name: 'Summary' }));
    expect(within(modal).getByTestId('run-progress')).toHaveTextContent('Syncing fixtures');
    expect(within(modal).getByTestId('run-progress').querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('Run all sends "all"', async () => {
    const panel = await openSpecsTab();
    await waitFor(() => expect(within(panel).getByTestId('run-all-specs')).toBeEnabled());
    fireEvent.click(within(panel).getByTestId('run-all-specs'));
    expect(startMock).toHaveBeenCalledWith({ branch: 'AT-727-add-test', expectedSha: SHA, specs: 'all' });
    await screen.findByTestId('spec-run-modal');
  });

  it('follows the run to a pass: green check on the row and on the tab, success banner, counts', async () => {
    jobMock
      .mockResolvedValueOnce(running())
      .mockResolvedValue(specJob({ status: 'passed', specs: [SPEC_A], results: [specResult(SPEC_A)], output: '  ✓  1 works\n  1 passed\n', nextOffset: 60 }));
    const panel = await openSpecsTab();
    await waitFor(() => expect(within(panel).getByTestId('run-all-specs')).toBeEnabled());
    fireEvent.click(within(panel).getAllByRole('button', { name: /^Run recurring/ })[0]);

    const modal = await screen.findByTestId('spec-run-modal');
    await waitFor(() => expect(within(modal).getByTestId('run-banner')).toHaveAttribute('data-status', 'passed'), { timeout: 4000 });
    expect(within(modal).getByRole('heading', { name: 'Specs passed' })).toBeInTheDocument();
    expect(within(modal).getByTestId('run-counts')).toHaveTextContent('✓ 1 passed');
    fireEvent.click(within(modal).getByRole('tab', { name: 'Output' }));
    expect(within(modal).getByRole('log')).toHaveTextContent('Running 1 test using 1 worker');
    expect(within(modal).getByRole('log')).toHaveTextContent('1 passed');

    fireEvent.click([...within(modal).getAllByRole('button', { name: 'Close' })].pop()!);
    await waitFor(() => expect(screen.queryByTestId('spec-run-modal')).not.toBeInTheDocument());

    expect(within(rows()[0]).getByLabelText('Passed')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Specs/ }).querySelector('[aria-label="Specs passed"]')).toBeInTheDocument();
    expect(screen.getByTestId('specs-last-run')).toHaveTextContent('✓ 1 passed');

    fireEvent.click(screen.getByRole('button', { name: 'Last output' }));
    expect(await screen.findByTestId('spec-run-modal')).toBeInTheDocument();
  });

  it('shows failures with the error and stack trace, a red X on the row and on the tab, and offers Run again', async () => {
    jobMock.mockResolvedValue(
      specJob({ status: 'failed', exitCode: 1, specs: [SPEC_B], results: [failedSpecResult(SPEC_B)], output: '  ✘  2 breaks\n', nextOffset: 20 }),
    );
    const panel = await openSpecsTab();
    await waitFor(() => expect(within(panel).getByTestId('run-all-specs')).toBeEnabled());
    fireEvent.click(within(panel).getAllByRole('button', { name: /^Run recurring/ })[1]);

    const modal = await screen.findByTestId('spec-run-modal');
    await waitFor(() => expect(within(modal).getByTestId('run-banner')).toHaveAttribute('data-status', 'failed'));
    expect(within(modal).getByTestId('spec-error')).toHaveTextContent('expect(locator).toContainText');
    expect(within(modal).getByTestId('spec-stack')).toHaveTextContent('recurring_comments_completed.spec.ts:57:9');

    startMock.mockResolvedValue({ id: 'job-2' });
    fireEvent.click(within(modal).getByRole('button', { name: /Run again/ }));
    await waitFor(() => expect(startMock).toHaveBeenLastCalledWith({ branch: 'AT-727-add-test', expectedSha: SHA, specs: [SPEC_B] }));

    fireEvent.click([...within(modal).getAllByRole('button', { name: 'Close' })].pop()!);
    await waitFor(() => expect(within(rows()[1]).getByLabelText(/Failed|Running/)).toBeInTheDocument());
  });

  it('one run at a time: Back and merge wait while specs run, then come back', async () => {
    jobMock.mockResolvedValueOnce(running()).mockResolvedValueOnce(running()).mockResolvedValue(specJob({ status: 'passed', specs: [SPEC_A], results: [specResult(SPEC_A)] }));
    const panel = await openSpecsTab();
    await waitFor(() => expect(within(panel).getByTestId('run-all-specs')).toBeEnabled());
    expect(mergeButton()).toBeEnabled();
    fireEvent.click(within(panel).getAllByRole('button', { name: /^Run recurring/ })[0]);

    const modal = await screen.findByTestId('spec-run-modal');
    fireEvent.click([...within(modal).getAllByRole('button', { name: 'Close' })].pop()!);
    await waitFor(() => expect(screen.queryByTestId('spec-run-modal')).not.toBeInTheDocument());

    expect(screen.getByRole('button', { name: /Back to Review/ })).toBeDisabled();
    expect(mergeButton()).toBeDisabled();
    expect(screen.getByText(/Specs are running. Merging is available when they finish/)).toBeInTheDocument();
    for (const b of within(screen.getByTestId('specs-panel')).getAllByRole('button', { name: /^Run recurring/ })) expect(b).toBeDisabled();
    expect(screen.getByRole('tab', { name: /^Specs/ }).querySelector('[aria-label="Specs running"]')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole('button', { name: /Back to Review/ })).toBeEnabled(), { timeout: 4000 });
    expect(mergeButton()).toBeEnabled();
  });

  it('asks the browser to confirm if the tab is closed while specs run', async () => {
    jobMock.mockResolvedValue(running());
    const panel = await openSpecsTab();
    await waitFor(() => expect(within(panel).getByTestId('run-all-specs')).toBeEnabled());
    fireEvent.click(within(panel).getByTestId('run-all-specs'));
    await screen.findByTestId('spec-run-modal');
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('can be cancelled from the modal, and then shows the cancelled state', async () => {
    jobMock.mockResolvedValueOnce(running());
    jobMock.mockResolvedValue(specJob({ status: 'cancelled', results: null, specs: [SPEC_A] }));
    const panel = await openSpecsTab();
    await waitFor(() => expect(within(panel).getByTestId('run-all-specs')).toBeEnabled());
    fireEvent.click(within(panel).getAllByRole('button', { name: /^Run recurring/ })[0]);

    const modal = await screen.findByTestId('spec-run-modal');
    fireEvent.click(await within(modal).findByRole('button', { name: /Cancel run/ }));
    await waitFor(() => expect(cancelMock).toHaveBeenCalledExactlyOnceWith('job-1'));
    await waitFor(() => expect(within(modal).getByTestId('run-banner')).toHaveAttribute('data-status', 'cancelled'), { timeout: 4000 });
  });
});
