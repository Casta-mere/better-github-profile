import type { Snapshot } from '../snapshot/types';
import { graphql, type Fetch } from './graphql';
import {
  REPOS_QUERY,
  USER_QUERY,
  YEAR_QUERY,
  type RepoNode,
  type ReposResponse,
  type UserResponse,
  type YearResponse,
} from './queries';

export interface CollectOptions {
  token: string;
  includePrivate: boolean;
  includeForks: boolean;
  /** Repo names, matched case-insensitively. */
  excludeRepos: string[];
  /** Language names, matched case-insensitively. */
  excludeLangs: string[];
  now?: () => Date;
  fetch?: Fetch;
}

const TOP_REPOS = 6;

type Query = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

/**
 * Fetch everything the cards need and aggregate it into a `Snapshot`. Private repos count
 * only toward totals: their names never reach the snapshot. Any request failure rejects.
 */
export async function collectSnapshot(opts: CollectOptions): Promise<Snapshot> {
  const now = opts.now ?? (() => new Date());
  const query: Query = (q, variables) => graphql({ token: opts.token, query: q, variables, fetch: opts.fetch });

  const { viewer } = await query<UserResponse>(USER_QUERY);
  const cc = viewer.contributionsCollection;
  const excluded = lowerSet(opts.excludeRepos);
  const repos = (await fetchRepos(query, opts)).filter((r) => !excluded.has(r.name.toLowerCase()));

  // Without private work, take out what the token can't see. This removes private
  // contributions only for a read:user token; see the README's privacy section.
  const visible = (total: number, restricted: number) =>
    opts.includePrivate ? total : Math.max(0, total - restricted);

  let allTime = 0;
  // One at a time: GitHub asks clients not to send concurrent requests.
  for (const year of cc.contributionYears) {
    const { viewer: y } = await query<YearResponse>(YEAR_QUERY, {
      from: `${year}-01-01T00:00:00Z`,
      to: `${year}-12-31T23:59:59Z`,
    });
    const yc = y.contributionsCollection;
    allTime += visible(yc.contributionCalendar.totalContributions, yc.restrictedContributionsCount);
  }

  // Literal key order matches the Snapshot interface: sameContent compares JSON strings.
  return {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    user: {
      login: viewer.login,
      name: viewer.name?.trim() ? viewer.name : null,
      createdYear: new Date(viewer.createdAt).getUTCFullYear(),
      followers: viewer.followers.totalCount,
    },
    repos: {
      count: repos.length,
      stars: sum(repos.map((r) => r.stargazerCount)),
      forks: sum(repos.map((r) => r.forkCount)),
      top: topRepos(repos),
    },
    contributions: {
      allTime,
      pastYear: visible(cc.contributionCalendar.totalContributions, cc.restrictedContributionsCount),
      commits: cc.totalCommitContributions,
      pullRequests: cc.totalPullRequestContributions,
      issues: cc.totalIssueContributions,
      reviews: cc.totalPullRequestReviewContributions,
      private: opts.includePrivate ? cc.restrictedContributionsCount : 0,
    },
    calendar: {
      weeks: cc.contributionCalendar.weeks.map((w) => sum(w.contributionDays.map((d) => d.contributionCount))),
    },
    languages: languageTotals(repos, lowerSet(opts.excludeLangs)),
  };
}

async function fetchRepos(query: Query, opts: CollectOptions): Promise<RepoNode[]> {
  const nodes: RepoNode[] = [];
  let after: string | null = null;
  for (;;) {
    const variables: Record<string, unknown> = { after };
    if (!opts.includeForks) variables.isFork = false;
    if (!opts.includePrivate) variables.privacy = 'PUBLIC';
    const { viewer } = await query<ReposResponse>(REPOS_QUERY, variables);
    const { pageInfo, nodes: page } = viewer.repositories;
    nodes.push(...page);
    if (!pageInfo.hasNextPage) return nodes;
    if (!pageInfo.endCursor) throw new Error('GitHub reported more repositories but returned no page cursor');
    after = pageInfo.endCursor;
  }
}

/** Public repos only, stars desc; ties keep the API's created-at order. */
function topRepos(repos: RepoNode[]): Snapshot['repos']['top'] {
  return repos
    .filter((r) => !r.isPrivate)
    .sort((a, b) => b.stargazerCount - a.stargazerCount)
    .slice(0, TOP_REPOS)
    .map((r) => ({ name: r.name, stars: r.stargazerCount, language: r.primaryLanguage?.name ?? null }));
}

/** Bytes per language across all repos, bytes desc (name asc on ties, for a stable order). */
function languageTotals(repos: RepoNode[], excluded: Set<string>): Snapshot['languages'] {
  const totals = new Map<string, { name: string; color: string | null; bytes: number }>();
  for (const repo of repos) {
    for (const { size, node } of repo.languages?.edges ?? []) {
      if (excluded.has(node.name.toLowerCase())) continue;
      const entry = totals.get(node.name);
      if (!entry) totals.set(node.name, { name: node.name, color: node.color, bytes: size });
      else {
        entry.bytes += size;
        entry.color ??= node.color;
      }
    }
  }
  return [...totals.values()].sort((a, b) => b.bytes - a.bytes || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const lowerSet = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()));

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
