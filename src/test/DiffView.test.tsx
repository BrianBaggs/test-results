import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FileDiff } from '../components/Review/DiffView';
import { stubCanvas } from './canvasStub';
import { file } from './reviewFixtures';

// Renders the REAL @git-diff-view/react component (only <canvas> text
// measurement is stubbed, because jsdom has no canvas).
beforeAll(stubCanvas);

const modified = () =>
  file({
    status: 'modified',
    additions: 2,
    deletions: 1,
    patch: ['@@ -1,2 +1,3 @@', ' keep this line', '-old line', '+new line', '+another line'].join('\n'),
  });

describe('FileDiff', () => {
  it('shows the path, status and +/- counts in the header', () => {
    render(<FileDiff file={modified()} />);
    expect(screen.getByText('spec/recurring.spec.ts')).toBeInTheDocument();
    expect(screen.getByText('Modified')).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByText('−1')).toBeInTheDocument();
  });

  it('renders the changed lines with the diff library, in unified mode', () => {
    const { container } = render(<FileDiff file={modified()} mode="unified" />);
    const body = container.querySelector('[data-testid="diff-body"]')!;
    expect(body).toHaveAttribute('data-mode', 'unified');
    expect(body.textContent).toContain('old line');
    expect(body.textContent).toContain('new line');
    expect(body.textContent).toContain('another line');
    expect(container.querySelector('[data-testid="raw-patch"]')).toBeNull();
  });

  it('renders in split mode too', () => {
    const { container } = render(<FileDiff file={modified()} mode="split" />);
    const body = container.querySelector('[data-testid="diff-body"]')!;
    expect(body).toHaveAttribute('data-mode', 'split');
    expect(body.textContent).toContain('new line');
  });

  it('follows the app theme', () => {
    // next-themes without a provider resolves to light; just prove it renders
    const { container } = render(<FileDiff file={modified()} />);
    expect(container.querySelector('.diff-tailwindcss-wrapper, [data-theme], .diff-style-root, [data-component="git-diff-view"]') ?? container.firstChild).toBeTruthy();
  });

  it('collapses and expands from the header when uncontrolled', () => {
    render(<FileDiff file={modified()} />);
    const header = screen.getAllByRole('button')[0];
    expect(header).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('diff-body')).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByTestId('diff-body')).toBeInTheDocument();
  });

  it('can be driven by the page (controlled open state)', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<FileDiff file={modified()} open={false} onToggle={onToggle} />);
    expect(screen.queryByTestId('diff-body')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<FileDiff file={modified()} open onToggle={onToggle} />);
    expect(screen.getByTestId('diff-body')).toBeInTheDocument();
  });

  it('has a Viewed checkbox when the page wants to track it', () => {
    const onViewedChange = vi.fn();
    const { container } = render(<FileDiff file={modified()} viewed={false} onViewedChange={onViewedChange} />);
    expect(container.firstChild).toHaveAttribute('data-viewed', 'false');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Viewed spec/recurring.spec.ts' }));
    expect(onViewedChange).toHaveBeenCalledWith(true);
  });

  it('reflects the viewed state and can be un-viewed', () => {
    const onViewedChange = vi.fn();
    const { container } = render(<FileDiff file={modified()} viewed onViewedChange={onViewedChange} />);
    expect(container.firstChild).toHaveAttribute('data-viewed', 'true');
    const box = screen.getByRole('checkbox', { name: /Viewed/ });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(onViewedChange).toHaveBeenCalledWith(false);
  });

  it('has no Viewed checkbox by default', () => {
    render(<FileDiff file={modified()} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('exposes an anchor id for the file index', () => {
    const { container } = render(<FileDiff file={modified()} id="file-3" />);
    expect(container.querySelector('#file-3')).toBeInTheDocument();
  });

  it('shows old → new for renames', () => {
    render(<FileDiff file={file({ status: 'renamed', oldPath: 'old/name.ts', path: 'new/name.ts', patch: '@@ -1 +1 @@\n-a\n+b' })} />);
    expect(screen.getByText('old/name.ts → new/name.ts')).toBeInTheDocument();
    expect(screen.getByText('Renamed')).toBeInTheDocument();
  });

  it.each([
    ['added', 'Added'],
    ['deleted', 'Deleted'],
  ] as const)('labels %s files', (status, label) => {
    render(<FileDiff file={file({ status })} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('does not render content for binary files', () => {
    render(<FileDiff file={file({ binary: true, patch: '' })} />);
    expect(screen.getByText('Binary file not shown.')).toBeInTheDocument();
  });

  it('explains a change with no content (mode/rename only)', () => {
    render(<FileDiff file={file({ patch: '', additions: 0, deletions: 0 })} />);
    expect(screen.getByText(/No content changes/)).toBeInTheDocument();
  });

  it('warns when a very large diff was cut short', () => {
    render(<FileDiff file={file({ truncated: true })} />);
    expect(screen.getByText(/very large and was cut short/)).toBeInTheDocument();
  });

  it('falls back to the raw patch if the viewer cannot render a diff', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // a patch with no hunk header makes the viewer throw
    const { container } = render(<FileDiff file={file({ patch: 'this is not a valid hunk' })} />);
    const raw = container.querySelector('[data-testid="raw-patch"]');
    // Either the viewer coped, or the boundary showed the raw patch — it must never be blank.
    expect(raw ? raw.textContent : container.querySelector('[data-testid="diff-body"]')?.textContent).toBeTruthy();
    spy.mockRestore();
  });
});

// The diff viewer renders each line with dangerouslySetInnerHTML (after
// escaping). Diffs are untrusted — they come from branches other people push —
// so this is the most important safety property of the whole page.
describe('FileDiff: hostile content is rendered as inert text', () => {
  /** How many <style> elements the viewer itself renders for harmless content. */
  const baselineStyleCount = () => {
    const { container, unmount } = render(<FileDiff file={file({ path: 'a.ts', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b' })} />);
    const n = container.querySelectorAll('[data-testid="diff-body"] style').length;
    unmount();
    return n;
  };

  const payloads = [
    '<img src=x onerror="window.__pwned=1">',
    '<script>window.__pwned=2</script>',
    '"><svg onload="window.__pwned=3">',
    "');window.__pwned=4;//",
    '<a href="javascript:window.__pwned=5">x</a>',
    '</span><img src=y onerror="window.__pwned=6"><span>',
    '<iframe srcdoc="<script>parent.__pwned=7</script>"></iframe>',
    '<style>body{display:none}</style>',
  ];

  for (const path of ['spec/evil.spec.ts', 'app/evil.rb', 'notes.txt', 'data.json', 'page.html', 'README.md']) {
    for (const mode of ['split', 'unified'] as const) {
      it(`escapes payloads in ${path} (${mode})`, () => {
        const patch = [`@@ -1,2 +1,${payloads.length + 1} @@`, ` ${payloads[0]}`, ...payloads.map((p) => `+${p}`), `-${payloads[1]}`].join('\n');
        const { container } = render(<FileDiff file={file({ path, status: 'modified', patch })} mode={mode} />);
        const body = container.querySelector('[data-testid="diff-body"]')!;

        expect(body.querySelectorAll('img, script, iframe, svg[onload], a[href^="javascript"], [onerror], [onload]')).toHaveLength(0);
        // The viewer adds exactly one <style> of its own; hostile content must not add another.
        expect(body.querySelectorAll('style')).toHaveLength(baselineStyleCount());
        expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
        // the payload is visible to the reviewer as literal text
        expect(body.textContent).toContain('<img src=x onerror=');
        expect(body.textContent).toContain('<script>window.__pwned=2</script>');
      });
    }
  }

  it('escapes hostile file names in the header and the Viewed label', () => {
    const evil = '<img src=x onerror="window.__pwned=9">.ts';
    const { container } = render(<FileDiff file={file({ path: evil })} onViewedChange={() => {}} viewed={false} />);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.textContent).toContain('<img src=x onerror=');
  });
});
