import type { Fetch } from '../collect/graphql';
import type { ThemeName } from '../snapshot/types';

/**
 * The usage counter's `POST /ping` endpoint (the Worker in `worker/`). Empty means no ping
 * is sent.
 */
export const TELEMETRY_URL: string = 'https://better-github-profile-usage.castamerego.workers.dev/ping';

/**
 * SHA-256 hex of `better-github-profile:<repoId>`. Pseudonymous, not anonymous: repo IDs
 * are short integers, so whoever holds the stored ids could hash every ID and find the repo.
 */
export async function pingId(repoId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`better-github-profile:${repoId}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface PingOptions {
  /** `GITHUB_REPOSITORY_ID`; no ping without it. */
  repoId: string | undefined;
  version: string;
  theme: ThemeName;
  /** Default `TELEMETRY_URL`; empty = no ping. */
  url?: string;
  fetch?: Fetch;
  /** Default 3000. */
  timeoutMs?: number;
  /** Where failures go (`core.debug` in the Action); they are never surfaced otherwise. */
  debug?: (msg: string) => void;
}

/** Sends `{ id, version, theme }` once. Never rejects: a telemetry failure never affects the run. */
export async function sendPing(opts: PingOptions): Promise<void> {
  const url = opts.url ?? TELEMETRY_URL;
  if (!url || !opts.repoId) return;
  const debug = opts.debug ?? (() => {});
  const timeoutMs = opts.timeoutMs ?? 3000;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const body = JSON.stringify({ id: await pingId(opts.repoId), version: opts.version, theme: opts.theme });
    const request = (opts.fetch ?? fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'better-github-profile' },
      body,
      signal: controller.signal,
    });
    // Raced, so even a fetch that ignores the abort signal can't hold the run up.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`timeout after ${timeoutMs} ms`));
        controller.abort();
      }, timeoutMs);
    });
    const res = await Promise.race([request, timeout]);
    res.body?.cancel().catch(() => {});
    if (!res.ok) debug(`usage ping: HTTP ${res.status}`);
  } catch (err) {
    debug(`usage ping failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}
