import { describe, expect, it, vi } from 'vitest';
import { collectSnapshot, type CollectOptions } from '../src/collect/collect';
import type { Fetch } from '../src/collect/graphql';
import { validateSnapshot, type Snapshot } from '../src/snapshot/types';
import page1 from './fixtures/graphql/repos-page1.json';
import page2 from './fixtures/graphql/repos-page2.json';
import userJson from './fixtures/graphql/user.json';
import year2021 from './fixtures/graphql/year-2021.json';
import year2022 from './fixtures/graphql/year-2022.json';
import year2023 from './fixtures/graphql/year-2023.json';
import year2024 from './fixtures/graphql/year-2024.json';
import year2025 from './fixtures/graphql/year-2025.json';
import year2026 from './fixtures/graphql/year-2026.json';
import castaJson from './fixtures/snapshot-casta-mere.json';

const casta = castaJson as Snapshot;

const YEARS: Record<string, typeof year2021> = {
  '2021': year2021,
  '2022': year2022,
  '2023': year2023,
  '2024': year2024,
  '2025': year2025,
  '2026': year2026,
};
const yearTotals = Object.values(YEARS).map((y) => y.data.viewer.contributionsCollection);
const ALL_TIME = yearTotals.reduce((a, y) => a + y.contributionCalendar.totalContributions, 0);
const ALL_TIME_RESTRICTED = yearTotals.reduce((a, y) => a + y.restrictedContributionsCount, 0);

const viewer = userJson.data.viewer;
const PAST_YEAR = viewer.contributionsCollection.contributionCalendar.totalContributions;
const PAST_YEAR_RESTRICTED = viewer.contributionsCollection.restrictedContributionsCount;

/** Repo nodes don't carry `isFork`, so the fake server knows the fixture's one fork by name. */
const FORKS = new Set(['upstream-fork']);
/** The most-starred repo in the fixtures (50★), and private. */
const PRIVATE_TOP = 'stealth-startup';
const allNodes = [...page1.data.viewer.repositories.nodes, ...page2.data.viewer.repositories.nodes];
const ownNodes = allNodes.filter((n) => !FORKS.has(n.name));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

