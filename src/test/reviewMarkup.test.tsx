import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ReviewPage } from '../components/Review/ReviewPage';
import { cancelSpecRun, fetchGhStatus, fetchReviewDetail, fetchReviewList, fetchReviewStatus, fetchSpecJob, fetchTestServer, startSpecRun } from '../utils/reviewApi';
import { stubCanvas } from './canvasStub';
import { SPEC_A, SPEC_B, branch, detail, failedSpecResult, file, gh, list, specJob, specResult, status, testServer, ticket } from './reviewFixtures';

/**
 * Valid HTML only: no <div> inside a <p>, no <button> inside a <button>, and so on.
 *
 * This lives in its own file on purpose. React reports each invalid-nesting problem
 * once per module instance, so in a file that has already rendered the same markup
 * in an earlier test the warning is gone and a regression would pass unnoticed.
 * Here the spy is installed before anything renders.
 */

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

beforeAll(stubCanvas);

const NESTING = /cannot be a descendant|cannot contain a nested|validateDOMNesting|hydration|cannot be a child of|whitespace text nodes/i;
let spy: { mock: { calls: unknown[][] }; mockRestore: () => void };
const problems = () => spy.mock.calls.map((c) => c.map(String).join(' ')).filter((m) => NESTING.test(m));

const P = 'spec/playwright/playwright';
const approved = (over = {}) => detail({ ticket: { ...detail().ticket, approval: 'approved' }, ...over });

beforeEach(() => {
  spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  sessionStorage.clear();
  vi.mocked(fetchReviewStatus).mockResolvedValue(status());
  vi.mocked(fetchGhStatus).mockResolvedValue(gh());
  vi.mocked(fetchTestServer).mockResolvedValue(testServer());
  vi.mocked(fetchReviewList).mockResolvedValue(
    list({ tickets: [ticket(), ticket({ key: 'AT-726', summary: 'No branch yet', branches: [] }), ticket({ key: 'AT-725', branches: [branch({ name: 'AT-725-x', unmerged: 0 })] })] }),
  );
  vi.mocked(fetchReviewDetail).mockResolvedValue(approved());
  vi.mocked(startSpecRun).mockResolvedValue({ id: 'job-1' });
  vi.mocked(fetchSpecJob).mockResolvedValue(specJob({ status: 'failed', exitCode: 1, results: [failedSpecResult(SPEC_A), specResult(SPEC_B)], specs: [SPEC_A, SPEC_B] }));
  vi.mocked(cancelSpecRun).mockResolvedValue(specJob({ status: 'cleaning' }));
});

afterEach(() => spy.mockRestore());

async function openPr(over = {}) {
  vi.mocked(fetchReviewDetail).mockResolvedValue(approved(over));
  render(<ReviewPage />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'Review AT-727' }))[0]);
  await screen.findByTestId('merge-box');
}
const openTab = (name: RegExp | string) => fireEvent.click(screen.getByRole('tab', { name }));

describe('valid markup on the Review pages', () => {
  it('the table (a ticket with a branch, one without, one already merged)', async () => {
    render(<ReviewPage />);
    await screen.findByTestId('review-table');
    expect(screen.getAllByTestId('review-ticket')).toHaveLength(3);
    expect(problems()).toEqual([]);
  });

  it('the show page and every tab, including conflicts and a closed-out PR', async () => {
    await openPr({ files: [file({ path: 'a.ts' }), file({ path: 'b.ts' })], canRebase: false, conflicts: ['a.ts'] });
    openTab(/Commits/);
    openTab(/Files changed/);
    openTab('Conversation');
    expect(problems()).toEqual([]);
  });

  it('the Specs tab, with support files and a server-code warning', async () => {
    await openPr({ specs: [SPEC_A, SPEC_B], supportFiles: [`${P}/support/h.ts`, `${P}/fixtures/vcr_cassettes/c.yml`], serverCodeChanged: ['spec/e2e/app_commands/seed.rb'] });
    openTab(/^Specs/);
    expect(await screen.findByTestId('support-note')).toBeInTheDocument();
    expect(problems()).toEqual([]);
  });

  it('the Support files tab (a PR with no specs)', async () => {
    await openPr({ specs: [], supportFiles: [`${P}/support/h.ts`, `${P}/pages/p.ts`], serverCodeChanged: ['spec/e2e/app_commands/seed.rb'] });
    openTab(/^Support files/);
    expect(await screen.findByTestId('support-only-panel')).toBeInTheDocument();
    expect(problems()).toEqual([]);
  });

  it('the test server down message', async () => {
    vi.mocked(fetchTestServer).mockResolvedValue(testServer({ up: false }));
    await openPr({ specs: [SPEC_A] });
    openTab(/^Specs/);
    expect(await screen.findByTestId('test-server-down')).toBeInTheDocument();
    expect(problems()).toEqual([]);
  });

  it('the approve and decline modal and the inline merge confirmation', async () => {
    await openPr();
    fireEvent.click(within(screen.getByTestId('approval')).getByRole('button', { name: /^Decline/ }));
    expect(await screen.findByTestId('decision-modal')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('decision-modal')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('decision-modal')).not.toBeInTheDocument());

    fireEvent.click(within(screen.getByTestId('merge-box')).getByRole('button', { name: /^Rebase and merge/ }));
    expect(await screen.findByTestId('merge-confirm')).toBeInTheDocument();
    expect(problems()).toEqual([]);
  });

  it('the spec run modal, finished with a failure (summary, error and stack trace)', async () => {
    await openPr({ specs: [SPEC_A, SPEC_B] });
    openTab(/^Specs/);
    await waitFor(() => expect(screen.getByTestId('run-all-specs')).toBeEnabled());
    fireEvent.click(screen.getByTestId('run-all-specs'));
    const modal = await screen.findByTestId('spec-run-modal');
    expect(await within(modal).findByTestId('spec-error')).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('tab', { name: 'Output' }));
    expect(problems()).toEqual([]);
  });
});
