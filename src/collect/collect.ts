import type { Snapshot } from '../snapshot/types';
import { graphql, type Fetch } from './graphql';
import { aggregate, type ProfileData, type ProfileRepo } from './profile';
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

type Query = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

/**
 * Fetch everything the cards need, map it to `ProfileData` and `aggregate` it into a
 * `Snapshot`. Private repos count only toward totals: their names never reach the
 * snapshot. Any request failure rejects.
 */
export async function collectSnapshot(opts: CollectOptions): Promise<Snapshot> {
  const now = opts.now ?? (() => new Date());
  const query: Query = (q, variables) => graphql({ token: opts.token, query: q, variables, fetch: opts.fetch });

  const { viewer } = await query<UserResponse>(USER_QUERY);
  const cc = viewer.contributionsCollection;
  const repos = await fetchRepos(query, opts);

  const years: ProfileData['years'] = [];
  // One at a time: GitHub asks clients not to send concurrent requests.
  for (const year of cc.contributionYears) {
    const { viewer: y } = await query<YearResponse>(YEAR_QUERY, {
      from: `${year}-01-01T00:00:00Z`,
      to: `${year}-12-31T23:59:59Z`,
    });
    const yc = y.contributionsCollection;
    years.push({ year, total: yc.contributionCalendar.totalContributions, restricted: yc.restrictedContributionsCount });
  }

  const profile: ProfileData = {
    user: { login: viewer.login, name: viewer.name, createdAt: viewer.createdAt, followers: viewer.followers.totalCount },
    pastYear: {
      total: cc.contributionCalendar.totalContributions,
      restricted: cc.restrictedContributionsCount,
      commits: cc.totalCommitContributions,
      pullRequests: cc.totalPullRequestContributions,
      issues: cc.totalIssueContributions,
      reviews: cc.totalPullRequestReviewContributions,
      weeks: cc.contributionCalendar.weeks.map((w) => sum(w.contributionDays.map((d) => d.contributionCount))),
    },
    years,
    repos: repos.map(toProfileRepo),
  };
  return aggregate(profile, opts, now());
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

function toProfileRepo(r: RepoNode): ProfileRepo {
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
