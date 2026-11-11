import type { Snapshot } from '../snapshot/types';
import { fmtCompact } from './svg';
import type { Theme } from './theme';

/**
 * Every number a card can show, in the order the selector page lists them. These keys
 * are the public names used by the Action's `stats` input: never rename one.
 */
export const STAT_KEYS = [
  'stars',
  'forks',
  'allTime',
  'pastYear',
  'repos',
  'followers',
  'commits',
  'pullRequests',
  'issues',
  'reviews',
  'private',
  'joined',
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

export type StatIcon = 'star' | 'fork' | 'commit' | 'clock' | 'repo' | 'people' | 'code' | 'pr' | 'issue' | 'eye' | 'lock' | 'calendar';

export interface StatDef {
  /** Row label on the native card. */
  label: string;
  /** Label in the strip pill; after the number unless `labelFirst`. */
  short: string;
  labelFirst?: boolean;
  /** Native row icon. */
  icon: StatIcon;
  value(s: Snapshot): number;
  /** Shown as is, never compacted (a year). */
  raw?: boolean;
}

export const STATS: Record<StatKey, StatDef> = {
  stars: { label: 'Stars', short: '★', labelFirst: true, icon: 'star', value: (s) => s.repos.stars },
  forks: { label: 'Forks', short: 'forks', icon: 'fork', value: (s) => s.repos.forks },
  allTime: { label: 'All-time contributions', short: 'contributions', icon: 'commit', value: (s) => s.contributions.allTime },
  pastYear: { label: 'Contributions (past year)', short: 'past year', icon: 'clock', value: (s) => s.contributions.pastYear },
  repos: { label: 'Repositories', short: 'repos', icon: 'repo', value: (s) => s.repos.count },
  followers: { label: 'Followers', short: 'followers', icon: 'people', value: (s) => s.user.followers },
  commits: { label: 'Commits (past year)', short: 'commits', icon: 'code', value: (s) => s.contributions.commits },
  pullRequests: { label: 'Pull requests (past year)', short: 'PRs', icon: 'pr', value: (s) => s.contributions.pullRequests },
  issues: { label: 'Issues (past year)', short: 'issues', icon: 'issue', value: (s) => s.contributions.issues },
  reviews: { label: 'Reviews (past year)', short: 'reviews', icon: 'eye', value: (s) => s.contributions.reviews },
  private: { label: 'Private contributions', short: 'private', icon: 'lock', value: (s) => s.contributions.private },
  joined: { label: 'On GitHub since', short: 'since', labelFirst: true, icon: 'calendar', value: (s) => s.user.createdYear, raw: true },
};

/** A stat's value as the cards print it: `795`, `2.4k`, or `2021` for a raw one. */
export function statValue(def: StatDef, s: Snapshot): string {
  const v = def.value(s);
  return def.raw ? String(v) : fmtCompact(v);
}

const isStatKey = (k: string): k is StatKey => (STAT_KEYS as readonly string[]).includes(k);

/**
 * Checks a user's stat list against a theme: known keys, each once, within the theme's
 * cap. An empty list means the theme's default.
 */
export function checkStats(theme: Pick<Theme, 'name' | 'defaultStats' | 'maxStats'>, keys: string[]): StatKey[] {
  if (keys.length === 0) return [...theme.defaultStats];
  const seen = new Set<StatKey>();
  for (const k of keys) {
    if (!isStatKey(k)) throw new Error(`Unknown stat "${k}"; available: ${STAT_KEYS.join(', ')}`);
    if (seen.has(k)) throw new Error(`Stat "${k}" is listed twice`);
    seen.add(k);
  }
  if (seen.size > theme.maxStats)
    throw new Error(`Theme "${theme.name}" shows at most ${theme.maxStats} stats, got ${seen.size}`);
  return [...seen];
}
