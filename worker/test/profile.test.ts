import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { validateProfileData } from '../../src/collect/profile';
import { handle, type Env } from '../src/index';

const NOW = new Date('2026-11-11T12:00:00Z');
const ORIGIN = 'https://usage.test';
const TOKEN = 'ghp_secret-owner-token-0123456789';

const week = (n: number) => ({ contributionDays: [{ contributionCount: n }, { contributionCount: 1 }] });

/** A made-up public user with two contribution years and three public repos. */
const USER = {
  login: 'Octo',
  name: 'Octo Cat',
  createdAt: '2024-02-03T04:05:06Z',
  followers: { totalCount: 12 },
  contributionsCollection: {
    totalCommitContributions: 40,
    totalPullRequestContributions: 4,
    totalIssueContributions: 3,
    totalPullRequestReviewContributions: 2,
    restrictedContributionsCount: 9,
    contributionCalendar: { totalContributions: 60, weeks: [week(2), week(0), week(5)] },
    contributionYears: [2026, 2025],
  },
};

const repoNode = (name: string, stars = 1) => ({
  name,
  isFork: false,
  isPrivate: false,
  stargazerCount: stars,
  forkCount: 0,
  primaryLanguage: { name: 'Go' },
  languages: { edges: [{ size: 100, node: { name: 'Go', color: '#00ADD8' } }] },
});

const reposPage = (nodes: unknown[], hasNextPage = false, endCursor: string | null = null) => ({
  repositories: { pageInfo: { hasNextPage, endCursor }, nodes },
});

const YEARS = {
  y2026: { contributionCalendar: { totalContributions: 70 }, restrictedContributionsCount: 9 },
  y2025: { contributionCalendar: { totalContributions: 30 }, restrictedContributionsCount: 1 },
};

interface Call {
  query: string;
  variables: Record<string, unknown>;
  headers: Headers;
}

type Answer = { status?: number; body: unknown } | 'network-error';

/**
 * A stand-in for api.github.com/graphql. `repos(after)` answers the repos query, `years` the
 * aliased per-year query; `override` replaces every answer.
 */
function github(
  o: {
    repos?: (after: unknown) => unknown;
    years?: unknown;
    user?: unknown;
    override?: Answer;
  } = {},
) {
  const calls: Call[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const { query, variables = {} } = (await request.json()) as { query: string; variables?: Record<string, unknown> };
    calls.push({ query, variables, headers: request.headers });
    if (o.override === 'network-error') throw new TypeError('Network connection lost.');
    if (o.override) return Response.json(o.override.body, { status: o.override.status ?? 200 });
    if (query.includes('repositories(')) {
      const page = o.repos ? o.repos(variables.after) : reposPage([repoNode('alpha', 5), repoNode('beta', 2)]);
      const user = o.user === undefined ? { ...USER, ...(page as object) } : o.user;
      // Later pages only need the repos; extra fields are harmless.
      return Response.json({ data: { user } });
    }
    if (/y\d{4}\s*:\s*contributionsCollection/.test(query)) {
      return Response.json({ data: { user: o.years ?? YEARS } });
    }
    return Response.json({ errors: [{ message: 'fake GitHub: unknown query' }] });
  };
  const reposCalls = () => calls.filter((c) => c.query.includes('repositories('));
  return { fetch: fetch as typeof globalThis.fetch, calls, reposCalls };
}

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

async function profile(login: string, o: Options = {}): Promise<Response> {
  const request = new Request(`${ORIGIN}/profile/${login}`, { method: o.method ?? 'GET', headers: o.headers });
  const upstream = o.upstream ?? github();
  const cache = o.cache ?? (await caches.open(crypto.randomUUID()));
  return handle(request, o.env ?? withToken(), NOW, { fetch: upstream.fetch, cache });
}

function withToken(extra: Partial<Env> = {}): Env {
  return { DB: env.DB, GITHUB_TOKEN: TOKEN, ...extra };
}