type Vars = Record<string, unknown>;
interface Call {
  query: string;
  variables: Vars;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * A fake api.github.com/graphql that routes by query text and variables to the recorded
 * fixtures, and applies `isFork: false` / `privacy: PUBLIC` the way GitHub does.
 * Unknown requests get a 400, which the client does not retry.
 */
function fakeGitHub(patchViewer: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const route = (query: string, v: Vars): unknown => {
    if (query.includes('contributionYears')) {
      return { data: { viewer: { ...viewer, ...patchViewer } } };
    }
    if (query.includes('repositories(')) {
      const page = v.after == null ? page1 : v.after === page1.data.viewer.repositories.pageInfo.endCursor ? page2 : null;
      if (!page) return null;
      const conn = page.data.viewer.repositories;
      const nodes = conn.nodes.filter(
        (n) => !(v.isFork === false && FORKS.has(n.name)) && !(v.privacy === 'PUBLIC' && n.isPrivate),
      );
      return { data: { viewer: { repositories: { ...conn, nodes } } } };
    }
    if (/contributionsCollection\s*\(\s*from:/.test(query)) {
      return YEARS[String(v.from).slice(0, 4)] ?? null;
    }
    return null;
  };
  const fetch = vi.fn<Fetch>(async (_url, init) => {
    const { query, variables = {} } = JSON.parse(String(init?.body)) as Partial<Call> & { query: string };
    calls.push({ query, variables });
    const body = route(query, variables);
    return body ? json(200, body) : json(400, { message: `fake GitHub: no route for ${JSON.stringify(variables)}` });
  });
  const isRepos = (c: Call) => c.query.includes('repositories(');
  const isYear = (c: Call) => /contributionsCollection\s*\(\s*from:/.test(c.query);
  return { fetch, calls, reposCalls: () => calls.filter(isRepos), yearCalls: () => calls.filter(isYear) };
}

const NOW = new Date('2026-11-06T03:17:00.000Z');

async function collect(overrides: Partial<CollectOptions> = {}, patchViewer?: Record<string, unknown>) {
  const gh = fakeGitHub(patchViewer);
  const s = await collectSnapshot({
    token: 'tok',
    includePrivate: true,
    includeForks: false,
    excludeRepos: [],
    excludeLangs: [],
    now: () => NOW,
    fetch: gh.fetch,
    ...overrides,
  });
  return { s, ...gh };
}

const bytesOf = (s: Snapshot, lang: string) => s.languages.find((l) => l.name === lang)?.bytes;

describe('collectSnapshot', () => {
  it('builds the snapshot', async () => {
    const { s } = await collect();
    expect(validateSnapshot(s)).toBe(true);
    expect(s.schemaVersion).toBe(1);
    expect(s.generatedAt).toBe(NOW.toISOString());
    expect(s.user).toEqual({ login: 'Casta-mere', name: 'Castamere', createdYear: 2021, followers: 22 });
    expect(s.repos.count).toBe(ownNodes.length);
    expect(s.repos.stars).toBe(sum(ownNodes.map((n) => n.stargazerCount)));
    expect(s.repos.forks).toBe(sum(ownNodes.map((n) => n.forkCount)));
    expect(s.contributions).toEqual({
      allTime: ALL_TIME,
      pastYear: PAST_YEAR,
      commits: 419,
      pullRequests: 3,
      issues: 2,
      reviews: 0,
      private: PAST_YEAR_RESTRICTED,
    });
    expect(s.calendar.weeks).toHaveLength(53);
    expect(s.languages.map((l) => l.bytes)).toEqual([...s.languages.map((l) => l.bytes)].sort((a, b) => b - a));
  });

  it('weekly totals are the sum of each week\'s days, oldest first', async () => {
    const { s } = await collect();
    const weeks = viewer.contributionsCollection.contributionCalendar.weeks;
    expect(s.calendar.weeks).toEqual(weeks.map((w) => sum(w.contributionDays.map((d) => d.contributionCount))));
    // The same weekly totals the Casta-mere snapshot fixture was built from.
    expect(s.calendar.weeks).toEqual(casta.calendar.weeks);
  });

  it('emits keys in Snapshot order, so sameContent can compare with JSON.stringify', async () => {
    const { s } = await collect();
    expect(Object.keys(s)).toEqual(['schemaVersion', 'generatedAt', 'user', 'repos', 'contributions', 'calendar', 'languages']);
    expect(Object.keys(s.user)).toEqual(Object.keys(casta.user));
    expect(Object.keys(s.repos)).toEqual(Object.keys(casta.repos));
    expect(Object.keys(s.repos.top[0])).toEqual(Object.keys(casta.repos.top[0]));
    expect(Object.keys(s.contributions)).toEqual(Object.keys(casta.contributions));
    expect(Object.keys(s.calendar)).toEqual(Object.keys(casta.calendar));
    expect(Object.keys(s.languages[0])).toEqual(Object.keys(casta.languages[0]));
  });

  it('pages through more than 100 repos', async () => {
    const { s, reposCalls } = await collect();
    const calls = reposCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0].variables.after ?? null).toBeNull();
    expect(calls[1].variables.after).toBe(page1.data.viewer.repositories.pageInfo.endCursor);
    expect(calls[0].query).toMatch(/first:\s*100/);
    // Both pages counted: page 2 holds Safehome, which also brings in SCSS.
    expect(s.repos.count).toBe(ownNodes.length);
    expect(s.repos.top.map((r) => r.name)).toContain('Safehome');
    expect(bytesOf(s, 'SCSS')).toBe(20858);
  });

  it('never puts private repo names in top, even the most-starred', async () => {
    const { s } = await collect();
    const privateTop = allNodes.find((n) => n.name === PRIVATE_TOP)!;
    expect(privateTop.isPrivate).toBe(true);
    expect(Math.max(...allNodes.map((n) => n.stargazerCount))).toBe(privateTop.stargazerCount);
    expect(s.repos.stars).toBeGreaterThanOrEqual(privateTop.stargazerCount);
    expect(s.repos.top.map((r) => r.name)).not.toContain(PRIVATE_TOP);
    // Not anywhere in the snapshot, which may be committed to a public repo.
    for (const n of allNodes.filter((r) => r.isPrivate)) expect(JSON.stringify(s)).not.toContain(n.name);
    // Its language bytes still count when private work is included.
    expect(bytesOf(s, 'Python')).toBe(66103 + 90000 + 20834 + 71545);
  });

  it('sums all-time across every contribution year', async () => {
    const { s, yearCalls } = await collect();
    expect(s.contributions.allTime).toBe(ALL_TIME);
    const calls = yearCalls();
    expect(calls.map((c) => c.variables.from).sort()).toEqual(
      viewer.contributionsCollection.contributionYears.map((y) => `${y}-01-01T00:00:00Z`).sort(),
    );
    for (const c of calls) {
      expect(c.variables.to).toBe(`${String(c.variables.from).slice(0, 4)}-12-31T23:59:59Z`);
    }
  });

  it('includePrivate=false: subtracts restricted counts and queries PUBLIC repos', async () => {
    const { s, reposCalls } = await collect({ includePrivate: false });
    expect(s.contributions.private).toBe(0);
    expect(s.contributions.allTime).toBe(ALL_TIME - ALL_TIME_RESTRICTED);
    expect(s.contributions.pastYear).toBe(PAST_YEAR - PAST_YEAR_RESTRICTED);
    for (const c of reposCalls()) expect(c.variables.privacy).toBe('PUBLIC');
    const publicOwn = ownNodes.filter((n) => !n.isPrivate);
    expect(s.repos.count).toBe(publicOwn.length);
    expect(s.repos.stars).toBe(sum(publicOwn.map((n) => n.stargazerCount)));
    // Weekly totals can't be split by visibility, so they stay as GitHub returns them.
    expect(s.calendar.weeks).toEqual(casta.calendar.weeks);
  });

  it('includePrivate=true does not send privacy', async () => {
    const { reposCalls } = await collect();
    for (const c of reposCalls()) expect(c.variables).not.toHaveProperty('privacy');
  });

  it('includeForks=true omits isFork instead of sending true', async () => {
    const { s, reposCalls } = await collect({ includeForks: true });
    for (const c of reposCalls()) expect(c.variables).not.toHaveProperty('isFork');
    expect(s.repos.count).toBe(allNodes.length);
    expect(s.repos.top[0].name).toBe('upstream-fork');
  });

  it('includeForks=false sends isFork: false', async () => {
    const { s, reposCalls } = await collect();
    for (const c of reposCalls()) expect(c.variables.isFork).toBe(false);
    expect(s.repos.top.map((r) => r.name)).not.toContain('upstream-fork');
  });

  it('applies excludeRepos (case-insensitive) and excludeLangs', async () => {
    const { s: base } = await collect();
    const { s } = await collect({ excludeRepos: ['read-book'], excludeLangs: ['html'] });
    expect(s.repos.count).toBe(base.repos.count - 1);
    expect(s.repos.stars).toBe(base.repos.stars - 4);
    expect(s.repos.forks).toBe(base.repos.forks - 2);
    expect(s.repos.top.map((r) => r.name)).not.toContain('Read-Book');
    expect(bytesOf(s, 'TeX')).toBe(bytesOf(base, 'TeX')! - 115358);
    expect(bytesOf(s, 'Python')).toBe(bytesOf(base, 'Python')! - 66103);
    expect(s.languages.map((l) => l.name)).not.toContain('HTML');
    expect(base.languages.map((l) => l.name)).toContain('HTML');
  });

  it('top is at most 6 entries, stars desc', async () => {
    const { s } = await collect();
    expect(ownNodes.filter((n) => !n.isPrivate).length).toBeGreaterThan(6);
    expect(s.repos.top).toHaveLength(6);
    const stars = s.repos.top.map((r) => r.stars);
    expect(stars).toEqual([...stars].sort((a, b) => b - a));
    expect(s.repos.top).toEqual(casta.repos.top);
  });

  it('keeps a null language color', async () => {
    const { s } = await collect();
    expect(s.languages.find((l) => l.name === 'Pod')).toEqual({ name: 'Pod', color: null, bytes: 1580 });
  });

  it('fails instead of looping when GitHub reports another page without a cursor', async () => {
    const gh = fakeGitHub();
    const noCursor = { data: { viewer: { repositories: { pageInfo: { hasNextPage: true, endCursor: null }, nodes: [] } } } };
    const fetch = vi.fn<Fetch>(async (url, init) =>
      String(init?.body).includes('repositories(') ? json(200, noCursor) : gh.fetch(url, init),
    );
    await expect(collect({ fetch })).rejects.toThrow('cursor');
    expect(fetch.mock.calls.filter(([, init]) => String(init?.body).includes('repositories('))).toHaveLength(1);
  });

  it('treats an empty display name as missing', async () => {
    const { s } = await collect({}, { name: '' });
    expect(s.user.name).toBeNull();
  });
});
