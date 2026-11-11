/**
 * `GET /profile/<login>`: a GitHub user's public data as `ProfileData`, for the selector
 * page's live preview. The page runs the Action's own `aggregate()` on it.
 *
 * Uses the owner's GITHUB_TOKEN, a fine-grained token with no access, so only public data
 * can be seen; nothing private is asked for. Two GraphQL queries: the user, the past year
 * and the public repos (100 per page, at most MAX_PAGES pages), then one aliased
 * contributionsCollection per contribution year. Answers are cached per login for
 * 10 minutes, and each IP is limited by the optional PROFILE_LIMIT binding.
 */

import type { ProfileData, ProfileRepo } from '../../src/collect/profile';
import type { Env } from './index';
import { USER, type Deps } from './proxy';

const ENDPOINT = 'https://api.github.com/graphql';
const LOGIN = new RegExp(`^/profile/(${USER})$`);
/** Repo pages fetched at most; beyond that the answer holds what was fetched. */
const MAX_PAGES = 5;
const CACHE_SECONDS = 600;
const CORS = { 'access-control-allow-origin': '*' };

const USER_FIELDS = `
    login
    name
    createdAt
    followers { totalCount }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      totalPullRequestReviewContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { contributionCount } }
      }
      contributionYears
    }`;

const REPOS_FIELDS = `
    repositories(
      first: 100
      after: $after
      ownerAffiliations: [OWNER]
      privacy: PUBLIC
      orderBy: { field: CREATED_AT, direction: ASC }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        isFork
        isPrivate
        stargazerCount
        forkCount
        primaryLanguage { name }
        languages(first: 20, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }`;

/** The first page: the user, the past year and the first 100 public repos. */
const FIRST_QUERY = `query($login: String!, $after: String) {
  user(login: $login) {${USER_FIELDS}${REPOS_FIELDS}
  }
}`;

/** Later pages: the repos alone. */
const MORE_REPOS_QUERY = `query($login: String!, $after: String) {
  user(login: $login) {${REPOS_FIELDS}
  }
}`;

/** One aliased `y<year>` contributionsCollection per year, for all-time. */
function yearsQuery(years: number[]): string {
  const fields = years.map(
    (y) =>
      `    y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") {\n` +
      '      contributionCalendar { totalContributions }\n' +
      '      restrictedContributionsCount\n' +
      '    }',
  );
  return `query($login: String!) {\n  user(login: $login) {\n${fields.join('\n')}\n  }\n}`;
}

interface RepoNode {
  name: string;
  isFork: boolean;
  isPrivate: boolean;
  stargazerCount: number;
  forkCount: number;
  primaryLanguage: { name: string } | null;
  languages: { edges: { size: number; node: { name: string; color: string | null } }[] } | null;
}

interface ReposConnection {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: RepoNode[];
}

interface UserNode {
  login: string;
  name: string | null;
  createdAt: string;
  followers: { totalCount: number };
  contributionsCollection: {
    totalCommitContributions: number;
    totalPullRequestContributions: number;
    totalIssueContributions: number;
    totalPullRequestReviewContributions: number;
    restrictedContributionsCount: number;
    contributionCalendar: {
      totalContributions: number;
      weeks: { contributionDays: { contributionCount: number }[] }[];
    };
    contributionYears: number[];
  };
  repositories: ReposConnection;
}

interface YearNode {
  contributionCalendar: { totalContributions: number };
  restrictedContributionsCount: number;
}

/** Why a request ended early; each maps to one status. */
class Stop extends Error {
  constructor(readonly status: 404 | 429 | 502) {
    super(String(status));
  }
}

function json(body: unknown, status: number, cache = false): Response {
  return Response.json(body, {
    status,
    headers: { ...CORS, 'cache-control': cache ? `max-age=${CACHE_SECONDS}` : 'no-store' },
  });
}

