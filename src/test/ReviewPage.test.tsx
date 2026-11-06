import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { toast } from 'sonner';
import { ReviewPage } from '../components/Review/ReviewPage';
import { ReviewApiError, fetchGhStatus, fetchReviewDetail, fetchReviewList, fetchReviewStatus, fetchTestServer, mergeReview, submitReviewDecision } from '../utils/reviewApi';
import { stubCanvas } from './canvasStub';
import { SHA, branch, detail, file, gh, list, mergeResult, status, testServer, ticket } from './reviewFixtures';
import type { MergeResult } from '../types/review';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

// Keep the real ReviewApiError class; replace only the network calls.
vi.mock('../utils/reviewApi', async (importActual) => {
  const actual = await importActual<typeof import('../utils/reviewApi')>();
  return { ...actual, fetchReviewStatus: vi.fn(), fetchGhStatus: vi.fn(), fetchTestServer: vi.fn(), fetchReviewList: vi.fn(), fetchReviewDetail: vi.fn(), mergeReview: vi.fn(), submitReviewDecision: vi.fn() };
});

const statusMock = vi.mocked(fetchReviewStatus);
const ghMock = vi.mocked(fetchGhStatus);
const listMock = vi.mocked(fetchReviewList);
const detailMock = vi.mocked(fetchReviewDetail);
const mergeMock = vi.mocked(mergeReview);
const testServerMock = vi.mocked(fetchTestServer);
const decisionMock = vi.mocked(submitReviewDecision);

beforeAll(stubCanvas);

// The global test setup replaces localStorage with a no-op; give these tests a working one.
const localStore = new Map<string, string>();

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStore.clear();
  vi.spyOn(window.localStorage, 'getItem').mockImplementation((k: string) => localStore.get(k) ?? null);
  vi.spyOn(window.localStorage, 'setItem').mockImplementation((k: string, v: string) => void localStore.set(k, v));
  statusMock.mockResolvedValue(status());
  ghMock.mockResolvedValue(gh());
  listMock.mockResolvedValue(list());
  detailMock.mockResolvedValue(detail());
  mergeMock.mockResolvedValue(mergeResult());
  testServerMock.mockResolvedValue(testServer());
  // Jira echoes back what was saved
  decisionMock.mockImplementation(async ({ decision, info }) => ({ ...detail().ticket, approval: decision === 'none' ? null : decision, reviewInfo: info ?? '' }));
});

async function openReview(key = 'AT-727') {
  render(<ReviewPage />);
  fireEvent.click(await screen.findByRole('button', { name: `Review ${key}` }));
  await screen.findByTestId('merge-box');
}

const mergeBox = () => screen.getByTestId('merge-box');
const mergeButton = () => within(mergeBox()).getByRole('button', { name: /Rebase and merge|Rebasing and merging/ });
/** Approve or decline through the modal, the way a reviewer does. */
async function decide(kind: 'approve' | 'decline', info?: string) {
  fireEvent.click(within(screen.getByTestId('approval')).getByRole('button', { name: kind === 'approve' ? /^Approve/ : /^Decline/ }));
  const dialog = await screen.findByTestId('decision-modal');
  if (info !== undefined) fireEvent.change(within(dialog).getByLabelText(/Review information/), { target: { value: info } });
  fireEvent.click(within(dialog).getByRole('button', { name: /save to Jira/ }));
  await waitFor(() => expect(screen.queryByTestId('decision-modal')).not.toBeInTheDocument());
}
const approve = () => decide('approve');
/** The second click: GitHub-style inline confirmation. */
const confirmMerge = async () => {
  const confirm = within(await screen.findByTestId('merge-confirm')).getByRole('button', { name: 'Confirm rebase and merge' });
  // The merge settles asynchronously (mocked request, toasts, navigation); keep all of it inside act.
  await act(async () => {
    fireEvent.click(confirm);
  });
};
const openTab = (name: RegExp | string) => fireEvent.click(screen.getByRole('tab', { name }));

async function approveAndMerge() {
  await approve();
  fireEvent.click(mergeButton());
  await confirmMerge();
}

// ---------------------------------------------------------------------------

