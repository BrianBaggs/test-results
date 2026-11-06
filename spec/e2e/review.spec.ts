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
  reviewers: [],
  approval: null,
  reviewInfo: '',
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
    reviewers: ['Matthew Carabin'],
    approval: null,
    reviewInfo: '',
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
  specs: [],
  serverCodeChanged: [],
  supportFiles: [],
  totals: { additions: 2, deletions: 1 },
  branchUrl: 'https://github.com/carbidesecure/securicy-app/tree/AT-727-add-test',
  ...over
})

const SPEC_A = 'spec/playwright/playwright/e2e/tasks/show/admin/recurring_comments_completed.spec.ts'
const SPEC_B = 'spec/playwright/playwright/e2e/tasks/show/owner/recurring_comments_completed.spec.ts'

const testServerStatus = (over = {}) => ({ up: true, host: '127.0.0.1', port: 5017, startCommand: 'yarn test:server', activeJob: null, ...over })

const specResult = (file: string, status = 'passed') => ({
  file,
  status,
  durationMs: 4200,
  tests:
    status === 'passed'
      ? [{ title: 'Recurring task comments › Comment stays shared', line: 41, status: 'passed', durationMs: 4200, error: null }]
      : [
          { title: 'Recurring task comments › Comment stays shared', line: 41, status: 'passed', durationMs: 1000, error: null },
          {
            title: 'Recurring task comments › Evidence is copied',
            line: 55,
            status: 'failed',
            durationMs: 3200,
            error: {
              message: 'Error: expect(locator).toContainText(expected)\n\nExpected substring: "Evidence for this"',
              stack: 'Error: expect(locator).toContainText(expected)\n    at recurring_comments_completed.spec.ts:57:9',
              snippet: "> 57 | await expect(page.locator('.comments')).toContainText('Evidence for this')"
            }
          }
        ]
})

const specJob = (over = {}) => ({
  id: 'job-1',
  branch: 'AT-727-add-test',
  sha: SHA,
  status: 'passed',
  specs: [SPEC_A],
  startedAt: new Date(Date.now() - 12_000).toISOString(),
  finishedAt: new Date().toISOString(),
  elapsedMs: 12_400,
  output: 'Running 1 test using 1 worker\n  ✓  1 [chromium] › recurring_comments_completed.spec.ts:41:7 › works (4.2s)\n  1 passed (5.0s)\n',
  nextOffset: 120,
  truncated: false,
  results: [specResult(SPEC_A)],
  error: null,
  warnings: ['Copied 2 fixture/cassette files from this PR into your test server checkout for the run. They are restored when it finishes.'],
  serverCodeChanged: [],
  exitCode: 0,
  ...over
})

const runningJob = (status = 'running') => specJob({ status, finishedAt: null, results: null, exitCode: null, output: 'Running 1 test using 1 worker\n', nextOffset: 30, elapsedMs: 2000 })

const ok = (data: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) })
const fail = (status: number, error: string, details: string[] = []) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({ success: false, error, details })
})

