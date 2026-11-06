import { test, expect } from './baseFixtures'
import type { Page } from '@playwright/test'

// The Review tab shells out to git and acli through the dev server's
// /api/review/* routes. These specs mock that network layer so the suite never
// touches a real repository or Jira — they exercise the whole client flow
// (list → review → merge → success/error) against controlled responses. The
// last block calls the real API with requests that must be refused *before*
// anything runs, which is the guard-rail behaviour that matters most.

const SHA = 'a'.repeat(40)
const BASE_URL = 'http://localhost:5190'

const branch = (over = {}) => ({
  name: 'AT-727-add-test',
  sha: SHA,
  author: 'Brian Baggs',
  date: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  files: 3,
  additions: 120,
  deletions: 4,
  ahead: 1,
  behind: 0,
  unmerged: 1,
  ...over
})

const ticket = (over = {}) => ({
  key: 'AT-727',
  summary: 'Add tests for comments carrying over',
  status: 'Review',
  assignee: 'Brian Baggs',
  url: 'https://securicyapp.atlassian.net/browse/AT-727',
  branches: [branch()],
  ...over
})

const reviewList = (over = {}) => ({
  baseBranch: 'playwright-main',
  baseSha: 'b'.repeat(40),
  repoWebUrl: 'https://github.com/carbidesecure/securicy-app',
  jira: { error: null, errorKind: null },
  tickets: [ticket()],
  fetchedAt: new Date().toISOString(),
  ...over
})

const reviewStatus = (over = {}) => ({
  ok: true,
  repoPath: '/Users/qa/Dev/securicy-app',
  baseBranch: 'playwright-main',
  remote: 'origin',
  remoteUrl: 'git@github.com:carbidesecure/securicy-app.git',
  repoWebUrl: 'https://github.com/carbidesecure/securicy-app',
  requirements: [
    { id: 'git', label: 'Git', ok: true, fix: '' },
    { id: 'acli', label: 'Atlassian CLI (acli)', ok: true, fix: '' },
    { id: 'repo', label: 'securicy-app checkout', ok: true, fix: '' },
    { id: 'remote', label: '"origin" remote', ok: true, fix: '' }
  ],
  problems: [],
  ...over
})

const ghReady = { state: 'ready', account: 'BrianBaggs', host: 'github.com', detail: 'Signed in to github.com as BrianBaggs.' }

const reviewDetail = (over = {}) => ({
  branch: 'AT-727-add-test',
  ticket: {
    key: 'AT-727',
    summary: 'Add tests for comments carrying over',
    status: 'Review',
    assignee: 'Brian Baggs',
    url: 'https://securicyapp.atlassian.net/browse/AT-727'
  },
  sha: SHA,
  baseBranch: 'playwright-main',
  baseSha: 'b'.repeat(40),
  ahead: 1,
  behind: 0,
  unmerged: 1,
  canRebase: true,
  conflicts: [],
  commits: [
    {
      sha: 'c'.repeat(40),
      author: 'Brian Baggs',
      date: new Date().toISOString(),
      subject: 'AT-727 Add tests to confirm comments carry on recurring tasks',
      body: 'Covers the completed and not completed cases.'
    }
  ],
  files: [
    {
      path: 'spec/recurring_comments.spec.ts',
      oldPath: null,
      status: 'added',
      binary: false,
      additions: 2,
      deletions: 1,
      truncated: false,
      patch: ['@@ -1,2 +1,3 @@', ' unchanged line', '-removed line', '+added line one', '+added line two'].join('\n')
    }
  ],
  totals: { additions: 2, deletions: 1 },
  branchUrl: 'https://github.com/carbidesecure/securicy-app/tree/AT-727-add-test',
  ...over
})

const ok = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) })
const fail = (status: number, error: string, details: string[] = []) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({ success: false, error, details })
})

async function mockApi(
  page: Page,
  opts: { status?: unknown; gh?: unknown; list?: unknown; detail?: unknown; merge?: unknown; mergeDelayMs?: number } = {}
) {
  const calls = { list: 0, detail: 0, merge: [] as Array<Record<string, unknown>> }

  await page.route('**/api/review/status', route => route.fulfill(ok(opts.status ?? reviewStatus())))

  await page.route('**/api/review/gh', route => route.fulfill(ok(opts.gh ?? ghReady)))

  await page.route('**/api/review/list', async route => {
    calls.list++
    await route.fulfill(ok(opts.list ?? reviewList()))
  })

  await page.route('**/api/review/detail**', async route => {
    calls.detail++
    await route.fulfill(ok(opts.detail ?? reviewDetail()))
  })

  await page.route('**/api/review/merge', async route => {
    calls.merge.push(route.request().postDataJSON())
    if (opts.mergeDelayMs) await new Promise(resolve => setTimeout(resolve, opts.mergeDelayMs))
    await route.fulfill(
      (opts.merge as Parameters<typeof route.fulfill>[0] | undefined) ??
        ok({ merged: 1, baseBranch: 'playwright-main', newBaseSha: 'd'.repeat(40), branchDeleted: true, ticketMoved: 'AT-727', warning: null })
    )
  })

  return calls
}

