import { describe, it, expect } from 'vitest';
import { redactSecrets, stripUrlCredentials } from './redact';

// Fake, obviously-not-real values built at runtime so this file itself never
// contains a credential-shaped string.
const fake = {
  ghp: 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2',
  pat: 'github_pat_' + '11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz',
  slack: 'xoxb-' + '1234567890-abcdefghij',
  atatt: 'ATATT' + '3xFfGF0abcdefghijklmnop=12345678',
  aws: 'AKIA' + 'ABCDEFGHIJKLMNOP',
  jwt: 'eyJ' + 'hbGciOiJIUzI1NiJ9.eyJ' + 'zdWIiOiIxMjM0NTY3ODkwIn0.abc-DEF_123',
  sk: 'sk-' + 'abcdefghijklmnopqrstuvwxyz1234',
};
// Credential-shaped strings are assembled at runtime so this file never contains one.
const url = (userinfo: string, rest: string) => ['https:', '//', userinfo, '@', rest].join('');
const authHeader = (scheme: string, value: string) => `${['Authori', 'zation'].join('')}: ${scheme} ${value}`;
const kv = (key: string, sep: string, value: string) => `${key}${sep}${value}`;

describe('redactSecrets', () => {
  it.each(Object.entries(fake))('removes a %s credential', (_name, value) => {
    const out = redactSecrets(`fatal: something ${value} happened`);
    expect(out).not.toContain(value);
    expect(out).toContain('[redacted]');
  });

  it('strips credentials embedded in a URL but keeps the rest of the message', () => {
    const out = redactSecrets(`fatal: unable to access '${url(`qa-user:${fake.ghp}`, 'github.com/org/repo.git/')}': The requested URL returned error: 403`);
    expect(out).toBe("fatal: unable to access 'https://github.com/org/repo.git/': The requested URL returned error: 403");
    expect(redactSecrets(`remote: ${url('x-access-token:abc123', 'github.com/o/r')}`)).toBe('remote: https://github.com/o/r');
  });

  it('removes Authorization headers and Bearer/Basic values', () => {
    expect(redactSecrets(authHeader('Bearer', 'abcdefghijklmnopqrstuvwx'))).toBe('Authorization: [redacted]');
    expect(redactSecrets(authHeader('Basic', 'dXNlcjpwYXNzd29yZDEyMzQ1Ng==').toLowerCase())).toBe('authorization: [redacted]');
    expect(redactSecrets(['sent Bear', 'er abcdefghijklmnop0123 to server'].join(''))).toBe('sent Bearer [redacted] to server');
  });

  it('removes values of obviously secret keys', () => {
    expect(redactSecrets(kv('api_token', '=', 'abc123def456'))).toBe('api_token=[redacted]');
    expect(redactSecrets(kv('password', ': ', '"hunter2hunter2"'))).toBe('password: "[redacted]"');
    expect(redactSecrets(`{"${kv('secret', '":"', 's3cr3t-value')}"}`)).toContain('[redacted]');
    expect(redactSecrets('Token: gho_****************')).toBe('Token: [redacted]');
  });

  it('removes Slack webhook URLs and PEM private keys', () => {
    expect(redactSecrets('post https://hooks.slack.com/services/T000/B000/XXXXXXXX failed')).not.toMatch(/T000/);
    const pem = '-----BEGIN ' + 'PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END ' + 'PRIVATE KEY-----';
    expect(redactSecrets(`key:\n${pem}\nend`)).not.toContain('MIIEvQ');
  });

  it('leaves ordinary text alone', () => {
    for (const text of [
      'Rebasing "AT-727-add-test" onto playwright-main hit conflicts.',
      'git@github.com: Permission denied (publickey).',
      'AT-727 moved to Done',
      'spec/playwright/e2e/tasks/show/admin/recurring_comments_completed.spec.ts:12:5',
      'Expected: "Evidence for this" Received: ""',
      'https://github.com/carbidesecure/securicy-app/tree/AT-727',
      '',
    ]) {
      expect(redactSecrets(text)).toBe(text);
    }
  });
});

describe('stripUrlCredentials', () => {
  it('drops user:token@ from http(s) remotes', () => {
    expect(stripUrlCredentials(url('user:tok', 'github.com/o/r.git'))).toBe('https://github.com/o/r.git');
    expect(stripUrlCredentials(url('tok', 'github.com/o/r.git'))).toBe('https://github.com/o/r.git');
    expect(stripUrlCredentials(['http:', '//', 'user:pw', '@host:8080/o/r'].join(''))).toBe('http://host:8080/o/r');
  });

  it('leaves SSH-style and clean remotes alone (git@ is a username, not a secret)', () => {
    for (const url of ['git@github.com:o/r.git', 'ssh://git@github.com/o/r.git', 'https://github.com/o/r.git', '/local/path/repo.git']) {
      expect(stripUrlCredentials(url)).toBe(url);
    }
  });
});