async function mockApi(
  page: Page,
  opts: {
    status?: unknown
    gh?: unknown
    list?: unknown
    detail?: unknown
    merge?: unknown
    mergeDelayMs?: number
    /** Holds the list / detail response back, to see the loading placeholders. */
    listDelayMs?: number
    detailDelayMs?: number
    decision?: unknown
    testServer?: unknown
    testRun?: unknown
    /** What the job endpoint returns on each poll; the last one repeats. */
    jobs?: unknown[]
  } = {}
) {
  const calls = {
    list: 0,
    detail: 0,
    merge: [] as Array<Record<string, unknown>>,
    decision: [] as Array<Record<string, unknown>>,
    run: [] as Array<Record<string, unknown>>,
    cancel: 0,
    jobPolls: 0,
    testServer: 0
  }

  await page.route('**/api/review/status', route => route.fulfill(ok(opts.status ?? reviewStatus())))

  await page.route('**/api/review/gh', route => route.fulfill(ok(opts.gh ?? ghReady)))

  await page.route('**/api/review/list', async route => {
    calls.list++
    if (opts.listDelayMs) await new Promise(resolve => setTimeout(resolve, opts.listDelayMs))
    await route.fulfill(ok(opts.list ?? reviewList()))
  })

  await page.route('**/api/review/detail**', async route => {
    calls.detail++
    if (opts.detailDelayMs) await new Promise(resolve => setTimeout(resolve, opts.detailDelayMs))
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

  // Jira echoes back what was saved: the ticket with the new Approval and Review Information.
  await page.route('**/api/review/decision', async route => {
    const body = route.request().postDataJSON() as { decision: string; info?: string }

    calls.decision.push(body)

    await route.fulfill(
      (opts.decision as Parameters<typeof route.fulfill>[0] | undefined) ??
        ok({
          ...(((opts.detail as { ticket?: object } | undefined)?.ticket ?? reviewDetail().ticket) as object),
          approval: body.decision === 'none' ? null : body.decision,
          reviewInfo: body.info ?? ''
        })
    )
  })

  await page.route('**/api/review/tests/status', route => {
    calls.testServer++

    return route.fulfill(ok(opts.testServer ?? testServerStatus()))
  })

  await page.route('**/api/review/tests/run', async route => {
    calls.run.push(route.request().postDataJSON())

    await route.fulfill((opts.testRun as Parameters<typeof route.fulfill>[0] | undefined) ?? ok({ id: 'job-1' }))
  })

  await page.route('**/api/review/tests/job**', async route => {
    const jobs = opts.jobs ?? [specJob()]

    await route.fulfill(ok(jobs[Math.min(calls.jobPolls, jobs.length - 1)]))

    calls.jobPolls++
  })

  await page.route('**/api/review/tests/cancel', async route => {
    calls.cancel++

    await route.fulfill(ok(runningJob('cleaning')))
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

/** Approve the way a reviewer does: the button, then the modal. */
const approve = async (page: Page, notes?: string) => {
  await page.getByTestId('approval').getByRole('button', { name: /^Approve/ }).click()

  if (notes !== undefined) await page.getByTestId('decision-modal').getByLabel(/Review information/).fill(notes)

  await page.getByTestId('decision-modal').getByRole('button', { name: /Approve and save to Jira/ }).click()

  await expect(page.getByTestId('decision-modal')).toBeHidden()
}

const decline = async (page: Page, reason: string) => {
  await page.getByTestId('approval').getByRole('button', { name: /^Decline/ }).click()

  await page.getByTestId('decision-modal').getByLabel(/Review information/).fill(reason)

  await page.getByTestId('decision-modal').getByRole('button', { name: /Decline and save to Jira/ }).click()

  await expect(page.getByTestId('decision-modal')).toBeHidden()
}

/** Like GitHub: the first click only asks. These are the inline second step (no dialog). */
const confirmBox = (page: Page) => page.getByTestId('merge-confirm')

const confirmMerge = (page: Page) => confirmBox(page).getByRole('button', { name: 'Confirm rebase and merge' })

async function approveAndConfirm(page: Page) {
  await approve(page)

  await mergeButton(page).click()

  await confirmMerge(page).click()
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

    for (const id of ['git', 'repo', 'acli', 'gh', 'test']) {
      await expect(page.getByTestId(`light-${id}`)).toHaveAttribute('data-state', 'ok')
    }

    await expect(page.getByTestId('light-test')).toContainText('Running on :5017')

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

  test('should show the test server light red, with how to start it, when it is not running (and not block the review)', async ({ page }) => {
    await mockApi(page, { testServer: testServerStatus({ up: false }) })

    await openReviewTab(page)

    await expect(page.getByTestId('light-test')).toHaveAttribute('data-state', 'bad')

    await expect(page.getByTestId('light-test')).toContainText('Not running')

    await expect(page.getByTestId('status-hints')).toContainText('yarn test:server')

    await expect(page.getByTestId('status-hints')).toContainText('never starts it for you')

    await expect(page.getByTestId('review-ticket')).toHaveCount(1)
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

    await expect(page.getByText(/Approved in Jira/)).toBeVisible()

    await expect(mergeButton(page)).toBeEnabled()
  })

  test('should let the reviewer approve from the files tab and jump to the merge box', async ({ page }) => {
    await mockApi(page)

    await openFirstReview(page)

    await page.getByRole('tab', { name: /Files changed/ }).click()

    await page.getByTestId('review-footer').getByRole('button', { name: /^Approve/ }).click()

    await page.getByTestId('decision-modal').getByRole('button', { name: /Approve and save to Jira/ }).click()

    await expect(page.getByTestId('review-footer')).toContainText('approved in Jira')

    await page.getByTestId('review-footer').getByRole('button', { name: 'Go to merge box' }).click()

    await expect(page.getByRole('tab', { name: 'Conversation' })).toHaveAttribute('aria-selected', 'true')

    await expect(mergeButton(page)).toBeEnabled()
  })

  test('should read an existing approval from Jira, so an approved ticket can be merged straight away', async ({ page }) => {
    await mockApi(page, { detail: reviewDetail({ ticket: { ...reviewDetail().ticket, approval: 'approved', reviewInfo: 'LGTM' } }) })

    await openFirstReview(page)

    await expect(page.getByTestId('approval')).toHaveAttribute('data-state', 'approved')

    await expect(page.getByTestId('review-info')).toContainText('LGTM')

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

    // The reviewer can still record a decision (e.g. decline it), but approving does not unlock a conflicting merge.
    await approve(page)

    await expect(mergeButton(page)).toBeDisabled()

    await expect(page.getByTestId('merge-confirm')).toHaveCount(0)
  })

  test('should block merging when playwright-main already has the changes', async ({ page }) => {
    await mockApi(page, { detail: reviewDetail({ unmerged: 0 }) })

    await openFirstReview(page)

    await expect(page.getByTestId('pr-state')).toHaveText('Merged')

    await expect(mergeBox(page)).toContainText('already has these changes')

    await expect(mergeButton(page)).toBeDisabled()

    // Nothing left to approve once the changes are already in playwright-main.
    await expect(page.getByTestId('approval')).toBeHidden()
  })
})

test.describe('Review - rebase and merge', () => {

  test('should ask first: one click shows Confirm and Cancel inline (no dialog) and sends nothing', async ({ page }) => {
    const calls = await mockApi(page)

    await openFirstReview(page)

    await approve(page)

    await expect(confirmBox(page)).toBeHidden()

    await mergeButton(page).click()

    await expect(page.getByRole('dialog')).toHaveCount(0)

    await expect(confirmBox(page)).toBeVisible()

    await expect(confirmMerge(page)).toBeVisible()

    await expect(confirmMerge(page)).toBeFocused()

    await expect(confirmBox(page).getByRole('button', { name: 'Cancel' })).toBeVisible()

    // The first button is replaced, so the merge can't be triggered by a stray second click.
    await expect(mergeButton(page)).toHaveCount(0)

    expect(calls.merge).toHaveLength(0)
  })

  test('should spell out the rebase, push, branch deletion and Jira move in the confirmation', async ({ page }) => {
    await mockApi(page)

    await openFirstReview(page)

    await approve(page)

    await mergeButton(page).click()

    const text = page.getByTestId('merge-confirm-text')

    await expect(text).toContainText('rebases 1 commit from AT-727-add-test onto the latest playwright-main')

    await expect(text).toContainText('pushes the result to origin/playwright-main')

    await expect(text).toContainText('deletes the branch AT-727-add-test from origin')

    await expect(text).toContainText('AT-727 will then be moved to Done in Jira')
  })

  test('should put everything back when Cancel is clicked, and send nothing', async ({ page }) => {
    const calls = await mockApi(page)

    await openFirstReview(page)

    await approve(page)

    await mergeButton(page).click()

    await confirmBox(page).getByRole('button', { name: 'Cancel' }).click()

    await expect(confirmBox(page)).toBeHidden()

    await expect(mergeButton(page)).toBeEnabled()

    expect(calls.merge).toHaveLength(0)
  })

  test('should cancel on Escape', async ({ page }) => {
    const calls = await mockApi(page)

    await openFirstReview(page)

    await approve(page)

    await mergeButton(page).click()

    await expect(confirmMerge(page)).toBeFocused()

    await page.keyboard.press('Escape')

    await expect(confirmBox(page)).toBeHidden()

    await expect(mergeButton(page)).toBeEnabled()

    expect(calls.merge).toHaveLength(0)
  })

  test('should withdraw the confirmation if the PR is declined while it is open', async ({ page }) => {
    const calls = await mockApi(page)

    await openFirstReview(page)

    await approve(page)

    await mergeButton(page).click()

    await expect(confirmBox(page)).toBeVisible()

    await decline(page, 'Found a problem after all')

    await expect(confirmBox(page)).toBeHidden()

    await expect(mergeButton(page)).toBeDisabled()

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

    await expect(page.getByTestId('merge-confirm-text')).not.toContainText('Jira')

    await confirmMerge(page).click()

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
    await confirmMerge(page).dblclick({ noWaitAfter: true }).catch(() => undefined)

    await expect(mergeButton(page)).toBeDisabled()

    await expect(mergeButton(page)).toHaveText(/Rebasing and merging/)

    await expect(page.getByRole('button', { name: /Back to Review/ })).toBeDisabled()

    await expect(page.getByRole('checkbox', { name: /Move AT-727 to Done/ })).toBeDisabled()

    await expect(mergeBox(page)).toContainText("Please don't close this tab")

    await expect(page.getByTestId('review-table')).toBeVisible({ timeout: 10_000 })

    expect(calls.merge).toHaveLength(1)
  })

  test('should not confirm by itself when Rebase and merge is double-clicked', async ({ page }) => {
    const calls = await mockApi(page)

    await openFirstReview(page)

    await approve(page)

    await mergeButton(page).dblclick()

    await expect(confirmBox(page)).toBeVisible()

    await page.waitForTimeout(400)

    expect(calls.merge).toHaveLength(0)

    await expect(confirmBox(page)).toBeVisible()
  })

  test('should not confirm when Enter is held down on Rebase and merge (the key repeat must not reach Confirm)', async ({ page }) => {
    const calls = await mockApi(page)

    await openFirstReview(page)

    await approve(page)

    await mergeButton(page).focus()

    // the first key-down activates the button; Confirm appears and takes the focus
    await page.keyboard.down('Enter')

    await expect(confirmBox(page)).toBeVisible()

    await expect(confirmMerge(page)).toBeFocused()

    // the browser keeps repeating the key while it stays down
    for (let i = 0; i < 6; i++) await page.keyboard.down('Enter')

    await page.keyboard.up('Enter')

    await page.waitForTimeout(300)

    await expect(confirmBox(page)).toBeVisible()

    expect(calls.merge).toHaveLength(0)

    // a fresh, deliberate press does confirm
    await page.keyboard.press('Enter')

    await expect.poll(() => calls.merge.length).toBe(1)
  })

  test('should send exactly one request when Confirm is pressed repeatedly with the keyboard', async ({ page }) => {
    const calls = await mockApi(page, { mergeDelayMs: 1500 })

    await openFirstReview(page)

    await approve(page)

    await mergeButton(page).click()

    await expect(confirmMerge(page)).toBeFocused()

    await page.keyboard.press('Enter')

    await page.keyboard.press('Enter')

    await page.keyboard.press('Space')

    await page.keyboard.press('Enter')

    await expect(mergeButton(page)).toHaveText(/Rebasing and merging/)

    await expect(page.getByTestId('review-table')).toBeVisible({ timeout: 10_000 })

    expect(calls.merge).toHaveLength(1)
  })

  test('should show the server refusal when the same ticket is already being merged (another tab, or a reload mid-merge)', async ({ page }) => {
    await mockApi(page, { merge: fail(409, '"AT-727-add-test" is already being merged. Wait for that to finish; there is no need to click again.') })

    await openFirstReview(page)

    await approveAndConfirm(page)

    await expect(page.getByTestId('merge-error')).toContainText('already being merged')

    await expect(mergeButton(page)).toBeEnabled()
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

test.describe('Review - approving and declining (Jira Approval and Review Information fields)', () => {

  test('should open a modal with a text box when approving, and save the notes with the approval', async ({ page }) => {
    const calls = await mockApi(page)

    await openFirstReview(page)

    await page.getByTestId('approval').getByRole('button', { name: /^Approve/ }).click()

    const modal = page.getByTestId('decision-modal')

    await expect(modal.getByRole('heading', { name: 'Approve AT-727' })).toBeVisible()

    await expect(modal).toContainText('ticks Approved on AT-727 in Jira')

    await expect(modal).toContainText('Review Information')

    await modal.getByLabel(/Review information/).fill('Looks good, nice cleanup.')

    await expect(modal.getByTestId('review-info-count')).toContainText('25 / 5,000')

    await modal.getByRole('button', { name: 'Approve and save to Jira' }).click()

    await expect(page.getByText('AT-727 approved in Jira.')).toBeVisible()

    await expect(modal).toBeHidden()

    await expect(page.getByTestId('approval')).toHaveAttribute('data-state', 'approved')

    await expect(page.getByTestId('review-info')).toContainText('Looks good, nice cleanup.')

    await expect(page.getByTestId('pr-sidebar')).toContainText('Approved')

    await expect(mergeButton(page)).toBeEnabled()

    expect(calls.decision).toEqual([{ branch: 'AT-727-add-test', expectedSha: SHA, decision: 'approved', info: 'Looks good, nice cleanup.' }])
  })

  test('should approve with no notes at all', async ({ page }) => {
    const calls = await mockApi(page)

    await openFirstReview(page)

    await approve(page)

    expect(calls.decision).toEqual([{ branch: 'AT-727-add-test', expectedSha: SHA, decision: 'approved' }])
  })

  test('should require a reason to decline, then check Declined and save the reason', async ({ page }) => {
    const calls = await mockApi(page)

    await openFirstReview(page)

    await page.getByTestId('approval').getByRole('button', { name: /^Decline/ }).click()

    const modal = page.getByTestId('decision-modal')

    await expect(modal.getByRole('heading', { name: 'Decline AT-727' })).toBeVisible()

    await modal.getByRole('button', { name: 'Decline and save to Jira' }).click()

    await expect(modal.getByTestId('review-info-help')).toContainText('Say why you are declining')

    await expect(modal.getByRole('button', { name: 'Decline and save to Jira' })).toBeDisabled()

    expect(calls.decision).toHaveLength(0)

    await modal.getByLabel(/Review information/).fill('The cleanup step is missing.\nAlso tag it @critical.')

    await modal.getByRole('button', { name: 'Decline and save to Jira' }).click()

    await expect(page.getByText('AT-727 declined in Jira.')).toBeVisible()

    await expect(page.getByTestId('approval')).toHaveAttribute('data-state', 'declined')

    await expect(page.getByText(/Declined in Jira. Merging is blocked/)).toBeVisible()

    await expect(page.getByTestId('review-info')).toContainText('The cleanup step is missing.')

    await expect(mergeButton(page)).toBeDisabled()

    expect(calls.decision).toEqual([
      { branch: 'AT-727-add-test', expectedSha: SHA, decision: 'declined', info: 'The cleanup step is missing.\nAlso tag it @critical.' }
    ])
  })

  test('should let a declined PR be approved instead, which unlocks the merge', async ({ page }) => {
    await mockApi(page)

    await openFirstReview(page)

    await decline(page, 'Needs a cleanup step')

    await expect(mergeButton(page)).toBeDisabled()

    await page.getByTestId('approval').getByRole('button', { name: /Approve instead/ }).click()

    await expect(page.getByTestId('decision-modal').getByLabel(/Review information/)).toHaveValue('Needs a cleanup step')

    await page.getByTestId('decision-modal').getByRole('button', { name: /Approve and save to Jira/ }).click()

    await expect(page.getByTestId('approval')).toHaveAttribute('data-state', 'approved')

    await expect(mergeButton(page)).toBeEnabled()
  })

  test('should undo a decision, which clears the checkbox in Jira', async ({ page }) => {
    const calls = await mockApi(page)

    await openFirstReview(page)

    await approve(page)

    await page.getByRole('button', { name: /Undo approval/ }).click()

    await expect(page.getByTestId('approval')).toHaveAttribute('data-state', 'none')

    await expect(mergeButton(page)).toBeDisabled()

    expect(calls.decision.at(-1)).toEqual({ branch: 'AT-727-add-test', expectedSha: SHA, decision: 'none' })
  })

  test('should show a loading indicator while saving and not let the modal be closed', async ({ page }) => {
    await mockApi(page)

    await page.route('**/api/review/decision', async route => {
      await new Promise(resolve => setTimeout(resolve, 1200))

      await route.fulfill(ok({ ...reviewDetail().ticket, approval: 'approved', reviewInfo: '' }))
    })

    await openFirstReview(page)

    await page.getByTestId('approval').getByRole('button', { name: /^Approve/ }).click()

    const modal = page.getByTestId('decision-modal')

    await modal.getByRole('button', { name: 'Approve and save to Jira' }).click()

    await expect(modal.getByRole('button', { name: /Saving to Jira/ })).toBeDisabled()

    await expect(modal.getByRole('button', { name: /Saving to Jira/ }).locator('.animate-spin')).toBeVisible()

    await expect(modal.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    await page.keyboard.press('Escape')

    await expect(modal).toBeVisible()

    await expect(modal).toBeHidden({ timeout: 5000 })
  })

  test('should keep the typed text and offer a manual fallback when Jira cannot be updated', async ({ page }) => {
    await mockApi(page, {
      decision: fail(502, "Your acli can't set these Jira fields. Set Approval and Review Information on AT-727 in Jira instead.")
    })

    await openFirstReview(page)

    await page.getByTestId('approval').getByRole('button', { name: /^Decline/ }).click()

    const modal = page.getByTestId('decision-modal')

    await modal.getByLabel(/Review information/).fill('Please fix the tags')

    await modal.getByRole('button', { name: 'Decline and save to Jira' }).click()

    await expect(modal.getByTestId('decision-error')).toContainText("Your acli can't set these Jira fields")

    await expect(modal.getByLabel(/Review information/)).toHaveValue('Please fix the tags')

    await expect(modal.getByRole('button', { name: /Copy review text/ })).toBeVisible()

    await expect(modal.getByRole('link', { name: /Open AT-727 in Jira/ })).toHaveAttribute('href', 'https://securicyapp.atlassian.net/browse/AT-727')

    await expect(page.getByTestId('approval')).toHaveAttribute('data-state', 'none')
  })

  test('should cancel without saving anything', async ({ page }) => {
    const calls = await mockApi(page)

    await openFirstReview(page)

    await page.getByTestId('approval').getByRole('button', { name: /^Approve/ }).click()

    await page.getByTestId('decision-modal').getByLabel(/Review information/).fill('half written')

    await page.getByTestId('decision-modal').getByRole('button', { name: 'Cancel' }).click()

    await expect(page.getByTestId('decision-modal')).toBeHidden()

    expect(calls.decision).toHaveLength(0)

    await expect(page.getByTestId('approval')).toHaveAttribute('data-state', 'none')
  })

  test('should show the reviewer under the assignee in the sidebar', async ({ page }) => {
    await mockApi(page)

    await openFirstReview(page)

    const labels = await page.getByTestId('pr-sidebar').locator('p.font-semibold').allTextContents()

    expect(labels.indexOf('Reviewer')).toBe(labels.indexOf('Assignee') + 1)

    await expect(page.getByTestId('pr-sidebar')).toContainText('Matthew Carabin')
  })
})

test.describe('Review - running the PR\'s Playwright specs', () => {
  const prWithSpecs = (over = {}) => reviewDetail({ specs: [SPEC_A, SPEC_B], ...over })

  async function openSpecs(page: Page) {
    await openFirstReview(page)

    await page.getByRole('tab', { name: /^Specs/ }).click()

    await expect(page.getByTestId('specs-panel')).toBeVisible()
  }

  test('should only show a Specs tab when the PR adds or changes specs', async ({ page }) => {
    await mockApi(page)

    await openFirstReview(page)

    await expect(page.getByRole('tab', { name: /^Specs/ })).toBeHidden()
  })

  test('should list the specs with play buttons and a green test server light', async ({ page }) => {
    await mockApi(page, { detail: prWithSpecs() })

    await openSpecs(page)

    await expect(page.getByRole('tab', { name: 'Specs (2)' })).toBeVisible()

    await expect(page.getByTestId('spec-row')).toHaveCount(2)

    await expect(page.getByTestId('test-server-badge')).toHaveAttribute('data-state', 'ok')

    await expect(page.getByTestId('test-server-badge')).toContainText('Running on :5017')

    await expect(page.getByTestId('run-all-specs')).toBeEnabled()

    await expect(page.getByRole('button', { name: 'Run recurring_comments_completed.spec.ts' })).toHaveCount(2)
  })

  test('should disable running and say to run yarn test:server when the test server is down (red light)', async ({ page }) => {
    const calls = await mockApi(page, { detail: prWithSpecs(), testServer: testServerStatus({ up: false }) })

    await openSpecs(page)

    await expect(page.getByTestId('test-server-badge')).toHaveAttribute('data-state', 'bad')

    await expect(page.getByTestId('test-server-down')).toContainText('yarn test:server')

    await expect(page.getByTestId('test-server-down')).toContainText('never starts it for you')

    await expect(page.getByTestId('run-all-specs')).toBeDisabled()

    for (const button of await page.getByRole('button', { name: /^Run recurring/ }).all()) await expect(button).toBeDisabled()

    expect(calls.run).toHaveLength(0)
  })

  test('should turn green and enable the play buttons once the server is started', async ({ page }) => {
    let up = false

    await mockApi(page, { detail: prWithSpecs() })

    await page.route('**/api/review/tests/status', route => route.fulfill(ok(testServerStatus({ up }))))

    await openSpecs(page)

    await expect(page.getByTestId('test-server-badge')).toHaveAttribute('data-state', 'bad')

    up = true

    await page.getByRole('button', { name: /Check again/ }).click()

    await expect(page.getByTestId('test-server-badge')).toHaveAttribute('data-state', 'ok')

    await expect(page.getByTestId('test-server-down')).toBeHidden()

    await expect(page.getByTestId('run-all-specs')).toBeEnabled()
  })

  test('should run one spec from its play button and show live progress in a modal, then a green check', async ({ page }) => {
    const calls = await mockApi(page, {
      detail: prWithSpecs(),
      jobs: [
        runningJob('preparing'),
        runningJob('syncing'),
        runningJob('running'),
        specJob({ specs: [SPEC_B], results: [specResult(SPEC_B)] })
      ]
    })

    await openSpecs(page)

    await page.getByRole('button', { name: 'Run recurring_comments_completed.spec.ts' }).nth(1).click()

    const modal = page.getByTestId('spec-run-modal')

    await expect(modal).toBeVisible()

    await expect(modal.getByRole('heading', { name: 'Running specs' })).toBeVisible()

    await modal.getByRole('tab', { name: 'Summary' }).click()

    await expect(modal.getByTestId('run-progress').locator('.animate-spin').first()).toBeVisible()

    await expect(modal.getByTestId('phase-running')).toHaveAttribute('data-state', 'active', { timeout: 8000 })

    await expect(modal.getByTestId('run-banner')).toHaveAttribute('data-status', 'passed', { timeout: 10_000 })

    await expect(modal.getByRole('heading', { name: 'Specs passed' })).toBeVisible()

    await expect(modal.getByTestId('run-counts')).toContainText('✓ 1 passed')

    await expect(modal.getByTestId('run-warnings')).toContainText('Copied 2 fixture/cassette files')

    await modal.getByRole('tab', { name: 'Output' }).click()

    await expect(modal.getByRole('log')).toContainText('Running 1 test using 1 worker')

    await expect(modal.getByRole('log')).toContainText('1 passed')

    expect(calls.run).toEqual([{ branch: 'AT-727-add-test', expectedSha: SHA, specs: [SPEC_B] }])

    await modal.getByRole('button', { name: 'Close' }).last().click()

    await expect(modal).toBeHidden()

    await expect(page.getByTestId('spec-row').nth(1).getByLabel('Passed')).toBeVisible()

    await expect(page.getByRole('tab', { name: /^Specs/ }).getByLabel('Specs passed')).toBeVisible()

    await expect(page.getByTestId('specs-last-run')).toContainText('✓ 1 passed')
  })

  test('should run all the PR\'s specs', async ({ page }) => {
    const calls = await mockApi(page, { detail: prWithSpecs(), jobs: [specJob({ specs: [SPEC_A, SPEC_B], results: [specResult(SPEC_A), specResult(SPEC_B)] })] })

    await openSpecs(page)

    await page.getByTestId('run-all-specs').click()

    await expect(page.getByTestId('spec-run-modal').getByTestId('run-banner')).toHaveAttribute('data-status', 'passed')

    await expect(page.getByTestId('spec-run-modal').getByTestId('run-banner')).toContainText('2 tests in 2 files')

    expect(calls.run).toEqual([{ branch: 'AT-727-add-test', expectedSha: SHA, specs: 'all' }])
  })

  test('should show a red X, the error message and the stack trace when a spec fails', async ({ page }) => {
    await mockApi(page, {
      detail: prWithSpecs(),
      jobs: [specJob({ status: 'failed', exitCode: 1, specs: [SPEC_A], results: [specResult(SPEC_A, 'failed')], output: '  ✘  1 breaks\n  1 failed\n' })]
    })

    await openSpecs(page)

    await page.getByRole('button', { name: 'Run recurring_comments_completed.spec.ts' }).first().click()

    const modal = page.getByTestId('spec-run-modal')

    await expect(modal.getByTestId('run-banner')).toHaveAttribute('data-status', 'failed')

    await expect(modal.getByRole('heading', { name: 'Specs failed' })).toBeVisible()

    await expect(modal.getByTestId('run-banner')).toContainText('1 test failed')

    await expect(modal.getByTestId('run-counts')).toContainText('✗ 1 failed')

    await expect(modal.getByTestId('spec-error')).toContainText('expect(locator).toContainText(expected)')

    await expect(modal.getByTestId('spec-error')).toContainText('Expected substring: "Evidence for this"')

    await expect(modal.getByTestId('spec-error')).toContainText("> 57 | await expect(page.locator('.comments'))")

    await expect(modal.getByTestId('spec-stack')).toContainText('at recurring_comments_completed.spec.ts:57:9')

    await expect(modal.getByRole('button', { name: /Run again/ })).toBeEnabled()

    await modal.getByRole('button', { name: 'Close' }).last().click()

    await expect(page.getByTestId('spec-row').first().getByLabel('Failed')).toBeVisible()

    await expect(page.getByRole('tab', { name: /^Specs/ }).getByLabel('Specs failed')).toBeVisible()
  })

  test('should show the raw output while the run is going, following the latest line', async ({ page }) => {
    await mockApi(page, {
      detail: prWithSpecs(),
      jobs: [
        { ...runningJob('running'), output: 'Running 2 tests using 1 worker\n', nextOffset: 31 },
        { ...runningJob('running'), output: '  ✓  1 first test (1.0s)\n', nextOffset: 55 },
        specJob({ output: '  ✓  2 second test (1.0s)\n  2 passed\n', nextOffset: 90 })
      ]
    })

    await openSpecs(page)

    await page.getByTestId('run-all-specs').click()

    const log = page.getByTestId('spec-run-modal').getByRole('log')

    await expect(log).toContainText('Running 2 tests using 1 worker')

    await expect(log).toContainText('first test', { timeout: 8000 })

    await expect(log.locator('[data-kind="pass"]').first()).toBeVisible()

    // When the run finishes the modal flips to the Summary; the whole output (all increments) is still on the Output tab.
    const modal = page.getByTestId('spec-run-modal')

    await expect(modal.getByRole('heading', { name: 'Specs passed' })).toBeVisible({ timeout: 8000 })

    await modal.getByRole('tab', { name: 'Output' }).click()

    const full = modal.getByRole('log')

    await expect(full).toContainText('Running 2 tests using 1 worker')

    await expect(full).toContainText('first test')

    await expect(full).toContainText('2 passed')
  })

  test('should lock the page while specs run (Back, merge, other play buttons) and unlock it afterwards', async ({ page }) => {
    await mockApi(page, {
      detail: prWithSpecs({ ticket: { ...reviewDetail().ticket, approval: 'approved' } }),
      jobs: [runningJob('running'), runningJob('running'), specJob({ specs: [SPEC_A], results: [specResult(SPEC_A)] })]
    })

    await openSpecs(page)

    await page.getByRole('button', { name: 'Run recurring_comments_completed.spec.ts' }).first().click()

    await page.getByTestId('spec-run-modal').getByRole('button', { name: 'Close' }).last().click()

    await expect(page.getByRole('button', { name: /Back to Review/ })).toBeDisabled()

    await expect(page.getByTestId('run-all-specs')).toBeDisabled()

    for (const button of await page.getByRole('button', { name: /^Run recurring/ }).all()) await expect(button).toBeDisabled()

    await expect(page.getByRole('tab', { name: /^Specs/ }).getByLabel('Specs running')).toBeVisible()

    await expect(page.getByRole('button', { name: /Back to Review/ })).toBeEnabled({ timeout: 10_000 })

    await expect(page.getByTestId('run-all-specs')).toBeEnabled()
  })

  test('should cancel a run from the modal', async ({ page }) => {
    const calls = await mockApi(page, {
      detail: prWithSpecs(),
      jobs: [runningJob('running'), specJob({ status: 'cancelled', results: null, output: 'started\n' })]
    })

    await openSpecs(page)

    await page.getByTestId('run-all-specs').click()

    await page.getByTestId('spec-run-modal').getByRole('button', { name: /Cancel run/ }).click()

    await expect(page.getByTestId('spec-run-modal').getByTestId('run-banner')).toHaveAttribute('data-status', 'cancelled', { timeout: 10_000 })

    await expect(page.getByTestId('spec-run-modal')).toContainText('Your checkout and test server files were restored.')

    expect(calls.cancel).toBe(1)
  })

  test('should explain a run that could not finish, and that everything was cleaned up', async ({ page }) => {
    await mockApi(page, {
      detail: prWithSpecs(),
      jobs: [specJob({ status: 'error', results: null, error: 'node_modules was not found in /Users/qa/Dev/securicy-app. Run `yarn install` there first.' })]
    })

    await openSpecs(page)

    await page.getByTestId('run-all-specs').click()

    const banner = page.getByTestId('spec-run-modal').getByTestId('run-banner')

    await expect(banner).toHaveAttribute('data-status', 'error')

    await expect(banner).toContainText('node_modules was not found')

    await expect(banner).toContainText('Everything was cleaned up')
  })

  test('should show a refusal to start (server went down since the last check) without opening the modal', async ({ page }) => {
    await mockApi(page, {
      detail: prWithSpecs(),
      testRun: fail(409, "The test server isn't running on 127.0.0.1:5017. Start it with `yarn test:server` in securicy-app, then try again.")
    })

    await openSpecs(page)

    await page.getByTestId('run-all-specs').click()

    await expect(page.getByTestId('specs-error')).toContainText('yarn test:server')

    await expect(page.getByTestId('spec-run-modal')).toBeHidden()
  })

  test('should warn about changed server-side files that are not copied', async ({ page }) => {
    await mockApi(page, { detail: prWithSpecs({ serverCodeChanged: ['spec/playwright/playwright/app_commands/x.rb'] }) })

    await openSpecs(page)

    await expect(page.getByTestId('server-code-warning')).toContainText('restart your test server from the PR branch')
  })

  test('should be usable on a phone-sized screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })

    await mockApi(page, { detail: prWithSpecs(), jobs: [specJob({ status: 'failed', specs: [SPEC_A], results: [specResult(SPEC_A, 'failed')] })] })

    await openSpecs(page)

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

    expect(overflow).toBeLessThanOrEqual(0)

    await page.getByTestId('run-all-specs').click()

    await expect(page.getByTestId('spec-run-modal').getByTestId('run-banner')).toBeVisible()

    const modalBox = await page.getByTestId('spec-run-modal').boundingBox()

    expect(modalBox!.width).toBeLessThanOrEqual(375)
  })
})

test.describe('Review - PRs that only change Playwright support files', () => {
  const P = 'spec/playwright/playwright'

  const supportOnly = (over = {}) =>
    reviewDetail({
      specs: [],
      supportFiles: [`${P}/support/helpers.ts`, `${P}/pages/login_page.ts`, `${P}/fixtures/vcr_cassettes/tasks.yml`, 'spec/fixtures/users.yml'],
      ...over
    })

  async function openSupportFiles(page: Page) {
    await openFirstReview(page)

    await page.getByRole('tab', { name: /^Support files/ }).click()

    await expect(page.getByTestId('support-only-panel')).toBeVisible()
  }

  test('should label the tab "Support files (N)" and explain that there is nothing to run', async ({ page }) => {
    await mockApi(page, { detail: supportOnly() })

    await openSupportFiles(page)

    await expect(page.getByRole('tab', { name: 'Support files (4)' })).toBeVisible()

    await expect(page.getByRole('tab', { name: /^Specs/ })).toBeHidden()

    await expect(page.getByRole('heading', { name: 'No specs in this PR' })).toBeVisible()
  })

  test('should group the changed files by what they are', async ({ page }) => {
    await mockApi(page, { detail: supportOnly() })

    await openSupportFiles(page)

    await expect(page.getByTestId('support-group-helpers')).toContainText('Helpers and support code (1)')

    await expect(page.getByTestId('support-group-pages')).toContainText('Page objects (1)')

    await expect(page.getByTestId('support-group-fixtures')).toContainText('Fixtures (1)')

    await expect(page.getByTestId('support-group-cassettes')).toContainText('VCR cassettes (1)')
  })

  test('should not offer to run anything, and should not touch the test server', async ({ page }) => {
    const calls = await mockApi(page, { detail: supportOnly() })

    await openSupportFiles(page)

    await expect(page.getByTestId('run-all-specs')).toHaveCount(0)

    await expect(page.getByTestId('test-server-badge')).toHaveCount(0)

    await expect(page.getByRole('button', { name: /^Run / })).toHaveCount(0)

    // Only the list page's own check; the detail view does not poll the server for a PR with nothing to run.
    await page.waitForTimeout(500)

    expect(calls.testServer).toBe(1)

    expect(calls.run).toHaveLength(0)
  })

  test('should still be approvable and mergeable like any other PR', async ({ page }) => {
    const calls = await mockApi(page, { detail: supportOnly() })

    await openFirstReview(page)

    await expect(mergeButton(page)).toBeDisabled()

    await approveAndConfirm(page)

    await expect(page.getByText('AT-727: 1 commit rebased and merged into playwright-main.')).toBeVisible()

    expect(calls.merge).toHaveLength(1)
  })

  test('should warn when it also changes code that runs inside the test server', async ({ page }) => {
    await mockApi(page, { detail: supportOnly({ serverCodeChanged: ['spec/e2e/app_commands/seed.rb'] }) })

    await openSupportFiles(page)

    await expect(page.getByTestId('server-code-warning')).toContainText('spec/e2e/app_commands/seed.rb')
  })

  test('should show a collapsed support-files note under the specs when a PR has both', async ({ page }) => {
    await mockApi(page, { detail: supportOnly({ specs: [SPEC_A] }) })

    await openFirstReview(page)

    await page.getByRole('tab', { name: /^Specs/ }).click()

    await expect(page.getByTestId('specs-panel')).toBeVisible()

    await expect(page.getByTestId('support-only-panel')).toHaveCount(0)

    const note = page.getByTestId('support-note')

    await expect(note).not.toHaveAttribute('open', '')

    await note.getByText(/This PR also changes 4 support files/).click()

    await expect(note.getByTestId('support-group-cassettes')).toBeVisible()
  })

  test('should have no tab at all when a PR has neither specs nor support files', async ({ page }) => {
    await mockApi(page)

    await openFirstReview(page)

    await expect(page.getByRole('tab', { name: /^Specs|^Support files/ })).toHaveCount(0)
  })

  test('should look right on a phone and in dark mode', async ({ page }) => {
    await mockApi(page, { detail: supportOnly() })

    await page.setViewportSize({ width: 375, height: 800 })

    await page.emulateMedia({ colorScheme: 'dark' })

    await openSupportFiles(page)

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

    expect(overflow).toBe(false)

    await expect(page.getByTestId('support-group-cassettes')).toBeVisible()
  })
})

test.describe('Review - loading placeholders and badges', () => {

  test('should show a loading placeholder while the list loads, then swap it for the table', async ({ page }) => {
    await mockApi(page, { listDelayMs: 1500 })

    await openReviewTab(page)

    const loading = page.getByRole('status').filter({ hasText: 'Fetching from origin and Jira' })

    await expect(loading).toBeVisible()

    // three cards of two placeholder lines each, hidden from screen readers (the status message speaks for them)
    await expect(loading.locator('.animate-pulse')).toHaveCount(6)

    await expect(loading.locator('.animate-pulse[aria-hidden="true"]')).toHaveCount(6)

    await expect(page.getByTestId('review-table')).toBeHidden()

    await expect(page.getByTestId('review-table')).toBeVisible({ timeout: 10_000 })

    await expect(loading).toBeHidden()
  })

  test('should show a loading placeholder naming the ticket while it opens, then swap it for the page', async ({ page }) => {
    await mockApi(page, { detailDelayMs: 1500 })

    await openReviewTab(page)

    await page.getByRole('button', { name: 'Review AT-727' }).click()

    const loading = page.getByTestId('detail-loading')

    await expect(loading).toBeVisible()

    await expect(loading).toHaveAttribute('role', 'status')

    await expect(loading).toContainText('Loading pull request…')

    await expect(loading).toContainText('Reading AT-727 from Jira')

    await expect(loading.locator('.animate-pulse')).toHaveCount(3)

    await expect(page.getByTestId('merge-box')).toBeHidden()

    await expect(page.getByTestId('merge-box')).toBeVisible({ timeout: 10_000 })

    await expect(loading).toBeHidden()
  })

  test('should let you go back while a ticket is still loading', async ({ page }) => {
    await mockApi(page, { detailDelayMs: 1500 })

    await openReviewTab(page)

    await page.getByRole('button', { name: 'Review AT-727' }).click()

    await expect(page.getByTestId('detail-loading')).toBeVisible()

    await page.getByRole('button', { name: /Back to Review/ }).click()

    await expect(page.getByTestId('review-table')).toBeVisible()

    await expect(page.getByTestId('detail-loading')).toBeHidden()
  })

  test('should style each status badge by what it means', async ({ page }) => {
    await mockApi(page)

    await openReviewTab(page)

    // the ticket's Jira status in the table: the quiet "secondary" badge
    const row = page.getByTestId('review-ticket').first()

    await expect(row.locator('div.inline-flex', { hasText: /^Review$/ })).toHaveClass(/bg-secondary/)

    await row.getByRole('button', { name: 'Review AT-727' }).click()

    await expect(page.getByTestId('merge-box')).toBeVisible()

    // clean and ready: outlined in the success colour
    const ready = page.getByText('Ready to merge', { exact: true })

    await expect(ready).toHaveClass(/border-success/)

    await expect(ready).toHaveClass(/text-success/)
  })

  test('should style a conflicting PR in the destructive colour, visibly different from the neutral badges', async ({ page }) => {
    await mockApi(page, { detail: reviewDetail({ canRebase: false, conflicts: ['spec/a.spec.ts'] }) })

    await openFirstReview(page)

    const conflicts = page.getByText('Conflicts', { exact: true })

    await expect(conflicts).toHaveClass(/bg-destructive/)

    // and it is visibly different from the neutral badges (a real colour difference, not just a class name)
    const colours = await page.evaluate(() => {
      const bg = (el: Element | null) => (el ? getComputedStyle(el).backgroundColor : '')

      const all = [...document.querySelectorAll('div.inline-flex')]

      return {
        destructive: bg(all.find(e => e.textContent === 'Conflicts') ?? null),
        neutral: bg(all.find(e => e.className.includes('bg-secondary')) ?? null)
      }
    })

    expect(colours.destructive).not.toBe('')

    expect(colours.destructive).not.toBe(colours.neutral)
  })

  test('should show a neutral "Already merged" badge when playwright-main already has the changes', async ({ page }) => {
    await mockApi(page, { detail: reviewDetail({ unmerged: 0 }) })

    await openFirstReview(page)

    await expect(page.getByText('Already merged', { exact: true })).toHaveClass(/bg-secondary/)
  })

  test('should flag a branch that is behind with a warning badge in the table', async ({ page }) => {
    await mockApi(page, { list: reviewList({ tickets: [ticket({ branches: [branch({ behind: 3 })] })] }) })

    await openReviewTab(page)

    await expect(page.getByText('3 behind — auto-rebased')).toHaveClass(/text-warning/)
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

  test('should refuse a decision for a non-AT branch or a malformed request, before anything runs', async ({ request }) => {
    for (const body of [
      { branch: 'master', expectedSha: 'abcdef1', decision: 'approved' },
      { branch: 'APP-1-x', expectedSha: 'abcdef1', decision: 'approved' },
      { branch: 'AT-12abc', expectedSha: 'abcdef1', decision: 'approved' },
      { branch: 'AT-1-x', decision: 'approved' },
      { branch: 'AT-1-x', expectedSha: 'abcdef1', decision: 'maybe' },
      { branch: 'AT-1-x', expectedSha: 'abcdef1', decision: 'declined' },
      { branch: 'AT-1-x', expectedSha: 'abcdef1', decision: 'approved', info: 'x'.repeat(5001) }
    ]) {
      const response = await request.post(`${BASE_URL}/api/review/decision`, { data: body })

      expect(response.status(), JSON.stringify(body)).toBe(400)
    }
  })

  test('should refuse cross-site and non-JSON decision, run and cancel requests', async ({ request }) => {
    for (const route of ['decision', 'tests/run', 'tests/cancel']) {
      const crossSite = await request.post(`${BASE_URL}/api/review/${route}`, {
        headers: { 'Sec-Fetch-Site': 'cross-site' },
        data: { branch: 'AT-1-x', expectedSha: 'abcdef1' }
      })

      expect(crossSite.status(), route).toBe(403)

      const notJson = await request.post(`${BASE_URL}/api/review/${route}`, { headers: { 'Content-Type': 'text/plain' }, data: '{}' })

      expect(notJson.status(), route).toBe(403)
    }
  })

  test('should refuse to run specs that are not a plain spec file under the e2e folder, or for a non-AT branch', async ({ request }) => {
    const e2e = 'spec/playwright/playwright/e2e'

    for (const data of [
      { branch: 'master', expectedSha: 'abcdef1', specs: 'all' },
      { branch: 'AT-1-x', expectedSha: 'abcdef1', specs: [] },
      { branch: 'AT-1-x', expectedSha: 'abcdef1', specs: ['spec/models/user_spec.rb'] },
      { branch: 'AT-1-x', expectedSha: 'abcdef1', specs: [`${e2e}/../../../etc/passwd.spec.ts`] },
      { branch: 'AT-1-x', expectedSha: 'abcdef1', specs: ['--ui'] },
      { branch: 'AT-1-x', expectedSha: 'abcdef1', specs: `${e2e}/a.spec.ts` },
      { branch: 'AT-1-x', specs: 'all' }
    ]) {
      const response = await request.post(`${BASE_URL}/api/review/tests/run`, { data })

      expect(response.status(), JSON.stringify(data)).toBe(400)
    }
  })

  test('should answer 404 for an unknown spec run and refuse cross-site reads of run output', async ({ request }) => {
    const unknown = await request.get(`${BASE_URL}/api/review/tests/job?id=does-not-exist`)

    expect(unknown.status()).toBe(404)

    const crossSite = await request.get(`${BASE_URL}/api/review/tests/job?id=x`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })

    expect(crossSite.status()).toBe(403)
  })

  test('should report the test server status without starting anything', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/review/tests/status`)

    expect(response.status()).toBe(200)

    const { data } = await response.json()

    expect(data).toMatchObject({ host: '127.0.0.1', startCommand: 'yarn test:server', activeJob: null })

    expect(typeof data.up).toBe('boolean')
  })

  test('should only expose the review routes', async ({ request }) => {
    const unknown = await request.get(`${BASE_URL}/api/review/delete-branch`)

    expect(unknown.status()).toBe(404)

    const wrongVerb = await request.get(`${BASE_URL}/api/review/merge`)

    expect(wrongVerb.status()).toBe(405)
  })
})
