# Test Results Platform

A React-based web application for analyzing JUnit XML test results with comprehensive testing and CI/CD pipeline.

## Features

- **Dashboard**: Upload a JUnit XML file and view test result summaries with interactive charts
- **Failure Analysis**: Detailed analysis of failed tests with filtering capabilities
- **Progress Tracking**: Track resolution progress for failed tests, add notes/assignees, and view the full stack trace
- **Split & Combine**: Split a run's failures evenly between teammates, then combine each teammate's exported progress back into one report
- **Shard**: Combine the separate JUnit XML reports produced by a sharded Playwright run (e.g. `--shard=1/3`) back into one JUnit XML file
- **Publish**: Send a summary of the loaded results directly to a Slack channel via an Incoming Webhook
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