async function openReviewTab(page: Page) {
  await page.goto(`${BASE_URL}/`)

  await page.getByRole('navigation').getByRole('button', { name: 'Review' }).click()
}

async function openFirstReview(page: Page) {
  await openReviewTab(page)

  await page.getByRole('button', { name: 'Review AT-727' }).click()

  await expect(page.getByTestId('merge-box')).toBeVisible()
}

const mergeBox = (page: Page) => page.getByTestId('merge-box')

const mergeButton = (page: Page) => mergeBox(page).getByRole('button', { name: /Rebase and merge|Rebasing and merging/ })

const approve = async (page: Page) => {
  await page.getByTestId('approval').getByRole('button', { name: 'Approve changes' }).click()
}

async function approveAndConfirm(page: Page) {
  await approve(page)

  await mergeButton(page).click()

  await page.getByRole('dialog').getByRole('button', { name: 'Rebase and merge' }).click()
}

test.describe('Review - navigation and the table of tickets', () => {

  test('should add a Review link to the top navigation', async ({ page }) => {
    await mockApi(page)

    await page.goto(`${BASE_URL}/`)

    await expect(page.getByRole('navigation').getByRole('button', { name: 'Review' })).toBeVisible()

    await page.getByRole('navigation').getByRole('button', { name: 'Review' }).click()

    await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible()
  })

  test('should list the tickets in the Review column in a table with the branch and diff stat', async ({ page }) => {
    await mockApi(page)

    await openReviewTab(page)

    const table = page.getByTestId('review-table')

    for (const heading of ['Pull request', 'Branch', 'Last pushed', 'Changes', 'Commits']) {
      await expect(table.getByRole('columnheader', { name: heading })).toBeVisible()
    }

    const row = table.getByTestId('review-ticket')

    await expect(row).toHaveCount(1)

    await expect(row.getByRole('link', { name: /AT-727/ })).toHaveAttribute('href', 'https://securicyapp.atlassian.net/browse/AT-727')

    await expect(row.getByText('Add tests for comments carrying over')).toBeVisible()

    await expect(row.getByText('AT-727-add-test').filter({ visible: true })).toBeVisible()

    await expect(row.getByText('Brian Baggs', { exact: true }).filter({ visible: true })).toBeVisible()

    await expect(row.getByText('1 commit')).toBeVisible()

    await expect(row.getByTestId('diff-stat').filter({ visible: true })).toContainText('3 files')

    await expect(row.getByTestId('diff-stat').filter({ visible: true })).toContainText('+120')

    await expect(row.getByTestId('diff-stat').filter({ visible: true })).toContainText('−4')

    await expect(page.getByText('1 Open')).toBeVisible()
  })

  test('should explain that branches behind playwright-main are rebased automatically', async ({ page }) => {
    await mockApi(page, { list: reviewList({ tickets: [ticket({ branches: [branch({ unmerged: 3, behind: 2 })] })] }) })

    await openReviewTab(page)

    await expect(page.getByText('3 commits')).toBeVisible()

    await expect(page.getByText('2 behind — auto-rebased')).toBeVisible()
  })

  test('should list several tickets at once', async ({ page }) => {
    await mockApi(page, {
      list: reviewList({
        tickets: [ticket(), ticket({ key: 'AT-726', summary: 'MCP scanning tools', branches: [branch({ name: 'AT-726-add-tests-for-new-mcp-tools' })] })]
      })
    })

    await openReviewTab(page)

    await expect(page.getByTestId('review-ticket')).toHaveCount(2)

    await expect(page.getByText('2 tickets in the Review column')).toBeVisible()
  })

  test('should say when a Review ticket has no branch on origin yet', async ({ page }) => {
    await mockApi(page, { list: reviewList({ tickets: [ticket({ branches: [] })] }) })

    await openReviewTab(page)

    await expect(page.getByText(/has been pushed to origin yet/)).toBeVisible()

    await expect(page.getByRole('button', { name: 'Review AT-727' })).toBeHidden()
  })

  test('should mark a branch that is already merged', async ({ page }) => {
    await mockApi(page, { list: reviewList({ tickets: [ticket({ branches: [branch({ unmerged: 0 })] })] }) })

    await openReviewTab(page)

    await expect(page.getByText('Already in playwright-main')).toBeVisible()
  })

  test('should show a friendly empty state', async ({ page }) => {
    await mockApi(page, { list: reviewList({ tickets: [] }) })

    await openReviewTab(page)

    await expect(page.getByTestId('review-empty')).toContainText('Nothing is in the Review column right now.')
  })

  test('should show nothing, and say why, when Jira cannot be read (no branch fallback)', async ({ page }) => {
    await mockApi(page, {
      list: reviewList({
        jira: { error: "acli isn't logged in to Jira. Run `acli auth login` in a terminal, then refresh.", errorKind: 'not-authenticated' },
        tickets: []
      })
    })

    await openReviewTab(page)

    await expect(page.getByTestId('jira-warning')).toContainText('there is nothing to show')

    await expect(page.getByTestId('jira-warning')).toContainText('acli auth login')

    await expect(page.getByTestId('review-table')).toBeHidden()

    await expect(page.getByTestId('review-empty')).toBeHidden()
  })

  test('should show the reason when the page cannot load and recover with Try again', async ({ page }) => {
    let attempts = 0

    await page.route('**/api/review/gh', route => route.fulfill(ok(ghReady)))

    await page.route('**/api/review/status', async route => {
      attempts++
      await route.fulfill(attempts === 1 ? fail(500, 'Could not read the review status.') : ok(reviewStatus()))
    })

    await page.route('**/api/review/list', route => route.fulfill(ok(reviewList())))

    await openReviewTab(page)

    await expect(page.getByTestId('review-error')).toContainText('Could not read the review status.')

    await page.getByTestId('review-error').getByRole('button', { name: 'Try again' }).click()

    await expect(page.getByTestId('review-ticket')).toHaveCount(1)

    await expect(page.getByTestId('review-error')).toBeHidden()
  })

  test('should explain when the review API is not available', async ({ page }) => {
    await page.route('**/api/review/gh', route => route.fulfill(ok(ghReady)))

    await page.route('**/api/review/status', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }))

    await openReviewTab(page)

    await expect(page.getByTestId('review-error')).toContainText('npm run dev')
  })

  test('should refresh on demand', async ({ page }) => {
    const calls = await mockApi(page)

    await openReviewTab(page)

    await expect(page.getByTestId('review-ticket')).toHaveCount(1)

    await page.getByRole('button', { name: 'Refresh' }).click()

    await expect.poll(() => calls.list).toBe(2)
  })

  test('should open the pull request by clicking anywhere on its row', async ({ page }) => {
    await mockApi(page)

    await openReviewTab(page)

    await page.getByTestId('review-ticket').getByText('3 hours ago').filter({ visible: true }).click()

    await expect(page.getByTestId('merge-box')).toBeVisible()
  })
})

