import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// This repo is private today, but credentials must never be committed to it.
// This test scans every tracked and new (not ignored) file for credential
// shapes, and checks that the places secrets belong (.env) can't be committed.
// There is deliberately no allowlist: build fake values at runtime in tests.

const ROOT = join(__dirname, '..');

export const SECRET_PATTERNS: Record<string, RegExp> = {
  'GitHub token': /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}/,
  'Slack token': /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  'Slack webhook URL': /hooks\.slack\.com\/services\/[A-Za-z0-9]{6,}\/[A-Za-z0-9]{6,}\/[A-Za-z0-9]{12,}/,
  'Atlassian API token': /\bATATT[A-Za-z0-9_=-]{20,}/,
  'AWS access key id': /\bAKIA[0-9A-Z]{16}\b/,
  'API key (sk-…)': /\bsk-[A-Za-z0-9]{20,}/,
  'JWT': /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/,
  'private key block': /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  'Bearer/Basic credential': /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{24,}/,
  'URL with embedded credentials': /\bhttps?:\/\/[^\s/@:'"`]+:[^\s/@'"`]{3,}@[A-Za-z0-9.-]+/,
  'hard-coded secret assignment': /\b(?:api[_-]?token|api[_-]?key|secret|passw(?:or)?d|private[_-]?key)["']?\s*[:=]\s*["'][^"'$\s{}<>[]{8,}["']/i,
};

const trackedAndNew = (): string[] =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

export function findSecrets(text: string): string[] {
  return Object.entries(SECRET_PATTERNS).filter(([, re]) => re.test(text)).map(([name]) => name);
}

describe('no credentials in the repository', () => {
  it('scans real files (so a passing result means something)', () => {
    const files = trackedAndNew();
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('server/reviewGit.ts');
    expect(files).toContain('.env.example');
  });

  it('finds no credential-shaped strings in any tracked or new file', () => {
    const findings: string[] = [];
    for (const rel of trackedAndNew()) {
      if (rel === 'package-lock.json' || /\.(png|jpe?g|gif|webp|ico|pdf|zip|woff2?)$/i.test(rel)) continue;
      const file = join(ROOT, rel);
      if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size > 2_000_000) continue;
      for (const name of findSecrets(readFileSync(file, 'utf8'))) findings.push(`${rel}: looks like a ${name}`);
    }
    expect(findings).toEqual([]);
  });

  it('would actually catch each kind of credential (the scanner is not blind)', () => {
    const fakes: Record<string, string> = {
      'GitHub token': ['gh', 'p_', 'a1B2c3D4e5F6g7H8i9J0'].join(''),
      'Slack token': ['xo', 'xb-', '1234567890-abcdef'].join(''),
      'Slack webhook URL': ['hooks.slack.com/', 'services/T0123456/B0123456/abcdefghijklmnopqrstuvwx'].join(''),
      'Atlassian API token': ['ATA', 'TT3xFfGF0abcdefghijklmnop12345'].join(''),
      'AWS access key id': ['AK', 'IAABCDEFGHIJKLMNOP'].join(''),
      'API key (sk-…)': ['s', 'k-', 'abcdefghijklmnopqrstuvwxyz12'].join(''),
      'JWT': ['ey', 'Jhbgcioijiuzi1nij9.ey', 'Jzdwiioixmjm0nty3odkwin0'].join(''),
      'private key block': ['-----BEGIN ', 'RSA PRIVATE KEY-----'].join(''),
      'Bearer/Basic credential': ['Bear', 'er abcdefghijklmnopqrstuvwxyz'].join(''),
      'URL with embedded credentials': ['https:', '//user:hunter22@', 'example.com/x'].join(''),
      'hard-coded secret assignment': ['pass', 'word = "hunter2hunter2"'].join(''),
    };
    expect(Object.keys(fakes).sort()).toEqual(Object.keys(SECRET_PATTERNS).sort());
    for (const [name, value] of Object.entries(fakes)) expect(findSecrets(`const x = '${value}'`), name).toContain(name);
  });

  it('does not flag ordinary code, placeholders or redaction markers', () => {
    for (const ok of [
      "const token = process.env.TOKEN_NAME",
      'password: "[redacted]"',
      "SLACK_WEBHOOK_URL=SLACK_WEBHOOK_URL_GOES_HERE",
      'git@github.com:org/repo.git',
      'https://github.com/org/repo/tree/AT-727',
      "const secret = getSecret()",
      '"AT-727-add-test-to-confirm-comments-carry-over"',
    ]) {
      expect(findSecrets(ok), ok).toEqual([]);
    }
  });
});

describe('the places secrets belong are protected', () => {
  it('git ignores .env files, so a local .env can never be committed by accident', () => {
    const ignored = execFileSync('git', ['check-ignore', '-v', '.env', '.env.local', '.env.production'], { cwd: ROOT, encoding: 'utf8' });
    expect(ignored).toMatch(/\.env/);
    for (const name of ['.env', '.env.local']) {
      expect(() => execFileSync('git', ['check-ignore', '-q', name], { cwd: ROOT })).not.toThrow();
    }
  });

  it('only .env.example is tracked, and it holds placeholders, not real values', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => /(^|\/)\.env/.test(f));
    expect(tracked).toEqual(['.env.example']);
    const values = readFileSync(join(ROOT, '.env.example'), 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('#'))
      .map((l) => l.slice(l.indexOf('=') + 1).trim());
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) expect(findSecrets(`x=${v}`), v).toEqual([]);
    expect(readFileSync(join(ROOT, '.env.example'), 'utf8')).toContain('SLACK_WEBHOOK_URL=SLACK_WEBHOOK_URL_GOES_HERE');
  });

  it('the review feature asks for no credentials at all (git, acli and gh keep their own sign-in)', () => {
    const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
    expect(example).not.toMatch(/JIRA_(?:API_)?TOKEN|JIRA_EMAIL|GH_TOKEN|GITHUB_TOKEN|ATLASSIAN_API/i);
    for (const f of ['server/acli.ts', 'server/reviewGit.ts', 'server/ghStatus.ts', 'server/specRun.ts', 'server/specRunner.ts', 'server/reviewPlugin.ts']) {
      expect(readFileSync(join(ROOT, f), 'utf8'), f).not.toMatch(/JIRA_(?:API_)?TOKEN|JIRA_EMAIL|GH_TOKEN|GITHUB_TOKEN|ATLASSIAN_API_TOKEN|Authorization['"]?\s*:/);
    }
  });
});
