# Test Results Platform

A React-based web application for analyzing JUnit XML test results with comprehensive testing and CI/CD pipeline.

## Features

- **Dashboard**: Upload a JUnit XML file and view test result summaries with interactive charts
- **Failure Analysis**: Detailed analysis of failed tests with filtering capabilities
- **Progress Tracking**: Track resolution progress for failed tests, add notes/assignees, and view the full stack trace
- **Split & Combine**: Split a run's failures evenly between teammates, then combine each teammate's exported progress back into one report
- **Shard**: Combine the separate JUnit XML reports produced by a sharded Playwright run (e.g. `--shard=1/3`) back into one JUnit XML file
- **Publish**: Send a summary of the loaded results directly to a Slack channel via an Incoming Webhook
- **Review**: A local, GitHub-style review of the AT tickets in the Jira Review column — read the diff, approve, then rebase and merge into `playwright-main` (see [Review tab](#review-tab))
- **Report Generation**: Generate and preview PDF reports from test data
- **Light/Dark Mode**: Toggle between light and dark themes, persisted across sessions
- **Comprehensive Testing**: Vitest for unit/component tests, Playwright for e2e

## Getting Started

### Prerequisites
- Node.js 22.x or later (CI runs against 22.x, 24.x, and 26.x)
- npm

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   npm fund
   ```

3. (Optional) Configure the Publish tab by copying `.env.example` to `.env` and
   setting `SLACK_WEBHOOK_URL` to a Slack Incoming Webhook URL — see
   [Configuration](#configuration) below.

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:5173](http://localhost:5173) in your browser

## Configuration

The **Publish** tab posts a summary of the loaded test results directly to a
Slack channel using a [Slack Incoming Webhook](https://api.slack.com/messaging/webhooks) —
no third-party test-result publishing service required.

1. Create an Incoming Webhook for the Slack channel you want to publish to.
2. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
3. Set `SLACK_WEBHOOK_URL` in `.env` to the webhook URL.
4. Restart `npm run dev` if it's already running — the dev server only reads
   `.env` on startup.

`.env` is gitignored since the webhook URL should be treated as a secret; only
`.env.example` (with a placeholder value) is committed. If `SLACK_WEBHOOK_URL`
isn't set, the Publish tab will show a clear error explaining how to configure
it when you try to publish.

Optionally, set `VITE_EXECUTED_BY` in `.env` to your name to pre-fill the
"Executed By" metadata row on the Publish page (key and value together) so
you don't have to retype it every time. It needs the `VITE_` prefix since,
unlike `SLACK_WEBHOOK_URL`, it's read in the browser rather than the dev
server. The first metadata row's key is always pre-filled with "Failed
Tests" — its value is left for you to fill in by hand, since the parsed
XML's failure count includes flaky-test retries and would overstate the
real number.

The published message includes a small pass/fail/skipped proportion bar rendered by
[QuickChart](https://quickchart.io), a free hosted chart-image API — Slack
images must be fetched from a public URL, and this app has no backend of its
own to host a generated image, so the pass/fail/skipped counts are sent to
QuickChart's public endpoint to get one back. No test names, file paths, or
failure details are included in that request — only the three counts.

## Review tab

QA can't open GitHub pull requests for AT tickets (that would run the whole
automated suite), so the **Review** tab gives the team a PR-style flow using
the command-line tools already installed and signed in on your machine. There
is no database — the only state is per-session UI progress (which files you
viewed, whether you approved) kept in the browser's `sessionStorage`.

**The flow**

1. Open **Review**. Every ticket in the AT board's **Review** column is listed
   in a table with its branch, author, commits and a `git diff --stat` summary.
2. Click one to open its page: conversation, commits, and a split/unified diff
   with syntax highlighting, a file index, and a "Viewed" checkbox per file.
3. **Approve** the changes, then **Rebase and merge**. The branch is rebased on
   the latest `playwright-main` (no manual rebasing), fast-forwarded into
   `playwright-main`, the `AT-###` branch is deleted, and the ticket is moved to
   Done. It then disappears from the list.

The rebase happens in a throw-away git worktree, so your own checkout (branch
and uncommitted work) is never touched. Merges are always **into
`playwright-main`**, which is not configurable.

**Requirements** — the page checks these and shows a status light for each
(green = ready), with the exact install command for anything missing:

| Tool | Why | Install / sign in |
| --- | --- | --- |
| Git | fetch, rebase, merge | `brew install git` |
| Atlassian CLI (`acli`) | read the Review column, move tickets to Done | `brew tap atlassian/homebrew-acli && brew install acli`, then `acli auth login` |
| A `securicy-app` clone | the repository being reviewed | `git clone git@github.com:carbidesecure/securicy-app.git ~/Dev/securicy-app` |
| GitHub CLI (`gh`) — optional | informational light only; shows whether `gh` is signed in | `brew install gh`, then `gh auth login` |

Optional `.env` settings (see `.env.example`): `REVIEW_REPO_PATH` (default
`~/Dev/securicy-app`), `JIRA_REVIEW_STATUS` (default `Review`) and
`JIRA_DONE_STATUS` (`Done` or `Completed`). Restart `npm run dev` after
changing `.env`. The Review tab only works under `npm run dev` (it runs the
commands in the dev server), not in a static build.

**Guard rails** — these are deliberately strict and enforced in code at the
point each command line is built (`server/gitGuard.ts`, `server/acli.ts`,
`server/ghStatus.ts`), with tests that try to break them:

- **Jira (`acli`)**: only the **AT** project, and only two things: read the
  tickets in the Review column, and move a ticket that is *in* Review to
  Done/Completed after its branch has been merged. Only tickets that are in the
  Review column are ever shown, reviewable or mergeable.
- **git**: only check out (into a temp worktree), rebase, and merge
  (a plain fast-forward push to `playwright-main`) — plus read-only commands to
  look at branches and `fetch`. Only branches named exactly `AT-###` /
  `AT-###-…` (case-sensitive) can be acted on, and **only** such a branch can be
  deleted, and only after it was merged and only if origin still has the exact
  commit that was reviewed. No force pushes, no resets, nothing else.
- **gh**: the only command that can ever run is `gh auth status` (read-only).
- The HTTP endpoints accept only same-origin JSON requests to localhost.

### Review tab security notes

The Review endpoints run `git` and can push to a shared branch, so they are
locked down beyond the command guard rails above:

- **Local only.** Requests must be addressed to `localhost`/`127.0.0.1`/`::1`
  (defeats DNS rebinding), must carry `Sec-Fetch-Site: same-origin` (or none),
  and `POST`s must be same-origin JSON. If the dev server is started with
  `--host` (reachable from the network) the Review API refuses to exist.
- **No clickjacking / sniffing.** Every dev-server response sends
  `frame-ancestors 'self'`, `X-Frame-Options`, `nosniff` and `no-referrer`; API
  responses are `same-origin` only and never cached.
- **Explicit approval.** A merge request is rejected unless it carries
  `approved: true` (sent only after you press Approve), names the exact commit
  you reviewed (`expectedSha`), and the ticket is still in the Review column.
  Request bodies are capped at 64 KB.
- **Untrusted content.** Diffs, commit messages and ticket titles come from
  other people. React escapes all text, the diff viewer escapes each line
  (regression-tested with hostile payloads in unit and real-browser tests), and
  only `http(s)` links are ever rendered as links. The app never runs code from
  a branch (no install, build or test commands) and git is run with
  `--no-ext-diff --no-textconv`.
- **Bounded work.** Commands use `execFile` (no shell), have timeouts and
  buffer limits, one merge runs at a time, and a review response is capped at
  5 MB of diff.
- **Dependencies.** The one new library, `@git-diff-view/react`, is pinned to an
  exact version, has no install scripts, and `npm audit` reports 0 production
  vulnerabilities.

Residual risks you should know about: the API is unauthenticated, so any
process on your machine that can reach the dev server can use it while it is
running (that is inherent to local dev servers; it is why it is loopback-only);
git hooks in your `securicy-app` checkout, if you add any, will run during the
rebase and push; and the app complements rather than replaces branch
protection — consider enabling GitHub branch protection on `playwright-main`
(require linear history) so the server enforces the same rule.

## Available Scripts

### Development
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

### Code Quality
- `npm run lint` - Run ESLint
- `npm run lintfix` - Fix ESLint issues automatically
- `npx tsc` - Run typescript checks

### Testing
- `npm test` - Run tests in watch mode
- `npm run test:watch` - Alias for watch mode
- `npm run test:coverage` - Run tests once with a coverage report
- `npm run test:ui` - Run tests with the Vitest UI interface
- `npm run test:e2e` - Run e2e tests with Playwright
- `npm run test:e2e:ui` - Open the Playwright UI
- `npm run test:e2e:coverage` - Run Playwright e2e tests and report their code coverage (nyc)
- `npm run test:ci` - Run Playwright e2e tests (single worker, retries) and report coverage — used in CI

## Testing

This project has comprehensive test coverage with:

- **848 Vitest tests** covering unit, component, hook, and Slack-publishing functionality
- **70 Playwright end-to-end tests** covering upload, filtering, search, split/combine, sharded-run combining, bulk actions, report generation, and publishing flows
- **Vitest** testing framework (v8 coverage provider) with React Testing Library
- **Playwright** e2e testing with istanbul/nyc coverage reporting

Current coverage (all four metrics enforced above 90% in CI):

| Metric     | Coverage | Enforced minimum |
|------------|---------:|------------------:|
| Statements |   ~96%   | 93% |
| Branches   |   ~92%   | 90% |
| Functions  |   ~95%   | 92% |
| Lines      |   ~97%   | 95% |

Vendored shadcn/ui primitives under `src/components/ui/` are excluded from coverage (generated boilerplate, not hand-written logic). A handful of files with heavier branch counts — notably `ReportPreview.tsx` and `pdfGenerator.ts` — sit below the global average due to PDF-rendering edge cases that are impractical to exercise in jsdom; they're covered end-to-end instead via the Playwright report-generation spec.

### Test Categories

1. **Unit Tests**: Utility functions (xmlParser, parseTestPath, formatting, splitJUnitXml, mergeJUnitXml, combineResults, exportBundle, testIdentity)
2. **Component Tests**: React components with mocked dependencies
3. **Integration Tests**: Component interactions and data flow
4. **End-to-End Tests**: Full Playwright coverage of every tab and modal

### Running Tests

```bash
# Run all tests without coverage
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in UI mode
npm run test:ui

# Run specific test file
npm test -- --run src/test/App.test.tsx

# Run playwright e2e tests
npm run test:e2e

# Run playwright e2e tests with coverage (as run in CI)
npm run test:ci
```

## CI/CD Pipeline

The project includes a GitHub Actions workflow (`.github/workflows/main.yml`) that:

- Runs on Node.js 22.x, 24.x, and 26.x
- Executes linting and TypeScript checks on every matrix version
- Runs the Vitest suite with coverage on every matrix version
- Installs Playwright and runs the e2e suite with coverage on Node 22.x
- Builds the application

## Project Structure

```
src/
├── components/
│   ├── Dashboard/          # File upload, metrics, results table, test details modal
│   ├── FailureAnalysis/    # Failure list, resolution progress tracking, bulk actions
│   ├── Layout/             # Navbar and app shell
│   ├── Publish/            # Publish results directly to Slack via Incoming Webhook
│   ├── ReportGenerator/    # PDF report configuration, preview, and generation
│   ├── Split/              # Split failures between teammates and combine results back
│   ├── Shard/              # Combine sharded Playwright runs' JUnit XML reports into one
│   ├── shared/             # Cross-tab primitives (StatusBadge, Pagination, EmptyState,
│   │                       #   FileDropZone, ConfirmDialog, FloatingScrollbar)
│   ├── theme/              # Light/dark ThemeProvider and toggle
│   └── ui/                 # shadcn/ui primitives (generated, not hand-maintained)
├── hooks/                  # Shared React hooks
├── utils/                  # Parsing, formatting, split/combine, and export utilities
└── test/                   # Vitest test files and environment setup (setup.ts)

spec/
├── e2e/                    # Playwright end-to-end specs
└── testfiles/              # Sample JUnit XML fixtures used by tests

server/
├── publishPlugin.ts        # Vite dev-server middleware backing /api/publish
└── slackMessage.ts         # Builds the Slack Block Kit message from test data
```

## Technology Stack

- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS v4** - Styling, with CSS-variable-based light/dark theming
- **shadcn/ui (Radix primitives)** - Accessible component foundation
- **Vitest** - Testing framework
- **React Testing Library** - Component testing
- **Playwright** - End-to-End testing
- **Recharts** - Data visualization
- **jsPDF / html2canvas** - PDF generation
- **@slack/webhook** - Publishes test result summaries to Slack

## Contributing

1. Ensure all tests pass: `npm test` and `npm run test:e2e`
2. Keep coverage above the thresholds configured in `vitest.config.ts` (currently 90%+ branches, 92%+ functions, 93%+ statements, 95%+ lines)
3. Follow existing code style (no semicolons in Playwright specs; run `npm run lint` and `npx tsc` before committing)
4. Add tests for new features
5. Update documentation as needed

## License

This code was generated by [Magic Patterns](https://magicpatterns.com). This code has been heavily improved and altered by Brian Baggs with the help of Co-Pilot. 