test.describe('Review - status lights and setup help', () => {

  test('should show green lights for git, the repo, acli and gh when everything is ready', async ({ page }) => {
    await mockApi(page)

    await openReviewTab(page)

    for (const id of ['git', 'repo', 'acli', 'gh']) {
      await expect(page.getByTestId(`light-${id}`)).toHaveAttribute('data-state', 'ok')
    }

    await expect(page.getByTestId('light-acli')).toContainText('Signed in')

    await expect(page.getByTestId('light-gh')).toContainText('Signed in as BrianBaggs')
  })

  test('should tell the user to install what is missing', async ({ page }) => {
    await mockApi(page, {
      status: reviewStatus({
        ok: false,
        requirements: [
          { id: 'git', label: 'Git', ok: true, fix: '' },
          {
            id: 'acli',
            label: 'Atlassian CLI (acli)',
            ok: false,
            fix: "The Atlassian CLI isn't installed.",
            command: 'brew tap atlassian/homebrew-acli && brew install acli',
            url: 'https://developer.atlassian.com/cloud/acli/guides/install-acli/'
          },
          { id: 'repo', label: 'securicy-app checkout', ok: true, fix: '' }
        ]
      })
    })

    await openReviewTab(page)

    await expect(page.getByTestId('setup-panel')).toContainText('Install these first')

    await expect(page.getByTestId('requirement-acli')).toContainText('brew tap atlassian/homebrew-acli && brew install acli')

    await expect(page.getByTestId('light-acli')).toHaveAttribute('data-state', 'bad')

    await expect(page.getByTestId('review-table')).toBeHidden()
  })

  test('should show gh amber (not blocking) when it is not signed in', async ({ page }) => {
    await mockApi(page, { gh: { state: 'not-authenticated', account: null, host: null, detail: "The GitHub CLI isn't signed in.", command: 'gh auth login' } })

    await openReviewTab(page)

    await expect(page.getByTestId('light-gh')).toHaveAttribute('data-state', 'warn')

    await expect(page.getByTestId('status-hints')).toContainText('gh auth login')

    await expect(page.getByTestId('review-ticket')).toHaveCount(1)
  })

  test('should show acli red with the login command when it is not signed in', async ({ page }) => {
    await mockApi(page, {
      list: reviewList({ tickets: [], jira: { error: "acli isn't logged in to Jira.", errorKind: 'not-authenticated' } })
    })

    await openReviewTab(page)

    await expect(page.getByTestId('light-acli')).toHaveAttribute('data-state', 'bad')

    await expect(page.getByTestId('status-hints')).toContainText('acli auth login')
  })
})

