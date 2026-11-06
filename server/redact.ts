/**
 * Nothing sensitive may leave the server. git, acli and gh print things like
 * remote URLs (which some people embed a personal access token in), auth
 * headers and token values in their error output; all of it is run through
 * `redactSecrets` before it can reach the browser, and remote URLs have any
 * embedded credentials stripped.
 *
 * The app itself never reads, stores or logs credentials: git, acli and gh keep
 * their own sign-in (SSH keys, keychain, credential helpers).
 */

const REDACTED = '[redacted]';

const PATTERNS: Array<[RegExp, string]> = [
  // remotes with a token in the URL's userinfo part: keep scheme and host, drop the userinfo
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, '$1'],
  // GitHub tokens
  [/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{10,}/g, REDACTED],
  // Slack tokens and incoming-webhook URLs
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g, `hooks.slack.com/services/${REDACTED}`],
  // Atlassian API tokens
  [/\bATATT[A-Za-z0-9_=-]{10,}/g, REDACTED],
  // AWS access key ids, OpenAI-style keys, JWTs
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\bsk-[A-Za-z0-9]{20,}/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?/g, REDACTED],
  // Authorization headers: keep the scheme, drop the credential
  [/\b(Authorization:\s*)(?:Bearer|Basic|Token)\s+\S+/gi, `$1${REDACTED}`],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g, `$1 ${REDACTED}`],
  // key=value / key: value for obviously secret names
  [/\b((?:api[_-]?)?(?:token|secret|password|passwd|private[_-]?key)["']?\s*[:=]\s*["']?)[^\s"',;]{4,}/gi, `$1${REDACTED}`],
  // PEM blocks
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, REDACTED],
];

export function redactSecrets(text: string): string {
  return PATTERNS.reduce((out, [re, replacement]) => out.replace(re, replacement), text);
}

/** Drops a userinfo part from http(s) remotes. SSH-style `git@host:o/r` is left alone (the `git` there is a username, not a secret). */
export function stripUrlCredentials(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/i, (m, scheme: string) => (/^ssh:\/\/git@$/i.test(m) ? m : scheme));
}
