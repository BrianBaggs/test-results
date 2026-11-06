import type { GhStatus, ReviewList, ReviewStatus } from '@/types/review';

export type LightState = 'ok' | 'warn' | 'bad' | 'checking';

export interface Light {
  id: 'git' | 'repo' | 'acli' | 'gh';
  label: string;
  state: LightState;
  text: string;
  /** Shown under the bar when the light isn't green. */
  hint?: { message: string; command?: string; url?: string };
}

/**
 * Work out each status light from what the server reported. Pure, so it can be
 * tested without rendering.
 */
export function computeLights(status: ReviewStatus | null, list: ReviewList | null, gh: GhStatus | null, listFailed = false): Light[] {
  const lights: Light[] = [];
  const req = (id: string) => status?.requirements.find((r) => r.id === id);

  const git = req('git');
  lights.push(
    !status
      ? { id: 'git', label: 'Git', state: 'checking', text: 'Checking…' }
      : git?.ok
        ? { id: 'git', label: 'Git', state: 'ok', text: 'Installed' }
        : { id: 'git', label: 'Git', state: 'bad', text: 'Not installed', hint: { message: git?.fix ?? 'Install Git.', command: git?.command, url: git?.url } },
  );

  const repo = req('repo');
  const remote = req('remote');
  const repoBad = repo && !repo.ok ? repo : remote && !remote.ok ? remote : null;
  lights.push(
    !status
      ? { id: 'repo', label: 'securicy-app', state: 'checking', text: 'Checking…' }
      : repoBad
        ? { id: 'repo', label: 'securicy-app', state: 'bad', text: repoBad.id === 'repo' ? 'Not found' : 'No remote', hint: { message: repoBad.fix, command: repoBad.command, url: repoBad.url } }
        : { id: 'repo', label: 'securicy-app', state: 'ok', text: 'Found' },
  );

  {
    const acli = req('acli');
    const jira = list?.jira;
    let light: Light;
    if (!status) light = { id: 'acli', label: 'Atlassian CLI', state: 'checking', text: 'Checking…' };
    else if (acli && !acli.ok)
      light = { id: 'acli', label: 'Atlassian CLI', state: 'bad', text: 'Not installed', hint: { message: acli.fix, command: acli.command, url: acli.url } };
    else if (!list && listFailed) light = { id: 'acli', label: 'Atlassian CLI', state: 'warn', text: 'Not checked' };
    else if (!list) light = { id: 'acli', label: 'Atlassian CLI', state: 'checking', text: 'Checking sign-in…' };
    else if (jira?.errorKind === 'not-authenticated')
      light = { id: 'acli', label: 'Atlassian CLI', state: 'bad', text: 'Not signed in', hint: { message: "acli isn't signed in to Jira.", command: 'acli auth login' } };
    else if (jira?.errorKind === 'not-installed')
      light = { id: 'acli', label: 'Atlassian CLI', state: 'bad', text: 'Not installed', hint: { message: jira.error ?? 'Install the Atlassian CLI.' } };
    else if (jira?.error) light = { id: 'acli', label: 'Atlassian CLI', state: 'warn', text: 'Error', hint: { message: jira.error } };
    else light = { id: 'acli', label: 'Atlassian CLI', state: 'ok', text: 'Signed in' };
    lights.push(light);
  }

  // gh is informational: reviewing and merging use plain git, so a missing or
  // signed-out gh never blocks the page.
  if (!gh) lights.push({ id: 'gh', label: 'GitHub CLI', state: 'checking', text: 'Checking…' });
  else if (gh.state === 'ready') lights.push({ id: 'gh', label: 'GitHub CLI', state: 'ok', text: gh.account ? `Signed in as ${gh.account}` : 'Signed in' });
  else
    lights.push({
      id: 'gh',
      label: 'GitHub CLI',
      state: 'warn',
      text: gh.state === 'not-installed' ? 'Not installed' : gh.state === 'not-authenticated' ? 'Not signed in' : 'Error',
      hint: { message: gh.detail, command: gh.command, url: gh.url },
    });

  return lights;
}