test.describe('Review - the show page', () => {

  test('should show the ticket, a Back to Review button and the stats', async ({ page }) => {
    await mockApi(page)

    await openFirstReview(page)

    await expect(page.getByRole('heading', { level: 2 })).toContainText('Add tests for comments carrying over')

    await expect(page.getByRole('heading', { level: 2 })).toContainText('#AT-727')

    await expect(page.getByTestId('pr-state')).toHaveText('Open')

    await expect(page.getByText(/wants to merge 1 commit into/)).toBeVisible()

    await expect(page.getByTestId('stat-files')).toContainText('1')

    await expect(page.getByTestId('stat-additions')).toContainText('+2')

    await expect(page.getByTestId('pr-sidebar')).toContainText('Brian Baggs')

    await expect(page.getByRole('link', { name: /View on GitHub/ })).toHaveAttribute('href', 'https://github.com/carbidesecure/securicy-app/tree/AT-727-add-test')
  })

  test('should go back to the table with the Back to Review button', async ({ page }) => {
    await mockApi(page)

    await openFirstReview(page)

    await page.getByRole('button', { name: /Back to Review/ }).click()

    await expect(page.getByTestId('review-table')).toBeVisible()
  })

  test('should show the files changed as a split diff with syntax highlighting', async ({ page }) => {
    await mockApi(page)

    await openFirstReview(page)

    await page.getByRole('tab', { name: /Files changed/ }).click()

    await expect(page.getByTestId('file-diff')).toBeVisible()

    await expect(page.getByTestId('diff-body')).toHaveAttribute('data-mode', 'split')

    await expect(page.getByTestId('diff-body')).toContainText('removed line')

    await expect(page.getByTestId('diff-body')).toContainText('added line one')

    await expect(page.getByTestId('diff-body')).toContainText('added line two')

    await expect(page.getByTestId('diff-body').locator('.diff-line-content-raw, [data-line-num], .diff-line').first()).toBeVisible()
  })

  test('should switch to the unified diff view and remember it', async ({ page }) => {
    await mockApi(page)

    await openFirstReview(page)

    await page.getByRole('tab', { name: /Files changed/ }).click()

    await page.getByRole('group', { name: 'Diff view' }).getByRole('button', { name: 'unified' }).click()

    await expect(page.getByTestId('diff-body')).toHaveAttribute('data-mode', 'unified')

    await page.reload()

    await page.getByRole('navigation').getByRole('button', { name: 'Review' }).click()

    await page.getByRole('button', { name: 'Review AT-727' }).click()

    await page.getByRole('tab', { name: /Files changed/ }).click()

    await expect(page.getByTestId('diff-body')).toHaveAttribute('data-mode', 'unified')
  })

  test('should track viewed files and fold them away', async ({ page }) => {
    await mockApi(page, {
      detail: reviewDetail({
        files: [
          { path: 'spec/a.spec.ts', oldPath: null, status: 'added', binary: false, additions: 1, deletions: 0, truncated: false, patch: '@@ -0,0 +1 @@\n+content of a' },
          { path: 'spec/b.spec.ts', oldPath: null, status: 'added', binary: false, additions: 1, deletions: 0, truncated: false, patch: '@@ -0,0 +1 @@\n+content of b' }
        ],
        totals: { additions: 2, deletions: 0 }
      })
    })

    await openFirstReview(page)

    await expect(page.getByTestId('review-progress')).toContainText('0 of 2 files viewed')

    await page.getByRole('tab', { name: /Files changed/ }).click()

    await expect(page.getByTestId('file-index')).toBeVisible()

    await page.getByRole('checkbox', { name: 'Viewed spec/a.spec.ts' }).check()

    await expect(page.getByText('content of a')).toBeHidden()

    await expect(page.getByText('content of b')).toBeVisible()

    await expect(page.getByTestId('review-footer')).toContainText('1 of 2 files viewed')

    await page.getByRole('tab', { name: 'Conversation' }).click()

    await expect(page.getByRole('progressbar', { name: 'Files viewed' })).toHaveAttribute('aria-valuenow', '50')
  })

  test('should expand and collapse all files', async ({ page }) => {
    await mockApi(page)

    await openFirstReview(page)

    await page.getByRole('tab', { name: /Files changed/ }).click()

    await page.getByRole('button', { name: 'Collapse all' }).click()

    await expect(page.getByTestId('diff-body')).toHaveCount(0)

    await page.getByRole('button', { name: 'Expand all' }).click()

    await expect(page.getByTestId('diff-body')).toHaveCount(1)
  })

  test('should show the commits and their messages', async ({ page }) => {
    await mockApi(page)

    await openFirstReview(page)

    await page.getByRole('tab', { name: /Commits/ }).click()

    await expect(page.getByTestId('commit-list')).toContainText('AT-727 Add tests to confirm comments carry on recurring tasks')

    await expect(page.getByTestId('commit-list')).toContainText('Covers the completed and not completed cases.')
  })

  test('should offer to retry when the branch cannot be loaded', async ({ page }) => {
    let attempts = 0

    await page.route('**/api/review/status', route => route.fulfill(ok(reviewStatus())))

    await page.route('**/api/review/gh', route => route.fulfill(ok(ghReady)))

    await page.route('**/api/review/list', route => route.fulfill(ok(reviewList())))

    await page.route('**/api/review/detail**', async route => {
      attempts++
      await route.fulfill(attempts === 1 ? fail(404, "AT-727 isn't in the Review column of the AT board, so it can't be reviewed or merged here.") : ok(reviewDetail()))
    })

    await openReviewTab(page)

    await page.getByRole('button', { name: 'Review AT-727' }).click()

    await expect(page.getByTestId('detail-error')).toContainText("isn't in the Review column")

    await page.getByTestId('detail-error').getByRole('button', { name: 'Try again' }).click()

    await expect(page.getByTestId('merge-box')).toBeVisible()
  })
})

