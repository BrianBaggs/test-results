import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { toast } from 'sonner';
import { StatusBar } from '../components/Review/StatusBar';
import { SetupPanel } from '../components/Review/SetupPanel';
import { CopyCommand } from '../components/Review/CopyCommand';
import { computeLights } from '../utils/reviewLights';
import { gh, list, status } from './reviewFixtures';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const writeText = vi.fn();
Object.assign(navigator, { clipboard: { writeText } });

describe('StatusBar', () => {
  it('shows a green light for every ready tool, with no hints', () => {
    render(<StatusBar lights={computeLights(status(), list(), gh())} />);

    for (const id of ['git', 'repo', 'acli', 'gh']) {
      expect(screen.getByTestId(`light-${id}`)).toHaveAttribute('data-state', 'ok');
    }
    expect(screen.getByTestId('light-acli')).toHaveTextContent('Atlassian CLI');
    expect(screen.getByTestId('light-acli')).toHaveTextContent('Signed in');
    expect(screen.getByTestId('light-gh')).toHaveTextContent('Signed in as BrianBaggs');
    expect(screen.queryByTestId('status-hints')).not.toBeInTheDocument();
  });

  it('gives each light a screen-reader state, not just a colour', () => {
    render(<StatusBar lights={computeLights(status(), list(), gh())} />);
    expect(within(screen.getByTestId('light-acli')).getByText('Ready')).toHaveClass('sr-only');
  });

  it('pulses grey while checking', () => {
    render(<StatusBar lights={computeLights(null, null, null)} />);
    expect(screen.getByTestId('light-git')).toHaveAttribute('data-state', 'checking');
    expect(screen.getByTestId('light-git').querySelector('span[aria-hidden="true"]')).toHaveClass('animate-pulse');
  });

  it('shows red lights with the fix, a copyable command and an install guide', () => {
    const s = status();
    s.ok = false;
    s.requirements = s.requirements.map((r) => (r.id === 'acli' ? { ...r, ok: false, fix: 'Install the Atlassian CLI.', command: 'brew install acli', url: 'https://developer.atlassian.com/x' } : r));
    render(<StatusBar lights={computeLights(s, null, gh())} />);

    expect(screen.getByTestId('light-acli')).toHaveAttribute('data-state', 'bad');
    const hints = screen.getByTestId('status-hints');
    expect(hints).toHaveTextContent('Install the Atlassian CLI.');
    expect(within(hints).getByText('brew install acli')).toBeInTheDocument();
    expect(within(hints).getByRole('link', { name: /Install guide/ })).toHaveAttribute('href', 'https://developer.atlassian.com/x');
  });

  it('shows amber for a gh that is not signed in, with the login command', () => {
    render(<StatusBar lights={computeLights(status(), list(), gh({ state: 'not-authenticated', account: null, detail: "The GitHub CLI isn't signed in.", command: 'gh auth login' }))} />);
    expect(screen.getByTestId('light-gh')).toHaveAttribute('data-state', 'warn');
    expect(within(screen.getByTestId('status-hints')).getByText('gh auth login')).toBeInTheDocument();
  });

  it('shows acli not signed in as red with its login command', () => {
    render(<StatusBar lights={computeLights(status(), list({ jira: { error: "acli isn't logged in", errorKind: 'not-authenticated' } }), gh())} />);
    expect(screen.getByTestId('light-acli')).toHaveAttribute('data-state', 'bad');
    expect(within(screen.getByTestId('status-hints')).getByText('acli auth login')).toBeInTheDocument();
  });
});

describe('CopyCommand', () => {
  it('copies the command and confirms', async () => {
    writeText.mockResolvedValue(undefined);
    render(<CopyCommand command="brew install gh" label="Copy gh command" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy gh command' }));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Command copied.'));
    expect(writeText).toHaveBeenCalledWith('brew install gh');
  });

  it('tells the user when copying is not possible', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    render(<CopyCommand command="x" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('copy it manually')));
  });
});

describe('SetupPanel', () => {
  const missing = () => {
    const s = status();
    s.ok = false;
    s.requirements = [
      { id: 'git', label: 'Git', ok: false, fix: "Git isn't installed.", command: 'brew install git', url: 'https://git-scm.com/downloads' },
      { id: 'acli', label: 'Atlassian CLI (acli)', ok: true, fix: '' },
      { id: 'repo', label: 'securicy-app checkout', ok: false, fix: 'No git repository was found at /x.', command: 'git clone git@github.com:carbidesecure/securicy-app.git /x' },
    ];
    return s;
  };

  it('tells the user what to install first, with commands', () => {
    render(<SetupPanel status={missing()} checking={false} onCheckAgain={() => {}} />);

    expect(screen.getByRole('region', { name: 'Setup needed' })).toBeInTheDocument();
    expect(screen.getByText('Install these first')).toBeInTheDocument();
    expect(screen.getByTestId('requirement-git')).toHaveAttribute('data-ok', 'false');
    expect(within(screen.getByTestId('requirement-git')).getByText('brew install git')).toBeInTheDocument();
    expect(within(screen.getByTestId('requirement-git')).getByRole('link', { name: /Install guide/ })).toHaveAttribute('href', 'https://git-scm.com/downloads');
    expect(within(screen.getByTestId('requirement-repo')).getByText(/git clone git@github.com:carbidesecure\/securicy-app.git/)).toBeInTheDocument();
  });

  it('marks what is already installed as ready, without instructions', () => {
    render(<SetupPanel status={missing()} checking={false} onCheckAgain={() => {}} />);
    const ok = screen.getByTestId('requirement-acli');
    expect(ok).toHaveAttribute('data-ok', 'true');
    expect(ok).toHaveTextContent('ready');
    expect(within(ok).queryByRole('button')).not.toBeInTheDocument();
  });

  it('checks again on demand and disables the button while checking', () => {
    const onCheckAgain = vi.fn();
    const { rerender } = render(<SetupPanel status={missing()} checking={false} onCheckAgain={onCheckAgain} />);
    fireEvent.click(screen.getByRole('button', { name: /Check again/ }));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
    rerender(<SetupPanel status={missing()} checking onCheckAgain={onCheckAgain} />);
    expect(screen.getByRole('button', { name: /Check again/ })).toBeDisabled();
  });
});

describe('install-guide links are only ever http(s)', () => {
  it('StatusBar and SetupPanel drop a javascript: guide link', () => {
    const s = status();
    s.ok = false;
    s.requirements = s.requirements.map((r) => (r.id === 'git' ? { ...r, ok: false, fix: 'x', command: 'brew install git', url: 'javascript:alert(1)' } : r));
    const { container } = render(
      <>
        <StatusBar lights={computeLights(s, null, gh())} />
        <SetupPanel status={s} checking={false} onCheckAgain={() => {}} />
      </>,
    );
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(screen.queryByRole('link', { name: /Install guide/ })).not.toBeInTheDocument();
  });
});
