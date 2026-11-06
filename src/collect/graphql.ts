export type Fetch = typeof fetch;

const ENDPOINT = 'https://api.github.com/graphql';
const USER_AGENT = 'better-github-profile';

const TOKEN_REJECTED =
  'GitHub rejected the token (HTTP 401). Check the token secret (STATS_TOKEN) and its scopes: ' +
  'read:user, plus repo to include private work.';

/** The request failed for good. `message` names the last cause; it ends up in the stale warning. */
export class GraphQLFailure extends Error {
  readonly attempts: number;

  constructor(message: string, attempts: number) {
    super(message);
    this.name = 'GraphQLFailure';
    this.attempts = attempts;
  }
}

export interface GraphQLOptions {
  token: string;
  query: string;
  variables?: Record<string, unknown>;
  fetch?: Fetch;
  /** Retries after the first attempt. Default 3, so 4 attempts in total. */
  retries?: number;
  /** Wait before the next attempt, given the number of the attempt that just failed (1-based). */
  delayMs?: (attempt: number) => number;
  /** Per attempt, covering the response body too. */
  timeoutMs?: number;
}

type Outcome<T> =
  | { ok: true; data: T }
  | { ok: false; cause: string; retry: boolean; waitMs?: number };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * POST a query to GitHub's GraphQL API. Retries network errors, timeouts, HTTP 5xx/429,
 * 403 with `retry-after`, and HTTP 200 with a non-empty `errors` array (partial data is
 * never trusted). Throws `GraphQLFailure` once retries run out or the failure is permanent.
 */
export async function graphql<T>(opts: GraphQLOptions): Promise<T> {
  const retries = opts.retries ?? 3;
  const delayMs = opts.delayMs ?? ((attempt: number) => 2000 * 2 ** (attempt - 1));
  for (let attempt = 1; ; attempt++) {
    const outcome = await attemptOnce<T>(opts);
    if (outcome.ok) return outcome.data;
    if (!outcome.retry || attempt > retries) {
      const tries = `${attempt} attempt${attempt === 1 ? '' : 's'}`;
      throw new GraphQLFailure(`GitHub GraphQL request failed after ${tries}: ${outcome.cause}`, attempt);
    }
    await sleep(outcome.waitMs ?? delayMs(attempt));
  }
}

async function attemptOnce<T>(opts: GraphQLOptions): Promise<Outcome<T>> {
  const timeoutMs = opts.timeoutMs ?? 30000;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Outcome<T>>((resolve) => {
    timer = setTimeout(() => {
      // Settle first, so the race reports the timeout and not the abort error it causes.
      resolve({ ok: false, cause: `timeout after ${timeoutMs} ms`, retry: true });
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([request<T>(opts, controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** One request, response body included. Never rejects. */
async function request<T>(opts: GraphQLOptions, signal: AbortSignal): Promise<Outcome<T>> {
  const fetchFn = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await fetchFn(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `bearer ${opts.token}`,
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: opts.query, variables: opts.variables ?? {} }),
      signal,
    });
  } catch (err) {
    return { ok: false, cause: `network error: ${describe(err)}`, retry: true };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }

  if (!res.ok) return httpFailure(res, body);
  if (!isObj(body)) return { ok: false, cause: 'response was not JSON', retry: true };
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const first: unknown = body.errors[0];
    const message = isObj(first) && typeof first.message === 'string' ? first.message : 'unknown error';
    return { ok: false, cause: `GraphQL error: ${message}`, retry: true };
  }
  if (body.data === undefined || body.data === null) {
    return { ok: false, cause: 'response had no data', retry: true };
  }
  return { ok: true, data: body.data as T };
}

function httpFailure(res: Response, body: unknown): Outcome<never> {
  const { status } = res;
  if (status === 401) return { ok: false, cause: TOKEN_REJECTED, retry: false };
  const detail = isObj(body) && typeof body.message === 'string' ? `: ${body.message}` : '';
  const cause = `HTTP ${status}${detail}`;
  const waitMs = retryAfterMs(res.headers.get('retry-after'));
  if (status === 403) return waitMs === undefined ? { ok: false, cause, retry: false } : { ok: false, cause, retry: true, waitMs };
  if (status === 429 || status >= 500) return { ok: false, cause, retry: true, waitMs };
  return { ok: false, cause, retry: false };
}

/** `retry-after` is either delay-seconds or an HTTP date. */
function retryAfterMs(header: string | null): number | undefined {
  if (header === null || header.trim() === '') return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? ` (${err.cause.message})` : '';
  return `${err.message}${cause}`;
}