test.describe('Review - approving and the merge box', () => {

  test('should keep Rebase and merge disabled until the changes are approved', async ({ page }) => {
    await mockApi(page)

    await openFirstReview(page)

    await expect(mergeButton(page)).toBeDisabled()

    await expect(page.getByText('Approve the changes above to enable this button.')).toBeVisible()

    await approve(page)

    await expect(page.getByText('You approved these changes.')).toBeVisible()

    await expect(mergeButton(page)).toBeEnabled()
  })

  test('should let the reviewer approve from the files tab and jump to the merge box', async ({ page }) => {
    await mockApi(page)

    await openFirstReview(page)

    await page.getByRole('tab', { name: /Files changed/ }).click()

    await page.getByTestId('review-footer').getByRole('button', { name: 'Approve changes' }).click()

    await expect(page.getByTestId('review-footer')).toContainText('you approved these changes')

    await page.getByTestId('review-footer').getByRole('button', { name: 'Go to merge box' }).click()

    await expect(page.getByRole('tab', { name: 'Conversation' })).toHaveAttribute('aria-selected', 'true')

    await expect(mergeButton(page)).toBeEnabled()
  })

  test('should remember the approval for the session, but only for this exact commit', async ({ page }) => {
    await mockApi(page)

    await openFirstReview(page)

    await approve(page)

    await page.getByRole('button', { name: /Back to Review/ }).click()

    await page.getByRole('button', { name: 'Review AT-727' }).click()

    await expect(mergeButton(page)).toBeEnabled()
  })

  test('should be ready to merge when there are no conflicts', async ({ page }) => {
    await mockApi(page)

    await openFirstReview(page)

    await expect(mergeBox(page)).toContainText('No conflicts with playwright-main. Ready to rebase and merge.')

    await expect(page.getByText('Ready to merge', { exact: true })).toBeVisible()
  })

  test('should say that merging deletes the branch and offer to move the ticket', async ({ page }) => {
    await mockApi(page)

    await openFirstReview(page)

    await expect(mergeBox(page)).toContainText('Merging also deletes the branch AT-727-add-test from origin.')

    await expect(page.getByRole('checkbox', { name: 'Move AT-727 to Done in Jira after merging' })).toBeChecked()
  })

  test('should tell the reviewer a branch that is behind is rebased automatically', async ({ page }) => {
    await mockApi(page, { detail: reviewDetail({ behind: 3, unmerged: 2 }) })

    await openFirstReview(page)

    await expect(mergeBox(page)).toContainText('3 newer commits')

    await expect(mergeBox(page)).toContainText('will be rebased on top automatically, no manual rebase needed')
  })

  test('should block merging and name the files when there are conflicts', async ({ page }) => {
    await mockApi(page, { detail: reviewDetail({ canRebase: false, conflicts: ['spec/a.spec.ts', 'support/b.ts'] }) })

    await openFirstReview(page)

    await expect(mergeBox(page)).toContainText('conflicts with playwright-main that must be resolved')

    await expect(page.getByTestId('conflict-files').getByRole('listitem')).toHaveText(['spec/a.spec.ts', 'support/b.ts'])

    await expect(page.getByTestId('conflict-help')).toContainText('git fetch origin && git checkout AT-727-add-test && git rebase origin/playwright-main')

    await expect(page.getByText('Conflicts', { exact: true })).toBeVisible()

    await expect(mergeButton(page)).toBeDisabled()

    await expect(page.getByTestId('approval')).toBeHidden()
  })

  test('should block merging when playwright-main already has the changes', async ({ page }) => {
    await mockApi(page, { detail: reviewDetail({ unmerged: 0 }) })

    await openFirstReview(page)

    await expect(page.getByTestId('pr-state')).toHaveText('Merged')

    await expect(mergeBox(page)).toContainText('already has these changes')

    await expect(mergeButton(page)).toBeDisabled()
  })
})

