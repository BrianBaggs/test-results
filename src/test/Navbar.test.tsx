import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Navbar } from '../components/Layout/Navbar';

// Mock lucide-react icons (Navbar's own icons + the ones ThemeToggle renders)
vi.mock('lucide-react', () => ({
  BarChartIcon: () => <div data-testid="bar-chart-icon" />,
  FileTextIcon: () => <div data-testid="file-text-icon" />,
  AlertTriangleIcon: () => <div data-testid="alert-triangle-icon" />,
  ListChecksIcon: () => <div data-testid="list-checks-icon" />,
  SendIcon: () => <div data-testid="send-icon" />,
  SplitIcon: () => <div data-testid="split-icon" />,
  BoxesIcon: () => <div data-testid="boxes-icon" />,
  GitPullRequestIcon: () => <div data-testid="git-pull-request-icon" />,
  FlaskConicalIcon: () => <div data-testid="flask-conical-icon" />,
  SunIcon: () => <div data-testid="sun-icon" />,
  MoonIcon: () => <div data-testid="moon-icon" />,
}));

describe('Navbar', () => {
  const mockSetActiveTab = vi.fn();

  beforeEach(() => {
    mockSetActiveTab.mockClear();
  });

  it('should render with the correct title', () => {
    render(<Navbar activeTab="dashboard" setActiveTab={mockSetActiveTab} />);

    expect(screen.getByText('Test Results Platform')).toBeInTheDocument();
  });

  it('should render all navigation tabs', () => {
    render(<Navbar activeTab="dashboard" setActiveTab={mockSetActiveTab} />);

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Failures')).toBeInTheDocument();
    expect(screen.getByText('Progress')).toBeInTheDocument();
    expect(screen.getByText('Report')).toBeInTheDocument();
    expect(screen.getByText('Split')).toBeInTheDocument();
    expect(screen.getByText('Shard')).toBeInTheDocument();
    expect(screen.getByText('Publish')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
  });

  it('should render all icons', () => {
    render(<Navbar activeTab="dashboard" setActiveTab={mockSetActiveTab} />);

    expect(screen.getByTestId('bar-chart-icon')).toBeInTheDocument();
    expect(screen.getByTestId('alert-triangle-icon')).toBeInTheDocument();
    expect(screen.getByTestId('list-checks-icon')).toBeInTheDocument();
    expect(screen.getByTestId('file-text-icon')).toBeInTheDocument();
    expect(screen.getByTestId('split-icon')).toBeInTheDocument();
    expect(screen.getByTestId('boxes-icon')).toBeInTheDocument();
    expect(screen.getByTestId('send-icon')).toBeInTheDocument();
    expect(screen.getByTestId('git-pull-request-icon')).toBeInTheDocument();
  });

  it('should render the theme toggle', () => {
    render(<Navbar activeTab="dashboard" setActiveTab={mockSetActiveTab} />);

    expect(screen.getByRole('button', { name: 'Toggle dark mode' })).toBeInTheDocument();
  });

  it.each(['dashboard', 'failures', 'progress', 'report', 'split', 'shard', 'publish'])(
    'should highlight the active %s tab and leave the others inactive',
    (activeTab) => {
      const labels: Record<string, string> = {
        dashboard: 'Dashboard',
        failures: 'Failures',
        progress: 'Progress',
        report: 'Report',
        split: 'Split',
        shard: 'Shard',
        publish: 'Publish',
      };
      render(<Navbar activeTab={activeTab} setActiveTab={mockSetActiveTab} />);

      const activeButton = screen.getByText(labels[activeTab]).closest('button');
      expect(activeButton).toHaveClass('bg-gradient-to-br', 'from-primary', 'text-primary-foreground');

      Object.entries(labels)
        .filter(([id]) => id !== activeTab)
        .forEach(([, label]) => {
          const inactiveButton = screen.getByText(label).closest('button');
          expect(inactiveButton).toHaveClass('text-muted-foreground');
          expect(inactiveButton).not.toHaveClass('bg-gradient-to-br');
        });
    }
  );

  it('should handle unknown active tab gracefully', () => {
    render(<Navbar activeTab="unknown" setActiveTab={mockSetActiveTab} />);

    // All tabs should be inactive
    const dashboardButton = screen.getByText('Dashboard').closest('button');
    const failuresButton = screen.getByText('Failures').closest('button');

    expect(dashboardButton).toHaveClass('text-muted-foreground');
    expect(failuresButton).toHaveClass('text-muted-foreground');
  });

  it.each([
    ['Dashboard', 'dashboard'],
    ['Failures', 'failures'],
    ['Progress', 'progress'],
    ['Report', 'report'],
    ['Split', 'split'],
    ['Shard', 'shard'],
    ['Publish', 'publish'],
  ])('should call setActiveTab with "%s" tab id when %s button is clicked', (label, id) => {
    render(<Navbar activeTab="dashboard" setActiveTab={mockSetActiveTab} />);

    fireEvent.click(screen.getByText(label));

    expect(mockSetActiveTab).toHaveBeenCalledWith(id);
    expect(mockSetActiveTab).toHaveBeenCalledTimes(1);
  });
});
