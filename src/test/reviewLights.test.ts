import { describe, it, expect } from 'vitest';
import { computeLights } from '../utils/reviewLights';
import { gh, list, status, testServer } from './reviewFixtures';
import type { ReviewStatus } from '../types/review';

const light = (lights: ReturnType<typeof computeLights>, id: string) => lights.find((l) => l.id === id)!;
const withReq = (id: string, over: object): ReviewStatus => {
  const s = status();
  return { ...s, ok: false, requirements: s.requirements.map((r) => (r.id === id ? { ...r, ok: false, fix: `fix ${id}`, command: `cmd ${id}`, url: `https://x/${id}`, ...over } : r)) };
};

describe('computeLights', () => {
  it('shows five lights, all green, when everything is ready', () => {
    const lights = computeLights(status(), list(), gh(), false, testServer());
    expect(lights.map((l) => [l.id, l.state])).toEqual([
      ['git', 'ok'],
      ['repo', 'ok'],
      ['acli', 'ok'],
      ['gh', 'ok'],
      ['test', 'ok'],
    ]);
    expect(light(lights, 'test').text).toBe('Running on :5017');
    expect(light(lights, 'acli').text).toBe('Signed in');
    expect(light(lights, 'gh').text).toBe('Signed in as BrianBaggs');
    expect(lights.every((l) => !l.hint)).toBe(true);
  });

  it('shows everything as checking before anything has loaded', () => {
    const lights = computeLights(null, null, null);
    expect(lights.map((l) => l.state)).toEqual(['checking', 'checking', 'checking', 'checking', 'checking']);
  });

  it('keeps acli checking until the Review column has been read (that is the sign-in test)', () => {
    expect(light(computeLights(status(), null, gh()), 'acli')).toMatchObject({ state: 'checking', text: 'Checking sign-in…' });
  });

  it('marks acli as not checked when the list failed to load', () => {
    expect(light(computeLights(status(), null, gh(), true), 'acli')).toMatchObject({ state: 'warn', text: 'Not checked' });
  });

  it('git not installed: red with install command and link', () => {
    const l = light(computeLights(withReq('git', { label: 'Git' }), null, gh()), 'git');
    expect(l).toMatchObject({ state: 'bad', text: 'Not installed', hint: { message: 'fix git', command: 'cmd git', url: 'https://x/git' } });
  });

  it('git requirement without details still gives a hint', () => {
    const s = status();
    s.requirements = s.requirements.filter((r) => r.id !== 'git');
    expect(light(computeLights(s, null, gh()), 'git')).toMatchObject({ state: 'bad', hint: { message: 'Install Git.' } });
  });

  it('repo missing is red "Not found"; missing remote is red "No remote"', () => {
    expect(light(computeLights(withReq('repo', {}), null, gh()), 'repo')).toMatchObject({ state: 'bad', text: 'Not found', hint: { command: 'cmd repo' } });
    expect(light(computeLights(withReq('remote', {}), null, gh()), 'repo')).toMatchObject({ state: 'bad', text: 'No remote' });
  });

  it('acli not installed: red with install command', () => {
    expect(light(computeLights(withReq('acli', {}), null, gh()), 'acli')).toMatchObject({ state: 'bad', text: 'Not installed', hint: { command: 'cmd acli' } });
  });

  it('acli not signed in: red with the login command', () => {
    const l = light(computeLights(status(), list({ jira: { error: "acli isn't logged in", errorKind: 'not-authenticated' } }), gh()), 'acli');
    expect(l).toMatchObject({ state: 'bad', text: 'Not signed in', hint: { command: 'acli auth login' } });
  });

  it('acli missing at runtime and other failures', () => {
    expect(light(computeLights(status(), list({ jira: { error: 'not found', errorKind: 'not-installed' } }), gh()), 'acli')).toMatchObject({ state: 'bad', text: 'Not installed' });
    expect(light(computeLights(status(), list({ jira: { error: 'search failed', errorKind: 'failed' } }), gh()), 'acli')).toMatchObject({ state: 'warn', text: 'Error', hint: { message: 'search failed' } });
  });

  it('gh is informational: missing or signed out is amber, never red', () => {
    const missing = light(computeLights(status(), list(), gh({ state: 'not-installed', account: null, detail: "gh isn't installed.", command: 'brew install gh', url: 'https://cli.github.com' })), 'gh');
    expect(missing).toMatchObject({ state: 'warn', text: 'Not installed', hint: { command: 'brew install gh' } });
    const out = light(computeLights(status(), list(), gh({ state: 'not-authenticated', account: null, command: 'gh auth login' })), 'gh');
    expect(out).toMatchObject({ state: 'warn', text: 'Not signed in', hint: { command: 'gh auth login' } });
    expect(light(computeLights(status(), list(), gh({ state: 'error', account: null })), 'gh')).toMatchObject({ state: 'warn', text: 'Error' });
  });

  it('test server down: red, with how to start it (the app never starts it)', () => {
    const l = light(computeLights(status(), list(), gh(), false, testServer({ up: false })), 'test');
    expect(l).toMatchObject({ state: 'bad', text: 'Not running', hint: { command: 'yarn test:server' } });
    expect(l.hint?.message).toMatch(/never starts it/);
  });

  it('test server still being checked is grey, and uses the reported port', () => {
    expect(light(computeLights(status(), list(), gh(), false, null), 'test').state).toBe('checking');
    expect(light(computeLights(status(), list(), gh(), false, testServer({ port: 6000 })), 'test').text).toBe('Running on :6000');
  });

  it('gh signed in without a known account', () => {
    expect(light(computeLights(status(), list(), gh({ account: null })), 'gh').text).toBe('Signed in');
  });
});
