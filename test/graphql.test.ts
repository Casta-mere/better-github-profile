import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphQLFailure, graphql, type Fetch } from '../src/collect/graphql';
import errorsPartial from './fixtures/graphql/errors-partial.json';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** A fake fetch that answers each call with the next response factory, repeating the last one. */
function fakeFetch(...responses: (() => Response | Promise<Response>)[]) {
  let calls = 0;
  return vi.fn<Fetch>(async () => responses[Math.min(calls++, responses.length - 1)]());
}

const base = { token: 'tok', query: 'query { viewer { login } }', delayMs: () => 0 };

/** Settle a promise into its value or its rejection, without an unhandled rejection in between. */
const settle = <T>(p: Promise<T>) => p.then(
  (value) => ({ value, error: undefined }),
  (error: unknown) => ({ value: undefined, error }),
);

afterEach(() => {
  vi.useRealTimers();
});

describe('graphql', () => {
  it('returns data on 200 without errors', async () => {
    const fetch = fakeFetch(() => json(200, { data: { viewer: { login: 'Casta-mere' } } }));
    await expect(graphql({ ...base, fetch })).resolves.toEqual({ viewer: { login: 'Casta-mere' } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('POSTs the query and variables to the GitHub endpoint with auth and user agent', async () => {
    const fetch = fakeFetch(() => json(200, { data: {} }));
    await graphql({ ...base, variables: { after: 'abc' }, fetch });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.github.com/graphql');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('bearer tok');
    expect(headers.get('user-agent')).toBe('better-github-profile');
    expect(JSON.parse(String(init?.body))).toEqual({ query: base.query, variables: { after: 'abc' } });
  });

  it('retries 502 then succeeds', async () => {
    const fetch = fakeFetch(
      () => json(502, { message: 'Bad Gateway' }),
      () => json(502, { message: 'Bad Gateway' }),
      () => json(200, { data: { ok: true } }),
    );
    await expect(graphql({ ...base, fetch })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('retries 429', async () => {
    const fetch = fakeFetch(() => json(429, {}), () => json(200, { data: { ok: true } }));
    await expect(graphql({ ...base, fetch })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries a network error and names it when it persists', async () => {
    const fetch = fakeFetch(() => Promise.reject(new TypeError('fetch failed', { cause: new Error('ECONNRESET') })));
    const { error } = await settle(graphql({ ...base, fetch }));
    expect(error).toBeInstanceOf(GraphQLFailure);
    expect((error as GraphQLFailure).attempts).toBe(4);
    expect((error as Error).message).toContain('fetch failed');
    expect((error as Error).message).toContain('ECONNRESET');
  });

  it('names the HTTP status when 5xx persists', async () => {
    const fetch = fakeFetch(() => json(502, {}));
    const { error } = await settle(graphql({ ...base, fetch, retries: 1 }));
    expect((error as GraphQLFailure).attempts).toBe(2);
    expect((error as Error).message).toContain('502');
  });

  it('treats 200 + errors array as failure and retries', async () => {
    const fetch = fakeFetch(() => json(200, errorsPartial));
    const { error } = await settle(graphql({ ...base, fetch }));
    expect(error).toBeInstanceOf(GraphQLFailure);
    expect((error as GraphQLFailure).attempts).toBe(4);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect((error as Error).message).toContain(errorsPartial.errors[0].message);
  });

  it('treats a 200 without data as failure', async () => {
    const fetch = fakeFetch(() => json(200, {}));
    const { error } = await settle(graphql({ ...base, fetch, retries: 0 }));
    expect(error).toBeInstanceOf(GraphQLFailure);
  });

  it('does not retry 401', async () => {
    const fetch = fakeFetch(() => json(401, { message: 'Bad credentials' }));
    const { error } = await settle(graphql({ ...base, fetch }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(GraphQLFailure);
    expect((error as GraphQLFailure).attempts).toBe(1);
    expect((error as Error).message).toContain('token');
  });

  it('does not retry 403 without retry-after, and passes on GitHub\'s message', async () => {
    const fetch = fakeFetch(() => json(403, { message: 'Resource protected by organization SAML enforcement.' }));
    const { error } = await settle(graphql({ ...base, fetch }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((error as Error).message).toContain('403');
    expect((error as Error).message).toContain('SAML enforcement');
  });

  it('retries 403 with retry-after, waiting that many seconds instead of the backoff', async () => {
    vi.useFakeTimers();
    const delayMs = vi.fn<(attempt: number) => number>(() => 0);
    const fetch = fakeFetch(
      () => json(403, { message: 'secondary rate limit' }, { 'retry-after': '3' }),
      () => json(200, { data: { ok: true } }),
    );
    const result = settle(graphql({ ...base, delayMs, fetch }));
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await result).value).toEqual({ ok: true });
    expect(delayMs).not.toHaveBeenCalled();
  });

  it('backs off 2s, 4s, 8s by default', async () => {
    vi.useFakeTimers();
    const fetch = fakeFetch(() => json(502, {}));
    const result = settle(graphql({ token: 'tok', query: 'q', fetch }));
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(8000);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(((await result).error as GraphQLFailure).attempts).toBe(4);
  });

  it('passes the failed attempt number to delayMs', async () => {
    const delayMs = vi.fn<(attempt: number) => number>(() => 0);
    const fetch = fakeFetch(() => json(500, {}));
    await settle(graphql({ ...base, delayMs, fetch }));
    expect(delayMs.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2, 3]);
  });

  it('aborts a hung request after timeoutMs', async () => {
    const fetch = vi.fn<Fetch>(() => new Promise<Response>(() => {}));
    const { error } = await settle(graphql({ ...base, fetch, timeoutMs: 10, retries: 0 }));
    expect(error).toBeInstanceOf(GraphQLFailure);
    expect((error as Error).message).toContain('timeout');
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
