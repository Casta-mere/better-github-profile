/**
 * GraphQL queries, all on `viewer`. "Past year" is the calendar with no `from`/`to`:
 * GitHub's rolling window, the same as its own "N contributions in the last year".
 */

export const USER_QUERY = `query {
  viewer {
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
    }
  }
}`;

/**
 * Owned repos, 100 per page. `$isFork` and `$privacy` are left out of the variables when
 * they don't apply, which GraphQL treats as an omitted argument: `isFork: true` would
 * return only forks. Created-at order keeps paging stable and ties in the top list fixed.
 */
export const REPOS_QUERY = `query($after: String, $isFork: Boolean, $privacy: RepositoryPrivacy) {
  viewer {
    repositories(
      first: 100
      after: $after
      ownerAffiliations: [OWNER]
      isFork: $isFork
      privacy: $privacy
      orderBy: { field: CREATED_AT, direction: ASC }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        isPrivate
        stargazerCount
        forkCount
        primaryLanguage { name }
        languages(first: 20, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

/** One contribution year; `from`/`to` are `Y-01-01T00:00:00Z` and `Y-12-31T23:59:59Z`. */
export const YEAR_QUERY = `query($from: DateTime!, $to: DateTime!) {
  viewer {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar { totalContributions }
      restrictedContributionsCount
    }
  }
}`;

export interface UserResponse {
  viewer: {
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
  };
}

export interface RepoNode {
  name: string;
  isPrivate: boolean;
  stargazerCount: number;
  forkCount: number;
  primaryLanguage: { name: string } | null;
  languages: { edges: { size: number; node: { name: string; color: string | null } }[] } | null;
}

export interface ReposResponse {
  viewer: {
    repositories: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: RepoNode[];
    };
  };
}

export interface YearResponse {
  viewer: {
    contributionsCollection: {
      contributionCalendar: { totalContributions: number };
      restrictedContributionsCount: number;
    };
  };
}