describe('GET /profile/<login>', () => {
  it('valid user: 200 with ProfileData, years mapped from the aliases', async () => {
    const upstream = github();
    const res = await profile('octo', { upstream });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toBe('max-age=600');
    const body = await res.json();
    expect(validateProfileData(body)).toBe(true);
    expect(body).toEqual({
      user: { login: 'Octo', name: 'Octo Cat', createdAt: '2024-02-03T04:05:06Z', followers: 12 },
      pastYear: { total: 60, restricted: 9, commits: 40, pullRequests: 4, issues: 3, reviews: 2, weeks: [3, 1, 6] },
      years: [
        { year: 2026, total: 70, restricted: 9 },
        { year: 2025, total: 30, restricted: 1 },
      ],
      repos: [
        { name: 'alpha', isPrivate: false, isFork: false, stars: 5, forks: 0, language: 'Go', languages: [{ name: 'Go', color: '#00ADD8', bytes: 100 }] },
        { name: 'beta', isPrivate: false, isFork: false, stars: 2, forks: 0, language: 'Go', languages: [{ name: 'Go', color: '#00ADD8', bytes: 100 }] },
      ],
    });
    expect(upstream.calls).toHaveLength(2);
    const [first, second] = upstream.calls;
    expect(first?.variables).toEqual({ login: 'octo', after: null });
    expect(first?.query).toMatch(/privacy:\s*PUBLIC/);
    expect(first?.query).toMatch(/first:\s*100/);
    expect(second?.variables).toEqual({ login: 'octo' });
    expect(second?.query).toContain('y2026: contributionsCollection(from: "2026-01-01T00:00:00Z", to: "2026-12-31T23:59:59Z")');
    expect(second?.query).toContain('y2025: contributionsCollection(from: "2025-01-01T00:00:00Z", to: "2025-12-31T23:59:59Z")');
  });

  it('sends the token upstream but never in the response', async () => {
    const upstream = github();
    const res = await profile('octo', { upstream });
    expect(upstream.calls[0]?.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(res.headers.get('authorization')).toBeNull();
    for (const [, value] of res.headers) expect(value).not.toContain(TOKEN);
    expect(await res.text()).not.toContain(TOKEN);
  });

  it('a user with no contribution years: one request, empty years', async () => {
    const user = { ...USER, contributionsCollection: { ...USER.contributionsCollection, contributionYears: [] }, ...reposPage([]) };
    const upstream = github({ user });
    const res = await profile('octo', { upstream });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { years: unknown[]; repos: unknown[] };
    expect(body.years).toEqual([]);
    expect(body.repos).toEqual([]);
    expect(upstream.calls).toHaveLength(1);
  });

  it('follows repo pages', async () => {
    const upstream = github({
      repos: (after) => (after == null ? reposPage([repoNode('one')], true, 'c1') : reposPage([repoNode('two')])),
    });
    const res = await profile('octo', { upstream });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { repos: { name: string }[] }).repos.map((r) => r.name)).toEqual(['one', 'two']);
    expect(upstream.reposCalls().map((c) => c.variables.after)).toEqual([null, 'c1']);
  });

  it('stops after 5 pages', async () => {
    let n = 0;
    const upstream = github({ repos: () => reposPage([repoNode(`r${++n}`)], true, `c${n}`) });
    const res = await profile('octo', { upstream });
    expect(res.status).toBe(200);
    expect(upstream.reposCalls()).toHaveLength(5);
    expect(((await res.json()) as { repos: unknown[] }).repos).toHaveLength(5);
  });

  it.each(['bad..name', '-octo', 'oc--to', 'oc_to', 'a'.repeat(40), 'octo/extra', ''])(
    'invalid login %j: 400 without calling GitHub',
    async (login) => {
      const upstream = github();
      const res = await profile(login, { upstream });
      expect(res.status).toBe(400);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(upstream.calls).toEqual([]);
    },
  );

  it('unknown user → 404', async () => {
    const upstream = github({
      override: { body: { data: { user: null }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a User' }] } },
    });
    const res = await profile('nobody', { upstream });
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('max-age=600');
  });

  it('GraphQL RATE_LIMITED: 429', async () => {
    const upstream = github({ override: { body: { errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] } } });
    expect((await profile('octo', { upstream })).status).toBe(429);
  });

  it.each([403, 429])('upstream HTTP %i: 429', async (status) => {
    const upstream = github({ override: { status, body: { message: 'rate limit' } } });
    expect((await profile('octo', { upstream })).status).toBe(429);
  });

  it.each([
    ['fetch throws', 'network-error' as const],
    ['upstream 500', { status: 500, body: {} }],
    ['other GraphQL errors', { body: { errors: [{ type: 'INTERNAL', message: 'boom' }] } }],
    ['a malformed answer', { body: { data: { user: { login: 'octo' } } } }],
  ])('%s: 502', async (_name, override) => {
    const res = await profile('octo', { upstream: github({ override }) });
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('no GITHUB_TOKEN: 503 without calling GitHub', async () => {
    const upstream = github();
    const res = await profile('octo', { upstream, env: { DB: env.DB } });
    expect(res.status).toBe(503);
    expect(upstream.calls).toEqual([]);
  });

  it('second identical request is served from the cache, whatever the login case', async () => {
    const cache = await caches.open(crypto.randomUUID());
    const upstream = github();
    const first = await profile('octo', { upstream, cache });
    const second = await profile('OCTO', { upstream, cache });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(upstream.reposCalls()).toHaveLength(1);
  });

  it('caches a 404 but not a 429 or 502', async () => {
    for (const [override, cached] of [
      [{ body: { data: { user: null } } }, true],
      [{ status: 429, body: {} }, false],
      [{ status: 500, body: {} }, false],
    ] as const) {
      const cache = await caches.open(crypto.randomUUID());
      const upstream = github({ override });
      await profile('octo', { upstream, cache });
      await profile('octo', { upstream, cache });
      expect(upstream.calls).toHaveLength(cached ? 1 : 2);
    }
  });

  it('over the per-IP limit: 429 without calling GitHub', async () => {
    const limit = limiter(false);
    const upstream = github();
    const res = await profile('octo', {
      upstream,
      env: withToken({ PROFILE_LIMIT: limit.binding }),
      headers: { 'cf-connecting-ip': '203.0.113.7' },
    });
    expect(res.status).toBe(429);
    expect(upstream.calls).toEqual([]);
    expect(limit.keys).toEqual(['203.0.113.7']);
  });

  it('under the limit: answers as usual', async () => {
    const limit = limiter(true);
    const res = await profile('octo', { env: withToken({ PROFILE_LIMIT: limit.binding }) });
    expect(res.status).toBe(200);
  });

  it('OPTIONS is a 204 CORS preflight answer', async () => {
    const res = await profile('octo', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS');
  });

  it('POST: 405', async () => {
    const res = await profile('octo', { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, OPTIONS');
  });
});
