import {
  BarChartIcon,
  FileTextIcon,
  AlertTriangleIcon,
  ListChecksIcon,
  SendIcon,
  SplitIcon,
  BoxesIcon,
  FlaskConicalIcon,
  GitPullRequestIcon,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChartIcon },
  { id: 'failures', label: 'Failures', icon: AlertTriangleIcon },
  { id: 'progress', label: 'Progress', icon: ListChecksIcon },
  { id: 'report', label: 'Report', icon: FileTextIcon },
  { id: 'split', label: 'Split', icon: SplitIcon },
  { id: 'shard', label: 'Shard', icon: BoxesIcon },
  { id: 'publish', label: 'Publish', icon: SendIcon },
  { id: 'review', label: 'Review', icon: GitPullRequestIcon },
];

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab }) => {
  return (
    <nav className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/60">
      <div className="container mx-auto px-4 sm:px-6">
        <div className="flex h-[68px] items-center justify-between gap-4">
          <div className="flex shrink-0 items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-indigo-500 text-primary-foreground shadow-md shadow-primary/30">
              <FlaskConicalIcon className="size-5" />
            </div>
            <h1 className="text-lg font-bold tracking-tight whitespace-nowrap">
              Test Results Platform
            </h1>
          </div>

          <div className="flex items-center gap-1 overflow-x-auto rounded-full border border-border/60 bg-muted/40 p-1">
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  aria-label={label}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-all',
                    isActive
                      ? 'bg-gradient-to-br from-primary to-indigo-500 text-primary-foreground shadow-md shadow-primary/30'
                      : 'text-muted-foreground hover:bg-background hover:text-foreground'
                  )}
                >
                  <Icon className="size-4" />
                  <span className="hidden md:inline">{label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex shrink-0 items-center">
            <ThemeToggle />
          </div>
        </div>
      </div>
    </nav>
  );
};
