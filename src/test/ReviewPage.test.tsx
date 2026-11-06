import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { ReviewPage } from '../components/Review/ReviewPage';
import { ReviewApiError, fetchGhStatus, fetchReviewDetail, fetchReviewList, fetchReviewStatus, mergeReview } from '../utils/reviewApi';
import { stubCanvas } from './canvasStub';
import { SHA, branch, detail, file, gh, list, mergeResult, status, ticket } from './reviewFixtures';
import type { MergeResult } from '../types/review';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

// Keep the real ReviewApiError class; replace only the network calls.
vi.mock('../utils/reviewApi', async (importActual) => {
  const actual = await importActual<typeof import('../utils/reviewApi')>();
  return { ...actual, fetchReviewStatus: vi.fn(), fetchGhStatus: vi.fn(), fetchReviewList: vi.fn(), fetchReviewDetail: vi.fn(), mergeReview: vi.fn() };
});

const statusMock = vi.mocked(fetchReviewStatus);
const ghMock = vi.mocked(fetchGhStatus);
const listMock = vi.mocked(fetchReviewList);
const detailMock = vi.mocked(fetchReviewDetail);
const mergeMock = vi.mocked(mergeReview);

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
});

async function openReview(key = 'AT-727') {
  render(<ReviewPage />);
  fireEvent.click(await screen.findByRole('button', { name: `Review ${key}` }));
  await screen.findByTestId('merge-box');
}

const mergeBox = () => screen.getByTestId('merge-box');
const mergeButton = () => within(mergeBox()).getByRole('button', { name: /Rebase and merge|Rebasing and merging/ });
const approve = () => fireEvent.click(within(screen.getByTestId('approval')).getByRole('button', { name: 'Approve changes' }));
const confirmMerge = async () => fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Rebase and merge' }));
const openTab = (name: RegExp | string) => fireEvent.click(screen.getByRole('tab', { name }));

