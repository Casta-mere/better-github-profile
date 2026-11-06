import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { handle, type Env } from '../src/index';

const NOW = new Date('2026-11-06T12:00:00Z');
const ORIGIN = 'https://usage.test';
const TOKEN = 'ghp_secret-owner-token-0123456789';

/** A canned GitHub answer, or a fetch that throws like a network error. */
type Answer = { status?: number; body?: unknown; headers?: Record<string, string> } | 'network-error';

/** A stand-in for GitHub: records each upstream request and answers with `answer`. */
function github(answer: Answer = {}) {
  const calls: Request[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push(new Request(input, init));
    if (answer === 'network-error') throw new TypeError('Network connection lost.');
    return Response.json(answer.body ?? { ok: true }, {
      status: answer.status ?? 200,
      headers: {
        'x-ratelimit-remaining': '4999',
        etag: 'W/"abc"',
        vary: 'Accept, Authorization',
        'set-cookie': 'logged_in=no',
        'x-oauth-scopes': 'public_repo',
        ...answer.headers,
      },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

/** A Rate Limiting binding that allows or refuses every call, recording the keys. */
function limiter(allow: boolean) {
  const keys: string[] = [];
  const binding: RateLimit = {
    limit: async ({ key }) => {
      keys.push(key);
      return { success: allow };
    },
  };
  return { binding, keys };
}

interface Options {
  method?: string;
  env?: Env;
  upstream?: ReturnType<typeof github>;
  cache?: Cache;
  headers?: Record<string, string>;
}

/** Each call gets its own named cache unless one is passed, so tests never see each other's entries. */
async function gh(path: string, o: Options = {}): Promise<Response> {
  const request = new Request(`${ORIGIN}/gh${path}`, { method: o.method ?? 'GET', headers: o.headers });
  const upstream = o.upstream ?? github();
  const cache = o.cache ?? (await caches.open(crypto.randomUUID()));
  return handle(request, o.env ?? withToken(), NOW, { fetch: upstream.fetch, cache });
}

/** `env` with the owner token set and no rate limiter, plus `extra`. */
function withToken(extra: Partial<Env> = {}): Env {
  return { DB: env.DB, GITHUB_TOKEN: TOKEN, ...extra };
}

describe('GET /gh/<path>: allowed paths', () => {
  it.each([
    '/repos/octo/octo',
    '/repos/Octo/oCTO',
    '/repos/a-b/a-b',
    '/repos/octo/octo/contents/.github/workflows/profile-cards.yml',
    '/repos/octo/octo/contents/cards',
    '/repos/octo/octo/contents/assets/my%20stats',
    '/repos/octo/octo/actions/workflows/profile-cards.yml/runs',
    '/repos/octo/octo/actions/runs/1234567890/jobs',
    '/repos/octo/octo/check-runs/987654321/annotations',
  ])('%s is fetched from api.github.com', async (path) => {
    const upstream = github({ body: { name: 'octo' } });
    const res = await gh(path, { upstream });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'octo' });
    expect(upstream.calls.map((r) => r.url)).toEqual([`https://api.github.com${path}`]);
    expect(upstream.calls[0]?.method).toBe('GET');
  });
});

describe('GET /gh/<path>: everything else is 404 without calling GitHub', () => {
  it.each([
    ['owner and repo differ', '/repos/octo/other'],
    ['repo is the owner plus more', '/repos/octo/octo2'],
    ['repo is another profile', '/repos/octo/cat/contents/x'],
    ['username with a leading hyphen', '/repos/-octo/-octo'],
    ['username with a double hyphen', '/repos/oc--to/oc--to'],
    ['username with an underscore', '/repos/oc_to/oc_to'],
    ['username of 40 characters', `/repos/${'a'.repeat(40)}/${'a'.repeat(40)}`],
    ['the authenticated user', '/user'],
    ['a user', '/users/octo'],
    ['an owner alone', '/repos/octo'],
    ['a trailing slash', '/repos/octo/octo/'],
    ['issues', '/repos/octo/octo/issues'],
    ['secrets', '/repos/octo/octo/actions/secrets'],
    ['run logs', '/repos/octo/octo/actions/runs/1/logs'],
    ['a run', '/repos/octo/octo/actions/runs/1'],
    ['a non-numeric run', '/repos/octo/octo/actions/runs/abc/jobs'],
    ['a .yaml workflow', '/repos/octo/octo/actions/workflows/profile-cards.yaml/runs'],
    ['a workflow by id', '/repos/octo/octo/actions/workflows/123/runs'],
    ['a check run', '/repos/octo/octo/check-runs/1'],
    ['contents without a path', '/repos/octo/octo/contents'],
    ['contents with an empty path', '/repos/octo/octo/contents/'],
    ['an encoded slash climbing out', '/repos/octo/octo/contents/a%2F..%2F..%2F..%2Fuser'],
    ['an encoded backslash', '/repos/octo/octo/contents/a%5C..'],
    ['a broken escape', '/repos/octo/octo/contents/%E0%A4%A'],
    ['dot segments, resolved before routing', '/repos/octo/octo/contents/../../../../user'],
    ['the root', '/'],
  ])('%s: %s', async (_name, path) => {
    const upstream = github();
    const res = await gh(path, { upstream });
    expect(res.status).toBe(404);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(upstream.calls).toEqual([]);
  });

  it('/gh without a path is 404', async () => {
    const res = await handle(new Request(`${ORIGIN}/gh`), withToken(), NOW, { fetch: github().fetch });
    expect(res.status).toBe(404);
  });
});

describe('/gh/<path>: methods', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s is 405 without calling GitHub', async (method) => {
    const upstream = github();
    const res = await gh('/repos/octo/octo', { method, upstream });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, OPTIONS');
    expect(upstream.calls).toEqual([]);
  });

  it('OPTIONS is a 204 CORS preflight answer', async () => {
    const upstream = github();
    const res = await gh('/repos/octo/octo/contents/cards', { method: 'OPTIONS', upstream });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toMatch(/accept/i);
    expect(upstream.calls).toEqual([]);
  });
});