/** Handles `/profile/<login>`; `request.url`'s path starts with `/profile/`. */
export async function profile(
  request: Request,
  env: Pick<Env, 'GITHUB_TOKEN' | 'PROFILE_LIMIT'>,
  deps: Deps = {},
): Promise<Response> {
  const url = new URL(request.url);
  const login = LOGIN.exec(url.pathname)?.[1];
  if (!login) return json({ error: 'invalid username' }, 400);
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS,
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'Accept',
        'access-control-max-age': '86400',
      },
    });
  }
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: { ...CORS, allow: 'GET, OPTIONS' } });
  }
  if (!env.GITHUB_TOKEN) return json({ error: 'not configured' }, 503);
  if (env.PROFILE_LIMIT) {
    const { success } = await env.PROFILE_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' });
    if (!success) return json({ error: 'rate limited' }, 429);
  }

  // GitHub logins are case-insensitive: one entry per user.
  const cache = deps.cache ?? caches.default;
  const key = new Request(`${url.origin}/profile/${login.toLowerCase()}`);
  const hit = await cache.match(key);
  if (hit) return hit;

  const query = graphql(env.GITHUB_TOKEN, deps.fetch ?? fetch);
  let response: Response;
  try {
    response = json(await fetchProfile(query, login), 200, true);
  } catch (error) {
    if (!(error instanceof Stop)) return json({ error: 'bad answer from GitHub' }, 502);
    if (error.status === 404) response = json({ error: 'no such user' }, 404, true);
    else if (error.status === 429) return json({ error: 'GitHub rate limit' }, 429);
    else return json({ error: 'GitHub unavailable' }, 502);
  }
  await cache.put(key, response.clone());
  return response;
}

type Query = <T>(query: string, variables: Record<string, unknown>) => Promise<T>;

/** POSTs one query; throws `Stop` for anything but data with a user in it. */
function graphql(token: string, fetcher: typeof fetch): Query {
  return async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
    let res: Response;
    try {
      res = await fetcher(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'user-agent': 'better-github-profile-usage',
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch {
      throw new Stop(502);
    }
    if (res.status === 403 || res.status === 429) throw new Stop(429);
    if (!res.ok) throw new Stop(502);
    let body: { data?: { user?: T | null } | null; errors?: { type?: string }[] };
    try {
      body = await res.json();
    } catch {
      throw new Stop(502);
    }
    if (body.errors?.some((e) => e.type === 'RATE_LIMITED')) throw new Stop(429);
    if (body.data?.user === null) throw new Stop(404);
    if (body.errors?.length || !body.data?.user) throw new Stop(502);
    return body.data.user;
  };
}

async function fetchProfile(query: Query, login: string): Promise<ProfileData> {
  const user = await query<UserNode>(FIRST_QUERY, { login, after: null });
  const cc = user.contributionsCollection;

  const nodes = [...user.repositories.nodes];
  let page = user.repositories.pageInfo;
  for (let pages = 1; page.hasNextPage && page.endCursor && pages < MAX_PAGES; pages++) {
    const more = await query<{ repositories: ReposConnection }>(MORE_REPOS_QUERY, { login, after: page.endCursor });
    nodes.push(...more.repositories.nodes);
    page = more.repositories.pageInfo;
  }

  const years = cc.contributionYears.filter((y) => Number.isInteger(y));
  const totals = years.length ? await query<Record<string, YearNode>>(yearsQuery(years), { login }) : {};

  return {
    user: { login: user.login, name: user.name, createdAt: user.createdAt, followers: user.followers.totalCount },
    pastYear: {
      total: cc.contributionCalendar.totalContributions,
      restricted: cc.restrictedContributionsCount,
      commits: cc.totalCommitContributions,
      pullRequests: cc.totalPullRequestContributions,
      issues: cc.totalIssueContributions,
      reviews: cc.totalPullRequestReviewContributions,
      weeks: cc.contributionCalendar.weeks.map((w) => sum(w.contributionDays.map((d) => d.contributionCount))),
    },
    years: years.map((year) => {
      const y = totals[`y${year}`];
      if (!y) throw new Stop(502);
      return { year, total: y.contributionCalendar.totalContributions, restricted: y.restrictedContributionsCount };
    }),
    repos: nodes.map(toRepo),
  };
}

function toRepo(r: RepoNode): ProfileRepo {
  return {
    name: r.name,
    isPrivate: r.isPrivate,
    isFork: r.isFork,
    stars: r.stargazerCount,
    forks: r.forkCount,
    language: r.primaryLanguage?.name ?? null,
    languages: (r.languages?.edges ?? []).map(({ size, node }) => ({ name: node.name, color: node.color, bytes: size })),
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