async function approveAndMerge() {
  approve();
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

describe('Review page: valid markup', () => {
  it('renders the table, the show page and every tab without React DOM-nesting warnings', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    listMock.mockResolvedValue(list({ tickets: [ticket(), ticket({ key: 'AT-726', summary: 'No branch yet', branches: [] }), ticket({ key: 'AT-725', branches: [branch({ name: 'AT-725-x', unmerged: 0 })] })] }));
    detailMock.mockResolvedValue(detail({ files: [file({ path: 'a.ts' }), file({ path: 'b.ts' })], canRebase: false, conflicts: ['a.ts'] }));
    render(<ReviewPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Review AT-727' }))[0]);
    await screen.findByTestId('merge-box');
    openTab(/Commits/);
    openTab(/Files changed/);
    openTab('Conversation');

    const nesting = spy.mock.calls.map((c) => c.map(String).join(' ')).filter((m) => /cannot be a descendant|cannot contain a nested|validateDOMNesting|hydration/i.test(m));
    expect(nesting).toEqual([]);
    spy.mockRestore();
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
    expect(screen.getByText('Loading changes…')).toBeInTheDocument();
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
    expect(sidebar).toHaveTextContent('playwright-main');
    expect(within(sidebar).getByRole('link', { name: /AT-727/ })).toHaveAttribute('href', 'https://securicyapp.atlassian.net/browse/AT-727');
  });

  it('links to the branch on GitHub when known', async () => {
    await openReview();
    expect(screen.getByRole('link', { name: /View on GitHub/ })).toHaveAttribute('href', 'https://github.com/carbidesecure/securicy-app/tree/AT-727-add-test');
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

  it('lets you approve and jump to the merge box from the sticky footer', async () => {
    await openReview();
    openTab(/Files changed/);

    const footer = screen.getByTestId('review-footer');
    fireEvent.click(within(footer).getByRole('button', { name: 'Approve changes' }));
    expect(footer).toHaveTextContent('you approved these changes');
    expect(within(footer).queryByRole('button', { name: 'Approve changes' })).not.toBeInTheDocument();

    fireEvent.click(within(footer).getByRole('button', { name: 'Go to merge box' }));
    expect(screen.getByRole('tab', { name: 'Conversation' })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByTestId('approval')).getByText('You approved these changes.')).toBeInTheDocument();
  });

  it('does not offer to approve a branch that has conflicts', async () => {
    detailMock.mockResolvedValue(detail({ canRebase: false, conflicts: ['a.txt'] }));
    await openReview();
    openTab(/Files changed/);
    expect(within(screen.getByTestId('review-footer')).queryByRole('button', { name: 'Approve changes' })).not.toBeInTheDocument();
  });
});

describe('Pull request show page: approving', () => {
  it('keeps Rebase and merge disabled until the changes are approved', async () => {
    await openReview();
    expect(mergeButton()).toBeDisabled();
    expect(screen.getByText('Approve the changes above to enable this button.')).toBeInTheDocument();

    approve();

    expect(mergeButton()).toBeEnabled();
    expect(screen.getByText('You approved these changes.')).toBeInTheDocument();
    expect(screen.queryByText('Approve the changes above to enable this button.')).not.toBeInTheDocument();
  });

  it('can undo an approval', async () => {
    await openReview();
    approve();
    fireEvent.click(screen.getByRole('button', { name: /Undo approval/ }));
    expect(mergeButton()).toBeDisabled();
  });

  it('remembers the approval for this exact commit within the session', async () => {
    await openReview();
    approve();
    expect(sessionStorage.getItem(`review-approved:AT-727-add-test@${SHA}`)).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: /Back to Review/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review AT-727' }));
    await screen.findByTestId('merge-box');

    expect(mergeButton()).toBeEnabled();
  });

  it('does NOT carry an approval over to new commits', async () => {
    sessionStorage.setItem(`review-approved:AT-727-add-test@${'9'.repeat(40)}`, '1');
    await openReview();
    expect(mergeButton()).toBeDisabled();
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
    expect(screen.queryByTestId('approval')).not.toBeInTheDocument();
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
    approve();
    expect(mergeButton()).toBeEnabled();
  });

  it('says that merging deletes the branch, and offers to move the ticket to Done (ticked by default)', async () => {
    await openReview();
    expect(mergeBox()).toHaveTextContent('Merging also deletes the branch AT-727-add-test from origin.');
    expect(screen.getByRole('checkbox', { name: 'Move AT-727 to Done in Jira after merging' })).toBeChecked();
  });
});

describe('Pull request show page: rebase and merge', () => {
  it('asks for confirmation first, spelling out rebase, push, branch deletion and the Jira move', async () => {
    await openReview();
    approve();
    fireEvent.click(mergeButton());

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Rebase and merge into playwright-main?')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('rebases 1 commit from AT-727-add-test onto the latest playwright-main');
    expect(dialog).toHaveTextContent('pushes the result to origin/playwright-main');
    expect(dialog).toHaveTextContent('deletes the branch AT-727-add-test from origin');
    expect(dialog).toHaveTextContent('AT-727 will then be moved to Done in Jira');
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it('does nothing when the confirmation is cancelled', async () => {
    await openReview();
    approve();
    fireEvent.click(mergeButton());
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mergeMock).not.toHaveBeenCalled();
    expect(mergeBox()).toBeInTheDocument();
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
    approve();
    fireEvent.click(mergeButton());

    const dialog = await screen.findByRole('dialog');
    expect(dialog).not.toHaveTextContent('Jira');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rebase and merge' }));

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
    approve();
    fireEvent.click(mergeButton());
    const confirm = within(await screen.findByRole('dialog')).getByRole('button', { name: 'Rebase and merge' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(mergeMock).toHaveBeenCalledTimes(1);
    resolve(mergeResult());
    await screen.findByTestId('review-table');
  });

  it('keeps the reviewer on the page with the reason (and files) when the merge is refused, and lets them retry', async () => {
    mergeMock.mockRejectedValueOnce(new ReviewApiError('Rebasing "AT-727-add-test" onto playwright-main hit conflicts.', ['spec/a.spec.ts']));
    await openReview();
    await approveAndMerge();

    const alert = await screen.findByTestId('merge-error');
    expect(alert).toHaveTextContent('hit conflicts');
    expect(alert).toHaveTextContent('spec/a.spec.ts');
    expect(toast.success).not.toHaveBeenCalled();
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