describe('Review page: table of tickets in the Review column', () => {
  it('shows a loading skeleton, then a table with the ticket details', async () => {
    render(<ReviewPage />);
    expect(screen.getByText(/Fetching from origin and Jira/)).toBeInTheDocument();

    const table = await screen.findByTestId('review-table');
    for (const heading of ['Pull request', 'Branch', 'Last pushed', 'Changes', 'Commits']) {
      expect(within(table).getByRole('columnheader', { name: heading })).toBeInTheDocument();
    }
    const row = within(table).getByTestId('review-ticket');
    expect(row).toHaveTextContent('Add tests for comments carrying over');
    expect(row).toHaveTextContent('#AT-727');
    expect(within(row).getAllByText('AT-727-add-test').length).toBeGreaterThan(0);
    expect(row).toHaveTextContent('Brian Baggs');
    expect(row).toHaveTextContent('3 hours ago');
    expect(row).toHaveTextContent('1 commit');
    expect(within(row).getByText('Review', { selector: '[class*="bg-secondary"]' })).toBeInTheDocument();
  });

  it('shows the git diff --stat summary (files, additions, deletions) per branch', async () => {
    render(<ReviewPage />);
    const stat = (await screen.findAllByTestId('diff-stat'))[0];
    expect(stat).toHaveTextContent('3 files');
    expect(stat).toHaveTextContent('+120');
    expect(stat).toHaveTextContent('−4');
  });

  it('counts open pull requests and tickets', async () => {
    listMock.mockResolvedValue(list({ tickets: [ticket(), ticket({ key: 'AT-726', summary: 'MCP tools', branches: [branch({ name: 'AT-726-mcp' })] })] }));
    render(<ReviewPage />);
    expect(await screen.findByText(/2 Open/)).toBeInTheDocument();
    expect(screen.getByText(/2 tickets in the Review column/)).toBeInTheDocument();
    expect(screen.getAllByTestId('review-ticket')).toHaveLength(2);
  });

  it('links the ticket to Jira without opening the review', async () => {
    render(<ReviewPage />);
    const link = await screen.findByRole('link', { name: /#AT-727/ });
    expect(link).toHaveAttribute('href', 'https://securicyapp.atlassian.net/browse/AT-727');
    expect(link).toHaveAttribute('target', '_blank');
    fireEvent.click(link);
    expect(detailMock).not.toHaveBeenCalled();
  });

  it('explains the whole flow, including that the branch is deleted and the ticket moves to Done', async () => {
    render(<ReviewPage />);
    await screen.findByTestId('review-table');
    expect(screen.getByText(/AT board's Review column/)).toBeInTheDocument();
    expect(screen.getByText(/the branch is deleted, and the ticket moves to Done/)).toBeInTheDocument();
  });

  it('flags a branch that is behind playwright-main as automatically rebased', async () => {
    listMock.mockResolvedValue(list({ tickets: [ticket({ branches: [branch({ unmerged: 3, behind: 2 })] })] }));
    render(<ReviewPage />);
    expect(await screen.findByText('3 commits')).toBeInTheDocument();
    expect(screen.getByText('2 behind — auto-rebased')).toBeInTheDocument();
  });

  it('marks a branch that playwright-main already has', async () => {
    listMock.mockResolvedValue(list({ tickets: [ticket({ branches: [branch({ unmerged: 0 })] })] }));
    render(<ReviewPage />);
    expect(await screen.findByText('Already in playwright-main')).toBeInTheDocument();
  });

  it('says so when a Review ticket has no branch pushed yet', async () => {
    listMock.mockResolvedValue(list({ tickets: [ticket({ branches: [] })] }));
    render(<ReviewPage />);
    expect(await screen.findByText(/has been pushed to origin yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review AT-727' })).not.toBeInTheDocument();
  });

  it('lists several branches of one ticket as separate rows', async () => {
    listMock.mockResolvedValue(list({ tickets: [ticket({ branches: [branch(), branch({ name: 'AT-727-second-try', sha: 'f'.repeat(40) })] })] }));
    render(<ReviewPage />);
    await screen.findByTestId('review-table');
    expect(screen.getAllByTestId('review-ticket')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Review AT-727' })).toHaveLength(2);
  });

  it('opens a pull request by clicking its row, its title, or its Review button', async () => {
    render(<ReviewPage />);
    const row = await screen.findByTestId('review-ticket');
    fireEvent.click(row);
    await screen.findByTestId('merge-box');
    expect(detailMock).toHaveBeenCalledTimes(1);
  });

  it('opens from the Review button in the row too', async () => {
    render(<ReviewPage />);
    const row = await screen.findByTestId('review-ticket');
    fireEvent.click(row.querySelector('button[aria-hidden="true"]')!);
    await screen.findByTestId('merge-box');
  });

  it('celebrates an empty Review column', async () => {
    listMock.mockResolvedValue(list({ tickets: [] }));
    render(<ReviewPage />);
    expect(await screen.findByTestId('review-empty')).toHaveTextContent('Nothing is in the Review column right now.');
    expect(screen.queryByTestId('review-table')).not.toBeInTheDocument();
  });

  it('shows NOTHING (and says why) when Jira cannot be read — it never falls back to branches', async () => {
    listMock.mockResolvedValue(list({ tickets: [], jira: { error: "acli isn't logged in to Jira. Run `acli auth login` in a terminal, then refresh.", errorKind: 'not-authenticated' } }));
    render(<ReviewPage />);

    expect(await screen.findByTestId('jira-warning')).toHaveTextContent('there is nothing to show');
    expect(screen.getByTestId('jira-warning')).toHaveTextContent('acli auth login');
    expect(screen.queryByTestId('review-table')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('light-acli')).toHaveAttribute('data-state', 'bad');
  });

  it('shows the error when the page cannot load, and recovers with Try again', async () => {
    statusMock.mockRejectedValueOnce(new ReviewApiError('Could not reach the local review server.'));
    render(<ReviewPage />);
    expect(await screen.findByTestId('review-error')).toHaveTextContent('Could not reach the local review server.');

    fireEvent.click(within(screen.getByTestId('review-error')).getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('review-table');
    expect(screen.queryByTestId('review-error')).not.toBeInTheDocument();
  });

  it('uses a generic message for non-Error failures', async () => {
    listMock.mockRejectedValue('weird');
    render(<ReviewPage />);
    expect(await screen.findByTestId('review-error')).toHaveTextContent('Could not load tickets.');
  });

  it('refreshes status, list and gh on demand and disables the button while loading', async () => {
    render(<ReviewPage />);
    await screen.findByTestId('review-table');
    expect([statusMock, listMock, ghMock].map((m) => m.mock.calls.length)).toEqual([1, 1, 1]);

    let resolve!: (v: ReturnType<typeof list>) => void;
    listMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/ }));

    expect(screen.getByRole('button', { name: /^Refresh/ })).toBeDisabled();
    resolve(list({ tickets: [ticket({ key: 'AT-800', summary: 'Fresh ticket' })] }));
    expect(await screen.findByText('Fresh ticket')).toBeInTheDocument();
    expect([statusMock, listMock, ghMock].map((m) => m.mock.calls.length)).toEqual([2, 2, 2]);
  });
});

describe('Review page: link and content safety', () => {
  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'vbscript:x', 'not a url'])(
    'never renders %s as a link (the ticket key is shown as plain text)',
    async (url) => {
      listMock.mockResolvedValue(list({ tickets: [ticket({ url })] }));
      render(<ReviewPage />);
      await screen.findByTestId('review-table');
      expect(screen.queryByRole('link', { name: /AT-727/ })).not.toBeInTheDocument();
      expect(screen.getByTestId('review-ticket')).toHaveTextContent('#AT-727');
      expect(document.querySelector('a[href^="javascript"], a[href^="data"], a[href^="file"]')).toBeNull();
    },
  );

  it('does not turn an unsafe URL on the show page into a link either', async () => {
    detailMock.mockResolvedValue(detail({ branchUrl: 'javascript:alert(1)', ticket: { ...detail().ticket, url: 'javascript:alert(2)' } }));
    await openReview();
    expect(screen.queryByRole('link', { name: /View on GitHub/ })).not.toBeInTheDocument();
    expect(within(screen.getByTestId('pr-sidebar')).queryByRole('link')).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it('renders hostile ticket titles, branch names, authors and commit messages as inert text', async () => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
    listMock.mockResolvedValue(list({ tickets: [ticket({ summary: evil, branches: [branch({ author: evil })] })] }));
    detailMock.mockResolvedValue(
      detail({ ticket: { ...detail().ticket, summary: evil }, commits: [{ ...detail().commits[0], subject: evil, body: evil, author: evil }] }),
    );
    render(<ReviewPage />);
    await screen.findByTestId('review-table');
    expect(document.querySelector('img, script')).toBeNull();
    expect(screen.getByTestId('review-table')).toHaveTextContent('<img src=x onerror=');

    fireEvent.click(screen.getByRole('button', { name: 'Review AT-727' }));
    await screen.findByTestId('merge-box');
    expect(document.querySelector('img, script')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});

describe('Review page: status lights and setup help', () => {
  it('shows four green lights when git, acli, gh and the repo are ready', async () => {
    render(<ReviewPage />);
    await screen.findByTestId('review-table');
    await waitFor(() => expect(screen.getByTestId('light-gh')).toHaveAttribute('data-state', 'ok'));
    for (const id of ['git', 'repo', 'acli', 'gh']) expect(screen.getByTestId(`light-${id}`)).toHaveAttribute('data-state', 'ok');
    expect(screen.getByTestId('light-gh')).toHaveTextContent('Signed in as BrianBaggs');
  });

  it('lights are grey while checking, then turn green', async () => {
    render(<ReviewPage />);
    expect(screen.getByTestId('light-git')).toHaveAttribute('data-state', 'checking');
    await waitFor(() => expect(screen.getByTestId('light-git')).toHaveAttribute('data-state', 'ok'));
  });

  it('tells the user to install what is missing, instead of loading anything', async () => {
    statusMock.mockResolvedValue(
      status({
        ok: false,
        requirements: [
          { id: 'git', label: 'Git', ok: true, fix: '' },
          { id: 'acli', label: 'Atlassian CLI (acli)', ok: false, fix: "The Atlassian CLI isn't installed.", command: 'brew tap atlassian/homebrew-acli && brew install acli', url: 'https://developer.atlassian.com/cloud/acli/guides/install-acli/' },
          { id: 'repo', label: 'securicy-app checkout', ok: true, fix: '' },
          { id: 'remote', label: '"origin" remote', ok: true, fix: '' },
        ],
      }),
    );
    render(<ReviewPage />);

    const panel = await screen.findByTestId('setup-panel');
    expect(panel).toHaveTextContent('Install these first');
    expect(within(screen.getByTestId('requirement-acli')).getByText(/brew install acli/)).toBeInTheDocument();
    expect(screen.getByTestId('light-acli')).toHaveAttribute('data-state', 'bad');
    expect(listMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('review-table')).not.toBeInTheDocument();
    expect(screen.queryByText(/Fetching from origin/)).not.toBeInTheDocument();
  });

  it('"Check again" re-checks and loads the tickets once the tools are installed', async () => {
    statusMock.mockResolvedValueOnce(status({ ok: false, requirements: [{ id: 'git', label: 'Git', ok: false, fix: "Git isn't installed.", command: 'brew install git' }] }));
    render(<ReviewPage />);
    await screen.findByTestId('setup-panel');

    fireEvent.click(screen.getByRole('button', { name: /Check again/ }));

    await screen.findByTestId('review-table');
    expect(screen.queryByTestId('setup-panel')).not.toBeInTheDocument();
  });

  it('a missing or signed-out gh only turns its light amber — the page still works', async () => {
    ghMock.mockResolvedValue(gh({ state: 'not-authenticated', account: null, detail: "The GitHub CLI isn't signed in.", command: 'gh auth login' }));
    render(<ReviewPage />);

    await screen.findByTestId('review-table');
    await waitFor(() => expect(screen.getByTestId('light-gh')).toHaveAttribute('data-state', 'warn'));
    expect(within(screen.getByTestId('status-hints')).getByText('gh auth login')).toBeInTheDocument();
  });

  it('a gh check that fails outright never breaks the page', async () => {
    ghMock.mockRejectedValue(new Error('network'));
    render(<ReviewPage />);
    await screen.findByTestId('review-table');
    await waitFor(() => expect(screen.getByTestId('light-gh')).toHaveAttribute('data-state', 'warn'));
    expect(screen.queryByTestId('review-error')).not.toBeInTheDocument();
  });
});

describe('Pull request show page', () => {
  it('opens the selected branch, asks the server for exactly that branch, and shows the ticket', async () => {
    await openReview();
    expect(detailMock).toHaveBeenCalledExactlyOnceWith('AT-727-add-test');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Add tests for comments carrying over #AT-727');
    expect(screen.getByTestId('pr-state')).toHaveTextContent('Open');
    expect(screen.getByText(/wants to merge 1 commit into/)).toBeInTheDocument();
  });

  it('has a Back to Review button that returns to the table without refetching', async () => {
    await openReview();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('AT-727');
    fireEvent.click(screen.getByRole('button', { name: /Back to Review/ }));
    expect(await screen.findByTestId('review-table')).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('shows a skeleton while loading and an error with Try again when it fails', async () => {
    detailMock.mockReturnValueOnce(new Promise(() => {}));
    render(<ReviewPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review AT-727' }));
    expect(screen.getByText('Loading pull request…')).toBeInTheDocument();
    expect(screen.getByTestId('detail-loading')).toHaveTextContent('Reading AT-727 from Jira');
    expect(screen.getByTestId('detail-loading').querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('replaces the loading indicator with the page once loaded', async () => {
    await openReview();
    expect(screen.queryByTestId('detail-loading')).not.toBeInTheDocument();
  });

  it('recovers from a load error with Try again', async () => {
    detailMock.mockRejectedValueOnce(new ReviewApiError("AT-727 isn't in the Review column of the AT board, so it can't be reviewed or merged here."));
    render(<ReviewPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review AT-727' }));

    expect(await screen.findByTestId('detail-error')).toHaveTextContent("isn't in the Review column");
    fireEvent.click(within(screen.getByTestId('detail-error')).getByRole('button', { name: 'Try again' }));

    await screen.findByTestId('merge-box');
    expect(detailMock).toHaveBeenCalledTimes(2);
  });

  it('uses a generic message for non-Error load failures', async () => {
    detailMock.mockRejectedValue('weird');
    render(<ReviewPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review AT-727' }));
    expect(await screen.findByText('Could not load this branch.')).toBeInTheDocument();
  });

  it('shows Merged when the base already has the changes', async () => {
    detailMock.mockResolvedValue(detail({ unmerged: 0 }));
    await openReview();
    expect(screen.getByTestId('pr-state')).toHaveTextContent('Merged');
    expect(screen.getByText('Already merged')).toBeInTheDocument();
  });

  it('shows the conversation: stats, review progress, commits and a ticket sidebar', async () => {
    await openReview();

    expect(screen.getByTestId('stat-files')).toHaveTextContent('1');
    expect(screen.getByTestId('stat-commits')).toHaveTextContent('1');
    expect(screen.getByTestId('stat-additions')).toHaveTextContent('+2');
    expect(screen.getByTestId('stat-deletions')).toHaveTextContent('−0');
    expect(screen.getByTestId('review-progress')).toHaveTextContent('0 of 1 file viewed');
    expect(within(screen.getByTestId('conversation')).getByText('AT-727 Add tests')).toBeInTheDocument();

    const sidebar = screen.getByTestId('pr-sidebar');
    expect(sidebar).toHaveTextContent('Review');
    expect(sidebar).toHaveTextContent('Brian Baggs');
    // Reviewer sits directly under Assignee
    const labels = within(sidebar).getAllByText(/^(Ticket|Jira status|Assignee|Reviewer|Last pushed by|Base|Compare)$/).map((e) => e.textContent);
    expect(labels.indexOf('Reviewer')).toBe(labels.indexOf('Assignee') + 1);
    expect(sidebar).toHaveTextContent('Matthew Carabin');
    expect(sidebar).toHaveTextContent('playwright-main');
    expect(within(sidebar).getByRole('link', { name: /AT-727/ })).toHaveAttribute('href', 'https://securicyapp.atlassian.net/browse/AT-727');
  });

  it('links to the branch on GitHub when known', async () => {
    await openReview();
    expect(screen.getByRole('link', { name: /View on GitHub/ })).toHaveAttribute('href', 'https://github.com/carbidesecure/securicy-app/tree/AT-727-add-test');
  });

  it('shows a dash when there is no reviewer', async () => {
    detailMock.mockResolvedValue(detail({ ticket: { ...detail().ticket, reviewers: [] } }));
    await openReview();
    const sidebar = screen.getByTestId('pr-sidebar');
    const reviewerRow = within(sidebar).getByText('Reviewer').parentElement!;
    expect(reviewerRow).toHaveTextContent('—');
  });

  it('lists several reviewers separated by commas', async () => {
    detailMock.mockResolvedValue(detail({ ticket: { ...detail().ticket, reviewers: ['Matthew Carabin', 'Brian Baggs'] } }));
    await openReview();
    expect(screen.getByTestId('pr-sidebar')).toHaveTextContent('Matthew Carabin, Brian Baggs');
  });

  it('has no GitHub link or assignee when unknown', async () => {
    detailMock.mockResolvedValue(detail({ branchUrl: null, ticket: { ...detail().ticket, assignee: null, url: null } }));
    await openReview();
    expect(screen.queryByRole('link', { name: /View on GitHub/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('pr-sidebar')).toHaveTextContent('—');
  });

  it('shows the full commit messages on the Commits tab', async () => {
    await openReview();
    openTab(/Commits \(1\)/);
    expect(screen.getByTestId('commit-list')).toHaveTextContent('Longer description');
    expect(screen.getByTestId('commit-list')).toHaveTextContent(/Brian Baggs · .* · cccccccccc/);
  });

  it('omits an empty commit body', async () => {
    detailMock.mockResolvedValue(detail({ commits: [{ ...detail().commits[0], body: '' }] }));
    await openReview();
    openTab(/Commits/);
    expect(screen.queryByText('Longer description')).not.toBeInTheDocument();
  });
});

describe('Pull request show page: reading the code (Files changed)', () => {
  const twoFiles = () =>
    detail({
      files: [file({ path: 'spec/a.spec.ts' }), file({ path: 'spec/b.spec.ts', patch: '@@ -0,0 +1 @@\n+b content' })],
      totals: { additions: 4, deletions: 0 },
    });

  it('shows the diff for each file with a summary line and total counts', async () => {
    await openReview();
    openTab(/Files changed/);

    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1 changed file with 2 additions and 0 deletions.');
    expect(screen.getAllByTestId('file-diff')).toHaveLength(1);
    expect(screen.getByTestId('diff-body').textContent).toContain('first line');
  });

  it('shows a jump-to-file index when there are several files, and expands the file it jumps to', async () => {
    detailMock.mockResolvedValue(twoFiles());
    await openReview();
    openTab(/Files changed/);

    const index = screen.getByTestId('file-index');
    expect(within(index).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryAllByTestId('diff-body')).toHaveLength(0);

    fireEvent.click(within(index).getByRole('button', { name: /spec\/b\.spec\.ts/ }));
    await waitFor(() => expect(screen.getAllByTestId('diff-body')).toHaveLength(1));
    expect(screen.getByTestId('diff-body').textContent).toContain('b content');
  });

  it('has no file index for a single file', async () => {
    await openReview();
    openTab(/Files changed/);
    expect(screen.queryByTestId('file-index')).not.toBeInTheDocument();
  });

  it('expands and collapses everything', async () => {
    detailMock.mockResolvedValue(twoFiles());
    await openReview();
    openTab(/Files changed/);

    expect(screen.getAllByTestId('diff-body')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryAllByTestId('diff-body')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getAllByTestId('diff-body')).toHaveLength(2);
  });

  it('collapses a file when it is marked Viewed, tracks progress, and remembers it for the session', async () => {
    detailMock.mockResolvedValue(twoFiles());
    await openReview();
    openTab(/Files changed/);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Viewed spec/a.spec.ts' }));

    expect(screen.getAllByTestId('diff-body')).toHaveLength(1);
    expect(screen.getAllByTestId('file-diff')[0]).toHaveAttribute('data-viewed', 'true');
    expect(screen.getByTestId('review-footer')).toHaveTextContent('1 of 2 files viewed');
    expect(JSON.parse(sessionStorage.getItem(`review-viewed:AT-727-add-test@${SHA}`)!)).toEqual(['spec/a.spec.ts']);

    openTab('Conversation');
    expect(screen.getByTestId('review-progress')).toHaveTextContent('1 of 2 files viewed');
    expect(screen.getByRole('progressbar', { name: 'Files viewed' })).toHaveAttribute('aria-valuenow', '50');
    expect(within(screen.getByTestId('review-progress')).getByRole('button', { name: /Continue reviewing/ })).toBeInTheDocument();
  });

  it('re-opens a file when it is un-viewed', async () => {
    detailMock.mockResolvedValue(twoFiles());
    await openReview();
    openTab(/Files changed/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Viewed spec/a.spec.ts' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Viewed spec/a.spec.ts' }));
    expect(screen.getAllByTestId('diff-body')).toHaveLength(2);
    expect(screen.getByTestId('review-footer')).toHaveTextContent('0 of 2 files viewed');
  });

  it('restores viewed files when the review is reopened in the same session', async () => {
    detailMock.mockResolvedValue(twoFiles());
    sessionStorage.setItem(`review-viewed:AT-727-add-test@${SHA}`, JSON.stringify(['spec/a.spec.ts']));
    await openReview();
    expect(screen.getByTestId('review-progress')).toHaveTextContent('1 of 2 files viewed');
    openTab(/Files changed/);
    expect(screen.getAllByTestId('diff-body')).toHaveLength(1); // the viewed file starts collapsed
  });

  it('ignores viewed progress from an older commit of the branch', async () => {
    sessionStorage.setItem(`review-viewed:AT-727-add-test@${'9'.repeat(40)}`, JSON.stringify(['spec/recurring.spec.ts']));
    await openReview();
    expect(screen.getByTestId('review-progress')).toHaveTextContent('0 of 1 file viewed');
  });

  it('collapses files by default when there are many', async () => {
    detailMock.mockResolvedValue(detail({ files: Array.from({ length: 16 }, (_, i) => file({ path: `spec/f${i}.spec.ts` })) }));
    await openReview();
    openTab(/Files changed/);
    expect(screen.getAllByTestId('file-diff')).toHaveLength(16);
    expect(screen.queryAllByTestId('diff-body')).toHaveLength(0);
  });

  it('switches between split and unified and remembers the choice', async () => {
    await openReview();
    openTab(/Files changed/);

    const group = screen.getByRole('group', { name: 'Diff view' });
    expect(within(group).getByRole('button', { name: 'split' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('diff-body')).toHaveAttribute('data-mode', 'split');

    fireEvent.click(within(group).getByRole('button', { name: 'unified' }));

    expect(screen.getByTestId('diff-body')).toHaveAttribute('data-mode', 'unified');
    expect(localStore.get('review-diff-mode')).toBe('unified');
  });

  it('starts in the remembered diff mode', async () => {
    localStore.set('review-diff-mode', 'unified');
    await openReview();
    openTab(/Files changed/);
    expect(screen.getByTestId('diff-body')).toHaveAttribute('data-mode', 'unified');
  });

  it('says when there are no file changes', async () => {
    detailMock.mockResolvedValue(detail({ files: [], totals: { additions: 0, deletions: 0 } }));
    await openReview();
    expect(screen.queryByTestId('review-progress')).not.toBeInTheDocument();
    openTab(/Files changed/);
    expect(screen.getByText('No file changes.')).toBeInTheDocument();
  });

  it('keeps the action bar stuck flush to the bottom edge with no gap under it', async () => {
    await openReview();
    openTab(/Files changed/);
    const footer = screen.getByTestId('review-footer');
    expect(footer).toHaveClass('sticky', 'bottom-0');
    expect(footer.className).not.toMatch(/bottom-[1-9]/);
  });

  it('lets you approve from the sticky footer (through the modal) and jump to the merge box', async () => {
    await openReview();
    openTab(/Files changed/);

    const footer = screen.getByTestId('review-footer');
    fireEvent.click(within(footer).getByRole('button', { name: /^Approve/ }));
    fireEvent.click(within(await screen.findByTestId('decision-modal')).getByRole('button', { name: /Approve and save to Jira/ }));
    await waitFor(() => expect(footer).toHaveTextContent('approved in Jira'));
    expect(within(footer).queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument();

    fireEvent.click(within(footer).getByRole('button', { name: 'Go to merge box' }));
    expect(screen.getByRole('tab', { name: 'Conversation' })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByTestId('approval')).getByText(/Approved in Jira/)).toBeInTheDocument();
  });

  it('lets you decline from the sticky footer', async () => {
    await openReview();
    openTab(/Files changed/);
    const footer = screen.getByTestId('review-footer');
    fireEvent.click(within(footer).getByRole('button', { name: /^Decline/ }));
    const dialog = await screen.findByTestId('decision-modal');
    fireEvent.change(within(dialog).getByLabelText(/Review information/), { target: { value: 'Missing cleanup' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Decline and save to Jira/ }));
    await waitFor(() => expect(footer).toHaveTextContent('declined in Jira'));
    expect(decisionMock).toHaveBeenCalledWith({ branch: 'AT-727-add-test', expectedSha: SHA, decision: 'declined', info: 'Missing cleanup' });
  });

  it('does not offer to decide on a branch that has conflicts', async () => {
    detailMock.mockResolvedValue(detail({ canRebase: false, conflicts: ['a.txt'] }));
    await openReview();
    openTab(/Files changed/);
    const footer = within(screen.getByTestId('review-footer'));
    expect(footer.queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument();
    expect(footer.queryByRole('button', { name: /^Decline/ })).not.toBeInTheDocument();
  });
});

describe('Pull request show page: approving (the Approval field in Jira)', () => {
  it('keeps Rebase and merge disabled until the PR is approved', async () => {
    await openReview();
    expect(mergeButton()).toBeDisabled();
    expect(screen.getByText('Approve the changes above to enable this button.')).toBeInTheDocument();
    expect(within(screen.getByTestId('approval'))).toBeTruthy();
    expect(screen.getByTestId('approval')).toHaveAttribute('data-state', 'none');

    await approve();

    expect(mergeButton()).toBeEnabled();
    expect(screen.getByTestId('approval')).toHaveAttribute('data-state', 'approved');
    expect(screen.getByText(/Approved in Jira/)).toBeInTheDocument();
    expect(screen.queryByText('Approve the changes above to enable this button.')).not.toBeInTheDocument();
  });

  it('records the approval on the reviewed commit', async () => {
    await openReview();
    await approve();
    expect(decisionMock).toHaveBeenCalledExactlyOnceWith({ branch: 'AT-727-add-test', expectedSha: SHA, decision: 'approved', info: undefined });
  });

  it('reads an existing approval from Jira, so an approved ticket can be merged straight away', async () => {
    detailMock.mockResolvedValue(detail({ ticket: { ...detail().ticket, approval: 'approved', reviewInfo: 'LGTM' } }));
    await openReview();
    expect(mergeButton()).toBeEnabled();
    expect(screen.getByTestId('approval')).toHaveAttribute('data-state', 'approved');
    expect(screen.getByTestId('review-info')).toHaveTextContent('LGTM');
    expect(screen.getByTestId('pr-sidebar')).toHaveTextContent('Approved');
  });

  it('a declined ticket shows the reason and cannot be merged until approved instead', async () => {
    detailMock.mockResolvedValue(detail({ ticket: { ...detail().ticket, approval: 'declined', reviewInfo: 'The cleanup step is missing' } }));
    await openReview();

    expect(screen.getByTestId('approval')).toHaveAttribute('data-state', 'declined');
    expect(screen.getByText(/Declined in Jira. Merging is blocked/)).toBeInTheDocument();
    expect(screen.getByTestId('review-info')).toHaveTextContent('The cleanup step is missing');
    expect(mergeButton()).toBeDisabled();
    expect(screen.getByText(/This PR was declined/)).toBeInTheDocument();
    expect(within(screen.getByTestId('approval')).queryByRole('button', { name: /^Decline/ })).not.toBeInTheDocument();

    await decide('approve');
    expect(mergeButton()).toBeEnabled();
  });

  it('can undo an approval, which clears the checkbox in Jira', async () => {
    await openReview();
    await approve();
    fireEvent.click(screen.getByRole('button', { name: /Undo approval/ }));
    await waitFor(() => expect(mergeButton()).toBeDisabled());
    expect(decisionMock).toHaveBeenLastCalledWith({ branch: 'AT-727-add-test', expectedSha: SHA, decision: 'none' });
    expect(toast.success).toHaveBeenCalledWith('AT-727: decision cleared in Jira.');
    expect(screen.getByTestId('approval')).toHaveAttribute('data-state', 'none');
  });

  it('can clear a decline too, and shows progress while clearing', async () => {
    detailMock.mockResolvedValue(detail({ ticket: { ...detail().ticket, approval: 'declined', reviewInfo: 'x' } }));
    let resolve!: (v: ReturnType<typeof detail>['ticket']) => void;
    decisionMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: /Clear decision/ }));
    expect(await screen.findByRole('button', { name: /Clearing…/ })).toBeDisabled();
    resolve({ ...detail().ticket, approval: null, reviewInfo: '' });
    await waitFor(() => expect(screen.getByTestId('approval')).toHaveAttribute('data-state', 'none'));
  });

  it('tells you when clearing fails and leaves the state as it was', async () => {
    await openReview();
    await approve();
    decisionMock.mockRejectedValueOnce(new ReviewApiError('Jira did not save the review on AT-727'));
    fireEvent.click(screen.getByRole('button', { name: /Undo approval/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Jira did not save the review on AT-727'));
    expect(screen.getByTestId('approval')).toHaveAttribute('data-state', 'approved');
    expect(mergeButton()).toBeEnabled();
  });

  it('uses a generic message when clearing fails without one', async () => {
    await openReview();
    await approve();
    decisionMock.mockRejectedValueOnce('weird');
    fireEvent.click(screen.getByRole('button', { name: /Undo approval/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not clear the decision in Jira.'));
  });
});

describe('Review decision modal', () => {
  const open = (kind: 'Approve' | 'Decline') => fireEvent.click(within(screen.getByTestId('approval')).getByRole('button', { name: new RegExp(`^${kind}`) }));

  it('approving: a text box for optional notes, saved into the ticket', async () => {
    await openReview();
    open('Approve');

    const dialog = await screen.findByTestId('decision-modal');
    expect(within(dialog).getByRole('heading', { name: 'Approve AT-727' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('ticks Approved on AT-727 in Jira');
    expect(dialog).toHaveTextContent('Review Information');
    expect(within(dialog).getByLabelText(/Review information/)).toBeInTheDocument();
    expect(within(dialog).getByText('(optional)')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/Review information/), { target: { value: '  Looks good, nice cleanup.  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and save to Jira' }));

    await waitFor(() => expect(screen.queryByTestId('decision-modal')).not.toBeInTheDocument());
    expect(decisionMock).toHaveBeenCalledExactlyOnceWith({ branch: 'AT-727-add-test', expectedSha: SHA, decision: 'approved', info: 'Looks good, nice cleanup.' });
    expect(toast.success).toHaveBeenCalledWith('AT-727 approved in Jira.');
    expect(screen.getByTestId('review-info')).toHaveTextContent('Looks good, nice cleanup.');
  });

  it('declining: the reason is required, and nothing is sent without it', async () => {
    await openReview();
    open('Decline');
    const dialog = await screen.findByTestId('decision-modal');
    expect(within(dialog).getByRole('heading', { name: 'Decline AT-727' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('A declined PR can\'t be merged');
    expect(dialog).not.toHaveTextContent('(optional)');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline and save to Jira' }));

    expect(within(dialog).getByTestId('review-info-help')).toHaveTextContent('Say why you are declining');
    expect(within(dialog).getByLabelText(/Review information/)).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByRole('button', { name: 'Decline and save to Jira' })).toBeDisabled();
    expect(decisionMock).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Review information/), { target: { value: 'The cleanup step is missing.\nAlso tag it @critical.' } });
    expect(within(dialog).getByRole('button', { name: 'Decline and save to Jira' })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline and save to Jira' }));

    await waitFor(() => expect(screen.queryByTestId('decision-modal')).not.toBeInTheDocument());
    expect(decisionMock).toHaveBeenCalledExactlyOnceWith({ branch: 'AT-727-add-test', expectedSha: SHA, decision: 'declined', info: 'The cleanup step is missing.\nAlso tag it @critical.' });
    expect(toast.success).toHaveBeenCalledWith('AT-727 declined in Jira.');
    expect(screen.getByTestId('approval')).toHaveAttribute('data-state', 'declined');
    expect(screen.getByTestId('review-info')).toHaveTextContent('The cleanup step is missing.');
    expect(mergeButton()).toBeDisabled();
  });

  it('a reason of only spaces does not count', async () => {
    await openReview();
    open('Decline');
    const dialog = await screen.findByTestId('decision-modal');
    fireEvent.change(within(dialog).getByLabelText(/Review information/), { target: { value: '    \n  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline and save to Jira' }));
    expect(decisionMock).not.toHaveBeenCalled();
    expect(within(dialog).getByTestId('review-info-help')).toHaveTextContent('Say why');
  });

  it('shows a live character count and blocks text over the limit', async () => {
    await openReview();
    open('Approve');
    const dialog = await screen.findByTestId('decision-modal');
    expect(within(dialog).getByTestId('review-info-count')).toHaveTextContent('0 / 5,000');
    fireEvent.change(within(dialog).getByLabelText(/Review information/), { target: { value: 'x'.repeat(12) } });
    expect(within(dialog).getByTestId('review-info-count')).toHaveTextContent('12 / 5,000');

    fireEvent.change(within(dialog).getByLabelText(/Review information/), { target: { value: 'x'.repeat(5001) } });
    expect(within(dialog).getByTestId('review-info-count')).toHaveClass('text-destructive');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and save to Jira' }));
    expect(within(dialog).getByTestId('review-info-help')).toHaveTextContent('limited to 5,000 characters');
    expect(decisionMock).not.toHaveBeenCalled();
  });

  it('starts from the ticket\'s existing review information so it can be edited', async () => {
    detailMock.mockResolvedValue(detail({ ticket: { ...detail().ticket, approval: 'declined', reviewInfo: 'Earlier note' } }));
    await openReview();
    open('Approve');
    expect(within(await screen.findByTestId('decision-modal')).getByLabelText(/Review information/)).toHaveValue('Earlier note');
  });

  it('shows saving progress and cannot be dismissed or edited while saving', async () => {
    let resolve!: (v: ReturnType<typeof detail>['ticket']) => void;
    decisionMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await openReview();
    open('Approve');
    const dialog = await screen.findByTestId('decision-modal');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and save to Jira' }));

    const saving = await within(dialog).findByRole('button', { name: /Saving to Jira…/ });
    expect(saving).toBeDisabled();
    expect(saving).toHaveAttribute('aria-busy', 'true');
    expect(saving.querySelector('.animate-spin')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(within(dialog).getByLabelText(/Review information/)).toBeDisabled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByTestId('decision-modal')).toBeInTheDocument();
    expect(decisionMock).toHaveBeenCalledTimes(1);

    resolve({ ...detail().ticket, approval: 'approved' });
    await waitFor(() => expect(screen.queryByTestId('decision-modal')).not.toBeInTheDocument());
  });

  it('keeps your text and offers a manual fallback when Jira cannot be updated, then retries', async () => {
    decisionMock.mockRejectedValueOnce(new ReviewApiError("Your acli can't set these Jira fields. Set Approval and Review Information on AT-727 in Jira instead."));
    await openReview();
    open('Decline');
    const dialog = await screen.findByTestId('decision-modal');
    fireEvent.change(within(dialog).getByLabelText(/Review information/), { target: { value: 'Needs a cleanup step' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline and save to Jira' }));

    const error = await within(dialog).findByTestId('decision-error');
    expect(error).toHaveTextContent("Your acli can't set these Jira fields");
    expect(error).toHaveTextContent('Your text is still here');
    expect(within(dialog).getByLabelText(/Review information/)).toHaveValue('Needs a cleanup step');
    expect(within(dialog).getByRole('link', { name: /Open AT-727 in Jira/ })).toHaveAttribute('href', 'https://securicyapp.atlassian.net/browse/AT-727');
    expect(screen.getByTestId('approval')).toHaveAttribute('data-state', 'none'); // nothing changed

    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline and save to Jira' }));
    await waitFor(() => expect(screen.queryByTestId('decision-modal')).not.toBeInTheDocument());
    expect(screen.getByTestId('approval')).toHaveAttribute('data-state', 'declined');
  });

  it('can copy the review text for pasting into Jira by hand', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    decisionMock.mockRejectedValueOnce(new ReviewApiError('Jira did not save the review'));
    await openReview();
    open('Decline');
    const dialog = await screen.findByTestId('decision-modal');
    fireEvent.change(within(dialog).getByLabelText(/Review information/), { target: { value: 'Please fix X' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline and save to Jira' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: /Copy review text/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Please fix X'));
    expect(toast.success).toHaveBeenCalledWith('Review text copied.');
  });

  it('says so when copying is not possible', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    decisionMock.mockRejectedValueOnce(new ReviewApiError('nope'));
    await openReview();
    open('Decline');
    const dialog = await screen.findByTestId('decision-modal');
    fireEvent.change(within(dialog).getByLabelText(/Review information/), { target: { value: 'x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Decline and save to Jira' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: /Copy review text/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('copy it manually')));
  });

  it('does not offer a Jira link when the ticket URL is unsafe', async () => {
    detailMock.mockResolvedValue(detail({ ticket: { ...detail().ticket, url: 'javascript:alert(1)' } }));
    decisionMock.mockRejectedValueOnce(new ReviewApiError('nope'));
    await openReview();
    open('Approve');
    const dialog = await screen.findByTestId('decision-modal');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and save to Jira' }));
    await within(dialog).findByTestId('decision-error');
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument();
  });

  it('uses a generic message when the failure has none', async () => {
    decisionMock.mockRejectedValueOnce('weird');
    await openReview();
    open('Approve');
    const dialog = await screen.findByTestId('decision-modal');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and save to Jira' }));
    expect(await within(dialog).findByTestId('decision-error')).toHaveTextContent('Could not save the review to Jira.');
  });

  it('Cancel closes it without saving anything, and reopening starts clean', async () => {
    await openReview();
    open('Approve');
    let dialog = await screen.findByTestId('decision-modal');
    fireEvent.change(within(dialog).getByLabelText(/Review information/), { target: { value: 'half written' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('decision-modal')).not.toBeInTheDocument());
    expect(decisionMock).not.toHaveBeenCalled();

    open('Approve');
    dialog = await screen.findByTestId('decision-modal');
    expect(within(dialog).getByLabelText(/Review information/)).toHaveValue('');
  });

  it('is not shown for a PR that is already merged', async () => {
    detailMock.mockResolvedValue(detail({ unmerged: 0 }));
    await openReview();
    expect(screen.queryByTestId('approval')).not.toBeInTheDocument();
  });

  it('merging waits while specs are running', async () => {
    detailMock.mockResolvedValue(detail({ ticket: { ...detail().ticket, approval: 'approved' }, specs: ['spec/playwright/playwright/e2e/a/b.spec.ts'] }));
    await openReview();
    expect(mergeButton()).toBeEnabled();
  });
});

describe('Pull request show page: merge box states', () => {
  it('says it is ready when there are no conflicts', async () => {
    await openReview();
    expect(mergeBox()).toHaveTextContent('No conflicts with playwright-main. Ready to rebase and merge.');
    expect(screen.getByText('Ready to merge')).toBeInTheDocument();
  });

  it('explains that a branch that is behind is rebased automatically', async () => {
    detailMock.mockResolvedValue(detail({ behind: 3, unmerged: 2 }));
    await openReview();
    expect(screen.getByText(/3 newer commits — your 2 commits will be rebased on top automatically, no manual rebase needed/)).toBeInTheDocument();
  });

  it('uses the singular for one newer commit', async () => {
    detailMock.mockResolvedValue(detail({ behind: 1 }));
    await openReview();
    expect(screen.getByText(/1 newer commit — your 1 commit will be/)).toBeInTheDocument();
  });

  it('blocks merging and names the conflicting files, with the command to fix it locally', async () => {
    detailMock.mockResolvedValue(detail({ canRebase: false, conflicts: ['spec/a.spec.ts', 'support/b.ts'] }));
    await openReview();

    expect(mergeBox()).toHaveTextContent('conflicts with playwright-main that must be resolved');
    expect(within(screen.getByTestId('conflict-files')).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['spec/a.spec.ts', 'support/b.ts']);
    expect(screen.getByTestId('conflict-help')).toHaveTextContent('git fetch origin && git checkout AT-727-add-test && git rebase origin/playwright-main');
    expect(screen.getByText('Conflicts')).toBeInTheDocument();
    expect(mergeButton()).toBeDisabled();
    // a PR with conflicts can still be declined ("rebase needed"); it just can't be merged
    expect(screen.getByTestId('approval')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Move AT-727 to Done/)).not.toBeInTheDocument();
  });

  it('blocks merging when playwright-main already has the changes', async () => {
    detailMock.mockResolvedValue(detail({ unmerged: 0 }));
    await openReview();
    expect(mergeBox()).toHaveTextContent('already has these changes');
    expect(mergeButton()).toBeDisabled();
  });

  it('still allows merging when conflicts could not be pre-checked', async () => {
    detailMock.mockResolvedValue(detail({ canRebase: null }));
    await openReview();
    expect(screen.getByText(/Couldn't pre-check conflicts/)).toBeInTheDocument();
    expect(screen.getByText('Unchecked')).toBeInTheDocument();
    await approve();
    expect(mergeButton()).toBeEnabled();
  });

  it('says that merging deletes the branch, and offers to move the ticket to Done (ticked by default)', async () => {
    await openReview();
    expect(mergeBox()).toHaveTextContent('Merging also deletes the branch AT-727-add-test from origin.');
    expect(screen.getByRole('checkbox', { name: 'Move AT-727 to Done in Jira after merging' })).toBeChecked();
  });
});

describe('Pull request show page: rebase and merge', () => {
  it('is a two-step button like GitHub: the first click only asks, it never merges', async () => {
    await openReview();
    await approve();
    fireEvent.click(mergeButton());

    const confirm = await screen.findByTestId('merge-confirm');
    // the first button is replaced by Confirm + Cancel, inline (no pop-up)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(confirm).getByRole('button', { name: 'Confirm rebase and merge' })).toBeEnabled();
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(within(mergeBox()).queryByRole('button', { name: 'Rebase and merge' })).not.toBeInTheDocument();
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it('spells out rebase, push, branch deletion and the Jira move before the second click', async () => {
    await openReview();
    await approve();
    fireEvent.click(mergeButton());

    const text = (await screen.findByTestId('merge-confirm-text')).textContent;
    expect(text).toContain('rebases 1 commit from AT-727-add-test onto the latest playwright-main');
    expect(text).toContain('pushes the result to origin/playwright-main');
    expect(text).toContain('deletes the branch AT-727-add-test from origin');
    expect(text).toContain('AT-727 will then be moved to Done in Jira');
    expect(text).toContain('cannot be undone from here');
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it('puts the focus on Confirm so Enter or Space completes the second click deliberately', async () => {
    await openReview();
    await approve();
    fireEvent.click(mergeButton());
    const confirm = within(await screen.findByTestId('merge-confirm')).getByRole('button', { name: 'Confirm rebase and merge' });
    await waitFor(() => expect(confirm).toHaveFocus());
  });

  it('Cancel puts the original button back and sends nothing', async () => {
    await openReview();
    await approve();
    fireEvent.click(mergeButton());
    fireEvent.click(within(await screen.findByTestId('merge-confirm')).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByTestId('merge-confirm')).not.toBeInTheDocument();
    expect(mergeButton()).toHaveTextContent('Rebase and merge');
    expect(mergeButton()).toBeEnabled();
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it('Escape cancels the confirmation too', async () => {
    await openReview();
    await approve();
    fireEvent.click(mergeButton());
    fireEvent.keyDown(await screen.findByTestId('merge-confirm'), { key: 'Escape' });
    expect(screen.queryByTestId('merge-confirm')).not.toBeInTheDocument();
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it('can be cancelled and asked again as many times as you like', async () => {
    await openReview();
    await approve();
    for (let i = 0; i < 3; i++) {
      fireEvent.click(mergeButton());
      fireEvent.click(within(await screen.findByTestId('merge-confirm')).getByRole('button', { name: 'Cancel' }));
    }
    expect(mergeMock).not.toHaveBeenCalled();
    fireEvent.click(mergeButton());
    await confirmMerge();
    await waitFor(() => expect(mergeMock).toHaveBeenCalledTimes(1));
  });

  it('the pending confirmation goes away if merging stops being allowed (approval undone)', async () => {
    await openReview();
    await approve();
    fireEvent.click(mergeButton());
    await screen.findByTestId('merge-confirm');

    fireEvent.click(screen.getByRole('button', { name: /Undo approval/ }));

    await waitFor(() => expect(screen.queryByTestId('merge-confirm')).not.toBeInTheDocument());
    expect(mergeButton()).toBeDisabled();
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it('after the second click the buttons are replaced by the busy state', async () => {
    mergeMock.mockReturnValue(new Promise(() => {}));
    await openReview();
    await approve();
    fireEvent.click(mergeButton());
    await confirmMerge();

    await waitFor(() => expect(screen.queryByTestId('merge-confirm')).not.toBeInTheDocument());
    expect(mergeButton()).toHaveTextContent('Rebasing and merging…');
    expect(mergeButton()).toBeDisabled();
  });

  it('merges exactly the reviewed commit, reports every step, and returns to a refreshed table', async () => {
    mergeMock.mockResolvedValue(mergeResult({ merged: 2, ticketMoved: 'AT-727', branchDeleted: true }));
    detailMock.mockResolvedValue(detail({ unmerged: 2 }));
    await openReview();
    await approveAndMerge();

    await waitFor(() => expect(mergeMock).toHaveBeenCalledTimes(1));
    expect(mergeMock).toHaveBeenCalledWith({ branch: 'AT-727-add-test', expectedSha: SHA, moveToDone: true, approved: true });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('AT-727: 2 commits rebased and merged into playwright-main.'));
    expect(toast.success).toHaveBeenCalledWith('Branch AT-727-add-test deleted.');
    expect(toast.success).toHaveBeenCalledWith('AT-727 moved to Done in Jira.');
    expect(toast.warning).not.toHaveBeenCalled();
    expect(await screen.findByTestId('review-table')).toBeInTheDocument();
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });

  it('leaves Jira alone when the checkbox is unticked', async () => {
    await openReview();
    fireEvent.click(screen.getByRole('checkbox', { name: /Move AT-727 to Done/ }));
    await approve();
    fireEvent.click(mergeButton());

    expect((await screen.findByTestId('merge-confirm-text')).textContent).not.toContain('Jira');
    await confirmMerge();

    await waitFor(() => expect(mergeMock).toHaveBeenCalledWith(expect.objectContaining({ moveToDone: false })));
  });

  it('does not claim the branch was deleted when it was not, and shows the warning', async () => {
    mergeMock.mockResolvedValue(mergeResult({ branchDeleted: false, warning: "Merged, but couldn't delete the branch AT-727-add-test: stale info" }));
    await openReview();
    await approveAndMerge();

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("couldn't delete the branch"), { duration: 12000 }));
    expect(toast.success).not.toHaveBeenCalledWith('Branch AT-727-add-test deleted.');
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('rebased and merged into playwright-main'));
  });

  it('shows progress, locks the page and blocks double submits while merging', async () => {
    let resolve!: (v: MergeResult) => void;
    mergeMock.mockReturnValue(new Promise((r) => (resolve = r)));
    await openReview();
    await approveAndMerge();

    await waitFor(() => expect(mergeButton()).toHaveTextContent('Rebasing and merging…'));
    expect(mergeButton()).toBeDisabled();
    expect(mergeButton()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: /Back to Review/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Move AT-727 to Done/ })).toBeDisabled();
    expect(screen.getByText(/Please don't close this tab/)).toBeInTheDocument();

    fireEvent.click(mergeButton()); // a click while merging does nothing
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    resolve(mergeResult());
    await screen.findByTestId('review-table');
    expect(mergeMock).toHaveBeenCalledTimes(1);
  });

  it('asks the browser to confirm if the tab is closed mid-merge', async () => {
    mergeMock.mockReturnValue(new Promise(() => {}));
    await openReview();
    await approveAndMerge();
    await waitFor(() => expect(mergeButton()).toBeDisabled());

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('only ever sends one merge even if the confirm button is clicked twice in a row', async () => {
    let resolve!: (v: MergeResult) => void;
    mergeMock.mockReturnValue(new Promise((r) => (resolve = r)));
    await openReview();
    await approve();
    fireEvent.click(mergeButton());
    const confirm = within(await screen.findByTestId('merge-confirm')).getByRole('button', { name: 'Confirm rebase and merge' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(mergeMock).toHaveBeenCalledTimes(1);
    resolve(mergeResult());
    await screen.findByTestId('review-table');
  });

  describe('accidental double activation of the merge button', () => {
    async function openConfirmation() {
      await openReview();
      await approve();
      fireEvent.click(mergeButton());
      return within(await screen.findByTestId('merge-confirm')).getByRole('button', { name: 'Confirm rebase and merge' });
    }

    it('ignores the second click of a double-click on Confirm, and a deliberate click afterwards still works (once)', async () => {
      mergeMock.mockResolvedValue(mergeResult());
      const confirm = await openConfirmation();

      fireEvent.click(confirm, { detail: 2 }); // the second half of a double-click
      expect(mergeMock).not.toHaveBeenCalled();
      expect(screen.getByTestId('merge-confirm')).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(confirm, { detail: 1 });
      });
      await screen.findByTestId('review-table');
      expect(mergeMock).toHaveBeenCalledTimes(1);
    });

    it('cancels the key repeat from holding Enter on "Rebase and merge": it would otherwise land on the focused Confirm button', async () => {
      const confirm = await openConfirmation();
      expect(confirm).toHaveFocus(); // this is what makes the held key reach it

      expect(fireEvent.keyDown(confirm, { key: 'Enter', repeat: true })).toBe(false); // the default action (a click) is cancelled
      expect(fireEvent.keyDown(confirm, { key: 'Enter', repeat: true })).toBe(false);
      expect(fireEvent.keyDown(confirm, { key: 'Enter', repeat: false })).toBe(true); // a fresh press is left alone
      expect(fireEvent.keyDown(confirm, { key: ' ', repeat: false })).toBe(true);
      expect(mergeMock).not.toHaveBeenCalled();
      expect(screen.getByTestId('merge-confirm')).toBeInTheDocument();
    });

    it('sends one merge however many click events arrive (a stuck or held key, a double tap, a bouncing mouse)', async () => {
      mergeMock.mockReturnValue(new Promise(() => {}));
      const confirm = await openConfirmation();

      for (let i = 0; i < 10; i++) fireEvent.click(confirm);

      expect(mergeMock).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(mergeButton()).toHaveTextContent('Rebasing and merging…'));
      for (let i = 0; i < 5; i++) fireEvent.click(mergeButton());
      expect(mergeMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('merge-confirm')).not.toBeInTheDocument();
    });

    it('after a refused merge the reviewer can try again, and that is exactly one more request', async () => {
      mergeMock.mockRejectedValueOnce(new ReviewApiError('Rebasing "AT-727-add-test" onto playwright-main hit conflicts.')).mockReturnValue(new Promise(() => {}));
      await openReview();
      await approveAndMerge();
      await screen.findByTestId('merge-error');
      expect(mergeMock).toHaveBeenCalledTimes(1);

      fireEvent.click(mergeButton());
      const confirm = within(await screen.findByTestId('merge-confirm')).getByRole('button', { name: 'Confirm rebase and merge' });
      fireEvent.click(confirm);
      fireEvent.click(confirm);

      expect(mergeMock).toHaveBeenCalledTimes(2);
    });

    it('shows the server\'s "already being merged" refusal (a second tab, or a reload mid-merge) and lets the reviewer wait and check', async () => {
      mergeMock.mockRejectedValueOnce(new ReviewApiError('"AT-727-add-test" is already being merged. Wait for that to finish; there is no need to click again.'));
      await openReview();
      await approveAndMerge();

      expect(await screen.findByTestId('merge-error')).toHaveTextContent('already being merged');
      expect(mergeButton()).toBeEnabled();
      expect(mergeMock).toHaveBeenCalledTimes(1);
    });

    it('the first "Rebase and merge" click only asks: a second activation of it can never merge by itself', async () => {
      await openReview();
      await approve();
      const first = mergeButton();
      fireEvent.click(first);
      fireEvent.click(first, { detail: 2 }); // a stale reference to the button that was just replaced

      await screen.findByTestId('merge-confirm');
      expect(mergeMock).not.toHaveBeenCalled();
    });
  });

  it('keeps the reviewer on the page with the reason (and files) when the merge is refused, and lets them retry', async () => {
    mergeMock.mockRejectedValueOnce(new ReviewApiError('Rebasing "AT-727-add-test" onto playwright-main hit conflicts.', ['spec/a.spec.ts']));
    await openReview();
    await approveAndMerge();

    const alert = await screen.findByTestId('merge-error');
    expect(alert).toHaveTextContent('hit conflicts');
    expect(alert).toHaveTextContent('spec/a.spec.ts');
    expect(toast.success).not.toHaveBeenCalledWith(expect.stringContaining('rebased and merged'));
    expect(mergeButton()).toBeEnabled();
    expect(mergeBox()).toBeInTheDocument();

    fireEvent.click(mergeButton());
    await confirmMerge();
    await screen.findByTestId('review-table');
    expect(mergeMock).toHaveBeenCalledTimes(2);
  });

  it('offers to reload the latest changes when the branch changed after review', async () => {
    mergeMock.mockRejectedValue(new ReviewApiError('"AT-727-add-test" changed since you opened it. Refresh and review the new commits before merging.'));
    await openReview();
    await approveAndMerge();

    const alert = await screen.findByTestId('merge-error');
    expect(within(alert).queryByRole('list')).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole('button', { name: 'Reload latest changes' }));

    await waitFor(() => expect(detailMock).toHaveBeenCalledTimes(2));
    await screen.findByTestId('merge-box');
    expect(screen.queryByTestId('merge-error')).not.toBeInTheDocument();
  });

  it('shows a refusal from a guard rail', async () => {
    mergeMock.mockRejectedValue(new ReviewApiError('Blocked by the git guard rail: push is only allowed as a plain fast-forward of playwright-main.'));
    await openReview();
    await approveAndMerge();
    expect(await screen.findByTestId('merge-error')).toHaveTextContent('Blocked by the git guard rail');
  });

  it('handles an unexpected non-API failure', async () => {
    mergeMock.mockRejectedValue(new Error('network down'));
    await openReview();
    await approveAndMerge();
    expect(await screen.findByTestId('merge-error')).toHaveTextContent('network down');
  });

  it('uses a generic message when the failure has no message', async () => {
    mergeMock.mockRejectedValue('weird');
    await openReview();
    await approveAndMerge();
    expect(await screen.findByTestId('merge-error')).toHaveTextContent('Merge failed.');
  });
});