describe('/gh/<path>: query', () => {
  it.each([
    ['?per_page=1', '?per_page=1'],
    ['?per_page=100', '?per_page=100'],
    ['?per_page=007', '?per_page=7'],
    ['?per_page=1&page=2&access_token=x&ref=main', '?per_page=1'],
    ['?page=2', ''],
    ['?per_page=101', ''],
    ['?per_page=abc', ''],
    ['?per_page=', ''],
    ['?per_page=-1', ''],
    ['?per_page=1e2', ''],
  ])('%s goes upstream as "%s"', async (query, sent) => {
    const upstream = github();
    const path = '/repos/octo/octo/actions/workflows/profile-cards.yml/runs';
    expect((await gh(`${path}${query}`, { upstream })).status).toBe(200);
    expect(upstream.calls.map((r) => r.url)).toEqual([`https://api.github.com${path}${sent}`]);
  });
});

describe('/gh/<path>: the owner token', () => {
  it('without a token: 503 and GitHub is never called, so the page goes direct', async () => {
    for (const token of [undefined, '']) {
      const upstream = github();
      const res = await gh('/repos/octo/octo', { upstream, env: { DB: env.DB, GITHUB_TOKEN: token } });
      expect(res.status, String(token)).toBe(503);
      expect(await res.json()).toEqual({ error: 'proxy not configured' });
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(upstream.calls).toEqual([]);
    }
  });

  it('sends the token and GitHub API headers upstream', async () => {
    const upstream = github();
    await gh('/repos/octo/octo', { upstream });
    const sent = upstream.calls[0]!.headers;
    expect(sent.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(sent.get('accept')).toBe('application/vnd.github+json');
    expect(sent.get('x-github-api-version')).toBe('2022-11-28');
    expect(sent.get('user-agent')).toBe('better-github-profile-usage');
  });

  it('does not forward the caller headers upstream', async () => {
    const upstream = github();
    await gh('/repos/octo/octo', { upstream, headers: { authorization: 'Bearer caller', cookie: 'a=b' } });
    const sent = upstream.calls[0]!.headers;
    expect(sent.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(sent.get('cookie')).toBeNull();
  });

  it('answers with only content-type, x-ratelimit-remaining, CORS and cache headers: never the token', async () => {
    for (const status of [200, 404, 403, 500]) {
      const res = await gh('/repos/octo/octo', { upstream: github({ status }) });
      const headers = Object.fromEntries(res.headers);
      expect(Object.keys(headers).sort(), String(status)).toEqual([
        'access-control-allow-origin',
        'cache-control',
        'content-type',
        'x-ratelimit-remaining',
      ]);
      expect(JSON.stringify(headers)).not.toContain(TOKEN);
      expect(await res.text()).not.toContain(TOKEN);
    }
  });
});

describe('/gh/<path>: GitHub answers', () => {
  it('passes a 404 through', async () => {
    const res = await gh('/repos/octo/octo', { upstream: github({ status: 404, body: { message: 'Not Found' } }) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: 'Not Found' });
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  });

  it('passes GitHub’s rate limit (403, x-ratelimit-remaining: 0) through', async () => {
    const upstream = github({
      status: 403,
      body: { message: 'API rate limit exceeded' },
      headers: { 'x-ratelimit-remaining': '0' },
    });
    const res = await gh('/repos/octo/octo', { upstream });
    expect(res.status).toBe(403);
    expect(res.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toEqual({ message: 'API rate limit exceeded' });
  });

  it('passes a server error through', async () => {
    expect((await gh('/repos/octo/octo', { upstream: github({ status: 502 }) })).status).toBe(502);
  });

  it('GitHub unreachable: 502, so the page goes direct', async () => {
    const res = await gh('/repos/octo/octo', { upstream: github('network-error') });
    expect(res.status).toBe(502);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('200 and 404 are cacheable for 30 s; other statuses are not', async () => {
    const cacheControl = async (status: number) =>
      (await gh('/repos/octo/octo', { upstream: github({ status }) })).headers.get('cache-control');
    expect(await cacheControl(200)).toBe('max-age=30');
    expect(await cacheControl(404)).toBe('max-age=30');
    expect(await cacheControl(403)).toBe('no-store');
    expect(await cacheControl(500)).toBe('no-store');
  });
});

describe('/gh/<path>: cache', () => {
  it.each([200, 404])('a second identical request within 30 s is answered from the cache (%i)', async (status) => {
    const cache = await caches.open(crypto.randomUUID());
    const upstream = github({ status, body: { n: 1 } });
    const first = await gh('/repos/octo/octo', { upstream, cache });
    const second = await gh('/repos/octo/octo', { upstream, cache });
    expect(upstream.calls).toHaveLength(1);
    expect([first.status, second.status]).toEqual([status, status]);
    expect(await second.json()).toEqual({ n: 1 });
    expect(second.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('keys the cache by the upstream URL: dropped query keys share an entry, per_page does not', async () => {
    const cache = await caches.open(crypto.randomUUID());
    const upstream = github();
    const path = '/repos/octo/octo/actions/workflows/profile-cards.yml/runs';
    await gh(`${path}?per_page=1`, { upstream, cache });
    await gh(`${path}?per_page=1&page=9`, { upstream, cache });
    await gh(`${path}?per_page=2`, { upstream, cache });
    expect(upstream.calls.map((r) => r.url)).toEqual([
      `https://api.github.com${path}?per_page=1`,
      `https://api.github.com${path}?per_page=2`,
    ]);
  });

  it.each([403, 429, 500, 503])('never caches a %i', async (status) => {
    const cache = await caches.open(crypto.randomUUID());
    const upstream = github({ status });
    await gh('/repos/octo/octo', { upstream, cache });
    await gh('/repos/octo/octo', { upstream, cache });
    expect(upstream.calls).toHaveLength(2);
  });
});

describe('/gh/<path>: per-IP rate limit', () => {
  it('over the limit: 429 with x-ratelimit-remaining: 0, without calling GitHub', async () => {
    const limit = limiter(false);
    const upstream = github();
    const res = await gh('/repos/octo/octo', {
      upstream,
      env: withToken({ CHECK_LIMIT: limit.binding }),
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(upstream.calls).toEqual([]);
    expect(limit.keys).toEqual(['203.0.113.7']);
  });

  it('under the limit: answers as usual', async () => {
    const limit = limiter(true);
    const res = await gh('/repos/octo/octo', {
      env: withToken({ CHECK_LIMIT: limit.binding }),
      headers: { 'cf-connecting-ip': '198.51.100.1' },
    });
    expect(res.status).toBe(200);
    expect(limit.keys).toEqual(['198.51.100.1']);
  });

  it('rejected paths and preflights do not count', async () => {
    const limit = limiter(true);
    await gh('/repos/octo/other', { env: withToken({ CHECK_LIMIT: limit.binding }) });
    await gh('/repos/octo/octo', { method: 'OPTIONS', env: withToken({ CHECK_LIMIT: limit.binding }) });
    expect(limit.keys).toEqual([]);
  });

  it('without the binding: no limit', async () => {
    expect((await gh('/repos/octo/octo', { env: withToken() })).status).toBe(200);
  });

  it('wrangler.toml declares the CHECK_LIMIT binding', () => {
    expect(typeof env.CHECK_LIMIT?.limit).toBe('function');
  });
});

describe('deployed entry point', () => {
  it('serves /gh, and without a GITHUB_TOKEN secret says the proxy is not configured', async () => {
    const res = await exports.default.fetch(`${ORIGIN}/gh/repos/octo/octo`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'proxy not configured' });
  });
});
