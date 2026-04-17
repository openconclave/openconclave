/**
 * Subprocess env allowlist — used by every subprocess OC spawns (Claude CLI,
 * bash tool, code nodes). SDK 0.2.111+ overlays `options.env` on top of
 * inherited process.env instead of replacing it, so blocked keys must be
 * present-but-blank; omitting them would leak the parent value.
 *
 * Strategy: pass everything EXCEPT vars matching secret-like patterns.
 * Cheaper to maintain than a positive allowlist, and only missed items are
 * nice-to-have (env-var passthrough), not catastrophic.
 */
const BLOCKED_ENV_PATTERNS = [
  /secret/i,
  /password/i,
  /credential/i,
  /private.?key/i,
  /^database.?url$/i,
  /^redis.?url$/i,
  /^mongo.*(uri|url)$/i,
  /^aws_/i,
  /^azure_/i,
  /^gcp_/i,
  /^google_application_/i,
  /^npm_config_/i,
  /^(ssh_auth_sock|kubeconfig)$/i,
  /_dsn$/i,
  /_pat$/i,
  /_(key|token)$/i,
];

export function isBlockedEnvKey(key: string): boolean {
  return BLOCKED_ENV_PATTERNS.some((p) => p.test(key));
}

export function buildSubprocessEnv(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    out[k] = isBlockedEnvKey(k) ? "" : v;
  }
  for (const [k, v] of Object.entries(extra)) {
    out[k] = isBlockedEnvKey(k) ? "" : v;
  }
  return out;
}