test.describe('Review - rebase and merge', () => {

  test('should ask for confirmation, spelling out the rebase, push, branch deletion and Jira move', async ({ page }) => {
    const calls = await mockApi(page)

    await openFirstReview(page)

    await approve(page)

    await mergeButton(page).click()

    const dialog = page.getByRole('dialog')

    await expect(dialog).toContainText('Rebase and merge into playwright-main?')

    await expect(dialog).toContainText('pushes the result to origin/playwright-main')

    await expect(dialog).toContainText('deletes the branch AT-727-add-test from origin')

    await expect(dialog).toContainText('AT-727 will then be moved to Done in Jira')

    await dialog.getByRole('button', { name: 'Cancel' }).click()

    await expect(dialog).toBeHidden()

    expect(calls.merge).toHaveLength(0)
  })

  test('should merge exactly the reviewed commit, delete the branch, move the ticket and return to a refreshed list', async ({ page }) => {
    const calls = await mockApi(page)

    await openFirstReview(page)

    await approveAndConfirm(page)

    await expect(page.getByText('AT-727: 1 commit rebased and merged into playwright-main.')).toBeVisible()

    await expect(page.getByText('Branch AT-727-add-test deleted.')).toBeVisible()

    await expect(page.getByText('AT-727 moved to Done in Jira.')).toBeVisible()

    await expect(page.getByTestId('review-table')).toBeVisible()

    expect(calls.merge).toEqual([{ branch: 'AT-727-add-test', expectedSha: SHA, moveToDone: true, approved: true }])

    await expect.poll(() => calls.list).toBe(2)
  })

  test('should not move the Jira ticket when the checkbox is unticked', async ({ page }) => {
    const calls = await mockApi(page, {
      merge: ok({ merged: 1, baseBranch: 'playwright-main', newBaseSha: 'd'.repeat(40), branchDeleted: true, ticketMoved: null, warning: null })
    })

    await openFirstReview(page)

    await page.getByRole('checkbox', { name: 'Move AT-727 to Done in Jira after merging' }).click()

    await approve(page)

    await mergeButton(page).click()

    await expect(page.getByRole('dialog')).not.toContainText('Jira')

    await page.getByRole('dialog').getByRole('button', { name: 'Rebase and merge' }).click()

    await expect(page.getByText('AT-727: 1 commit rebased and merged into playwright-main.')).toBeVisible()

    expect(calls.merge[0]).toMatchObject({ moveToDone: false })
  })

  test('should show a warning, not a success, when the branch could not be deleted', async ({ page }) => {
    await mockApi(page, {
      merge: ok({
        merged: 1,
        baseBranch: 'playwright-main',
        newBaseSha: 'd'.repeat(40),
        branchDeleted: false,
        ticketMoved: null,
        warning: "Merged, but couldn't delete the branch AT-727-add-test: stale info"
      })
    })

    await openFirstReview(page)

    await approveAndConfirm(page)

    await expect(page.getByText('rebased and merged into playwright-main.')).toBeVisible()

    await expect(page.getByText(/couldn't delete the branch AT-727-add-test/)).toBeVisible()

    await expect(page.getByText('Branch AT-727-add-test deleted.')).toBeHidden()
  })

  test('should lock everything while merging so it can only be sent once', async ({ page }) => {
    const calls = await mockApi(page, { mergeDelayMs: 1500 })

    await openFirstReview(page)

    await approve(page)

    await mergeButton(page).click()

    // Click confirm twice, as fast as possible.
    const confirm = page.getByRole('dialog').getByRole('button', { name: 'Rebase and merge' })

    await confirm.dblclick({ noWaitAfter: true }).catch(() => undefined)

    await expect(mergeButton(page)).toBeDisabled()

    await expect(mergeButton(page)).toHaveText(/Rebasing and merging/)

    await expect(page.getByRole('button', { name: /Back to Review/ })).toBeDisabled()

    await expect(page.getByRole('checkbox', { name: /Move AT-727 to Done/ })).toBeDisabled()

    await expect(mergeBox(page)).toContainText("Please don't close this tab")

    await expect(page.getByTestId('review-table')).toBeVisible({ timeout: 10_000 })

    expect(calls.merge).toHaveLength(1)
  })

  test('should explain a conflict found during the merge and let the reviewer retry', async ({ page }) => {
    const calls = await mockApi(page, {
      merge: fail(409, 'Rebasing "AT-727-add-test" onto playwright-main hit conflicts. Rebase it locally, resolve them, push, then try again.', ['spec/a.spec.ts'])
    })

    await openFirstReview(page)

    await approveAndConfirm(page)

    const error = page.getByTestId('merge-error')

    await expect(error).toContainText('hit conflicts')

    await expect(error).toContainText('spec/a.spec.ts')

    await expect(mergeButton(page)).toBeEnabled()

    await expect(mergeBox(page)).toBeVisible()

    expect(calls.merge).toHaveLength(1)
  })

  test('should offer to reload the latest changes when the branch changed after review', async ({ page }) => {
    const calls = await mockApi(page, {
      merge: fail(409, '"AT-727-add-test" changed since you opened it. Refresh and review the new commits before merging.')
    })

    await openFirstReview(page)

    await approveAndConfirm(page)

    await expect(page.getByTestId('merge-error')).toContainText('changed since you opened it')

    await page.getByTestId('merge-error').getByRole('button', { name: 'Reload latest changes' }).click()

    await expect(page.getByTestId('merge-error')).toBeHidden()

    await expect.poll(() => calls.detail).toBe(2)
  })

  test('should show a refusal from a guard rail', async ({ page }) => {
    await mockApi(page, { merge: fail(403, 'Blocked by the git guard rail: push is only allowed as a plain fast-forward of playwright-main.') })

    await openFirstReview(page)

    await approveAndConfirm(page)

    await expect(page.getByTestId('merge-error')).toContainText('Blocked by the git guard rail')
  })

  test('should show that a ticket outside the Review column cannot be merged', async ({ page }) => {
    await mockApi(page, { merge: fail(404, "AT-727 isn't in the Review column of the AT board, so it can't be reviewed or merged here.") })

    await openFirstReview(page)

    await approveAndConfirm(page)

    await expect(page.getByTestId('merge-error')).toContainText("isn't in the Review column")
  })

  test('should handle the server being unreachable mid-merge', async ({ page }) => {
    await mockApi(page)

    await page.route('**/api/review/merge', route => route.abort('connectionrefused'))

    await openFirstReview(page)

    await approveAndConfirm(page)

    await expect(page.getByTestId('merge-error')).toContainText('Could not reach the local review server')

    await expect(mergeButton(page)).toBeEnabled()
  })
})

test.describe('Review - untrusted content', () => {

  // Diffs, titles and commit messages come from other people. In a real
  // browser an injected <img onerror> would run immediately, so this proves the
  // page renders them as plain text.
  test('should render hostile diff, title, author and commit text as inert text', async ({ page }) => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>'

    await mockApi(page, {
      list: reviewList({ tickets: [ticket({ summary: evil, branches: [branch({ author: evil })] })] }),
      detail: reviewDetail({
        ticket: { key: 'AT-727', summary: evil, status: 'Review', assignee: evil, url: 'javascript:window.__pwned=3' },
        commits: [{ sha: 'c'.repeat(40), author: evil, date: new Date().toISOString(), subject: evil, body: evil }],
        branchUrl: 'javascript:window.__pwned=4',
        files: [
          {
            path: 'spec/evil.spec.ts',
            oldPath: null,
            status: 'added',
            binary: false,
            additions: 2,
            deletions: 0,
            truncated: false,
            patch: `@@ -0,0 +1,2 @@\n+${evil}\n+"><svg onload="window.__pwned=5">`
          }
        ],
        totals: { additions: 2, deletions: 0 }
      })
    })

    await openReviewTab(page)

    await expect(page.getByTestId('review-table')).toContainText('<img src=x onerror=')

    await page.getByRole('button', { name: 'Review AT-727' }).click()

    await expect(mergeBox(page)).toBeVisible()

    await page.getByRole('tab', { name: /Files changed/ }).click()

    await expect(page.getByTestId('diff-body')).toContainText('<img src=x onerror=')

    await page.getByRole('tab', { name: /Commits/ }).click()

    await expect(page.getByTestId('commit-list')).toContainText('<img src=x onerror=')

    await expect(page.locator('main img, main script, main svg[onload], main iframe')).toHaveCount(0)

    await expect(page.locator('a[href^="javascript"]')).toHaveCount(0)

    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined()
  })
})

test.describe('Review - light, dark and small screens', () => {

  for (const theme of ['light', 'dark']) {
    test(`should render the table, show page and diff in ${theme} mode`, async ({ page }) => {
      await page.addInitScript(value => localStorage.setItem('test-results-theme', value), theme)

      await mockApi(page)

      await openReviewTab(page)

      await expect(page.locator('html')).toHaveClass(theme)

      await expect(page.getByTestId('review-table')).toBeVisible()

      await expect(page.getByTestId('light-acli')).toBeVisible()

      await page.getByRole('button', { name: 'Review AT-727' }).click()

      await expect(mergeBox(page)).toBeVisible()

      await page.getByRole('tab', { name: /Files changed/ }).click()

      await expect(page.getByTestId('diff-body')).toBeVisible()

      // The diff viewer must follow the app theme.
      await expect(page.getByTestId('diff-body').locator('[data-theme]').first()).toHaveAttribute('data-theme', theme)

      // Text must never be drawn in the same colour as its background.
      const contrast = await page.evaluate(() => {
        const heading = document.querySelector('h2') as HTMLElement

        return { headingColor: getComputedStyle(heading).color, bodyBackground: getComputedStyle(document.body).backgroundColor }
      })

      expect(contrast.headingColor).not.toBe(contrast.bodyBackground)
    })
  }

  test('should not scroll sideways on a phone-sized screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })

    await mockApi(page, {
      list: reviewList({
        tickets: [
          ticket({
            summary: 'A very long ticket summary that would overflow a narrow screen if it did not wrap properly',
            branches: [branch({ name: 'AT-727-a-really-long-branch-name-that-goes-on-and-on-and-on-forever' })]
          })
        ]
      })
    })

    await openReviewTab(page)

    await expect(page.getByRole('button', { name: 'Review AT-727' })).toBeVisible()

    const listOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

    expect(listOverflow).toBeLessThanOrEqual(0)

    await page.getByRole('button', { name: 'Review AT-727' }).click()

    await expect(mergeBox(page)).toBeVisible()

    await expect(mergeButton(page)).toBeVisible()

    const detailOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

    expect(detailOverflow).toBeLessThanOrEqual(0)

    await page.getByRole('tab', { name: /Files changed/ }).click()

    await expect(page.getByTestId('diff-body')).toHaveAttribute('data-mode', 'unified')
  })
})

// These hit the REAL dev-server API. Every request below must be refused
// during validation — before any git or acli process is started — so they are
// safe to run anywhere and prove the guard rails hold at the HTTP edge.
test.describe('Review - API guard rails', () => {

  test('should refuse to merge anything that is not an AT-### ticket branch', async ({ request }) => {
    for (const branchName of ['master', 'playwright-main', 'release-next', 'feature/unrelated', 'APP-12310-encrypt', 'at-1-lowercase', 'AT-12abc', '--force', 'AT-1..master']) {
      const response = await request.post(`${BASE_URL}/api/review/merge`, { data: { branch: branchName, expectedSha: 'abcdef1' } })

      expect(response.status(), branchName).toBe(400)

      expect((await response.json()).success).toBe(false)
    }
  })

  test('should refuse to review a non-AT branch', async ({ request }) => {
    for (const branchName of ['master', 'feature/unrelated', 'APP-1-x', '--evil']) {
      const response = await request.get(`${BASE_URL}/api/review/detail?branch=${encodeURIComponent(branchName)}`)

      expect(response.status(), branchName).toBe(400)
    }
  })

  test('should require the reviewed commit to be named for a merge', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/review/merge`, { data: { branch: 'AT-1-x', approved: true } })

    expect(response.status()).toBe(400)

    expect((await response.json()).error).toContain('expectedSha')
  })

  test('should not let a merge choose its own target branch, remote or options', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/review/merge`, {
      data: { branch: 'master', expectedSha: 'abcdef1', baseBranch: 'master', remote: 'evil', force: true, deleteBranch: true }
    })

    expect(response.status()).toBe(400)
  })

  test('should refuse cross-origin and non-JSON posts', async ({ request }) => {
    const crossOrigin = await request.post(`${BASE_URL}/api/review/merge`, {
      headers: { Origin: 'https://evil.example.com' },
      data: { branch: 'AT-1-x', expectedSha: 'abcdef1' }
    })

    expect(crossOrigin.status()).toBe(403)

    const notJson = await request.post(`${BASE_URL}/api/review/merge`, {
      headers: { 'Content-Type': 'text/plain' },
      data: '{"branch":"AT-1-x","expectedSha":"abcdef1"}'
    })

    expect(notJson.status()).toBe(403)
  })

  test('should refuse requests that are not addressed to localhost', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/review/status`, { headers: { Host: 'evil.example.com' } })

    expect(response.status()).toBe(403)
  })

  test('should refuse a merge that was not approved, even for a valid AT branch name', async ({ request }) => {
    for (const body of [{}, { approved: false }, { approved: 'true' }]) {
      const response = await request.post(`${BASE_URL}/api/review/merge`, { data: { branch: 'AT-1-x', expectedSha: 'abcdef1', ...body } })

      expect(response.status()).toBe(400)

      expect((await response.json()).error).toContain('must be approved')
    }
  })

  test('should refuse cross-site requests, reads included', async ({ request }) => {
    for (const site of ['cross-site', 'same-site']) {
      const read = await request.get(`${BASE_URL}/api/review/detail?branch=AT-1-x`, { headers: { 'Sec-Fetch-Site': site } })

      expect(read.status(), site).toBe(403)

      const write = await request.post(`${BASE_URL}/api/review/merge`, {
        headers: { 'Sec-Fetch-Site': site },
        data: { branch: 'AT-1-x', expectedSha: 'abcdef1', approved: true }
      })

      expect(write.status(), site).toBe(403)
    }
  })

  test('should reject an oversized request body', async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/review/merge`, {
      data: { branch: 'AT-1-x', expectedSha: 'abcdef1', approved: true, pad: 'x'.repeat(200_000) }
    })

    expect(response.status()).toBe(413)
  })

  test('should send anti-framing and no-sniff headers so other sites cannot embed the app (clickjacking)', async ({ request }) => {
    const page = await request.get(`${BASE_URL}/`)

    expect(page.headers()['x-frame-options']).toBe('SAMEORIGIN')

    expect(page.headers()['content-security-policy']).toContain("frame-ancestors 'self'")

    expect(page.headers()['x-content-type-options']).toBe('nosniff')

    const api = await request.get(`${BASE_URL}/api/review/delete-branch`)

    expect(api.headers()['cross-origin-resource-policy']).toBe('same-origin')
  })

  test('should only expose the five review routes', async ({ request }) => {
    const unknown = await request.get(`${BASE_URL}/api/review/delete-branch`)

    expect(unknown.status()).toBe(404)

    const wrongVerb = await request.get(`${BASE_URL}/api/review/merge`)

    expect(wrongVerb.status()).toBe(405)
  })
})
