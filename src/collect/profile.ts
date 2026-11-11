import type { Snapshot } from '../snapshot/types';

/**
 * Per-repo data and contribution figures, before any of the user's options are applied.
 * The Action builds it from its own queries; the selector page gets it from the Worker
 * (public data only) or its bundled sample. Both turn it into a `Snapshot` with `aggregate`,
 * so the preview and the real card agree for the same data and options.
 * Pure: no DOM or Node-only code.
 */
export interface ProfileRepo {
  name: string;
  isPrivate: boolean;
  isFork: boolean;
  stars: number;
  forks: number;
  language: string | null;
  languages: { name: string; color: string | null; bytes: number }[];
}

export interface ProfileData {
  user: { login: string; name: string | null; createdAt: string; followers: number };
  /** GitHub's rolling past year. `weeks` holds weekly totals, oldest first. */
  pastYear: { total: number; restricted: number; commits: number; pullRequests: number; issues: number; reviews: number; weeks: number[] };
  /** One entry per contribution year, for all-time. */
  years: { year: number; total: number; restricted: number }[];
  repos: ProfileRepo[];
}

export interface AggregateOptions {
  includePrivate: boolean;
  includeForks: boolean;
  /** Repo names, matched case-insensitively. */
  excludeRepos: string[];
  /** Language names, matched case-insensitively. */
  excludeLangs: string[];
}

const TOP_REPOS = 6;

/**
 * Apply the options and compute the snapshot. Private repos count only toward totals:
 * their names never reach the snapshot.
 */
export function aggregate(p: ProfileData, o: AggregateOptions, now: Date): Snapshot {
  const excluded = lowerSet(o.excludeRepos);
  const repos = p.repos.filter(
    (r) =>
      (o.includeForks || !r.isFork) && (o.includePrivate || !r.isPrivate) && !excluded.has(r.name.toLowerCase()),
  );

  // Without private work, take out what the token can't see. This removes private
  // contributions only for a read:user token; see the README's privacy section.
  const visible = (total: number, restricted: number) => (o.includePrivate ? total : Math.max(0, total - restricted));

  // Literal key order matches the Snapshot interface: sameContent compares JSON strings.
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    user: {
      login: p.user.login,
      name: p.user.name?.trim() ? p.user.name : null,
      createdYear: new Date(p.user.createdAt).getUTCFullYear(),
      followers: p.user.followers,
    },
    repos: {
      count: repos.length,
      stars: sum(repos.map((r) => r.stars)),
      forks: sum(repos.map((r) => r.forks)),
      top: topRepos(repos),
    },
    contributions: {
      allTime: sum(p.years.map((y) => visible(y.total, y.restricted))),
      pastYear: visible(p.pastYear.total, p.pastYear.restricted),
      commits: p.pastYear.commits,
      pullRequests: p.pastYear.pullRequests,
      issues: p.pastYear.issues,
      reviews: p.pastYear.reviews,
      private: o.includePrivate ? p.pastYear.restricted : 0,
    },
    calendar: { weeks: [...p.pastYear.weeks] },
    languages: languageTotals(repos, lowerSet(o.excludeLangs)),
  };
}

/** Public repos only, stars desc; ties keep the input (created-at) order. */
function topRepos(repos: ProfileRepo[]): Snapshot['repos']['top'] {
  return repos
    .filter((r) => !r.isPrivate)
    .sort((a, b) => b.stars - a.stars)
    .slice(0, TOP_REPOS)
    .map((r) => ({ name: r.name, stars: r.stars, language: r.language }));
}

/** Bytes per language across all repos, bytes desc (name asc on ties, for a stable order). */
function languageTotals(repos: ProfileRepo[], excluded: Set<string>): Snapshot['languages'] {
  const totals = new Map<string, { name: string; color: string | null; bytes: number }>();
  for (const repo of repos) {
    for (const { name, color, bytes } of repo.languages) {
      if (excluded.has(name.toLowerCase())) continue;
      const entry = totals.get(name);
      if (!entry) totals.set(name, { name, color, bytes });
      else {
        entry.bytes += bytes;
        entry.color ??= color;
      }
    }
  }
  return [...totals.values()].sort((a, b) => b.bytes - a.bytes || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const lowerSet = (xs: string[]) => new Set(xs.map((x) => x.toLowerCase()));

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

type Rec = Record<string, unknown>;

const isObj = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isBool = (x: unknown): x is boolean => typeof x === 'boolean';
const isStrOrNull = (x: unknown): x is string | null => x === null || isStr(x);
const allNums = (o: Rec, keys: string[]) => keys.every((k) => isNum(o[k]));
const arrayOf = (x: unknown, ok: (e: unknown) => boolean) => Array.isArray(x) && x.every(ok);

const isLanguage = (x: unknown) => isObj(x) && isStr(x.name) && isStrOrNull(x.color) && isNum(x.bytes);

const isRepo = (x: unknown) =>
  isObj(x) &&
  isStr(x.name) &&
  isBool(x.isPrivate) &&
  isBool(x.isFork) &&
  allNums(x, ['stars', 'forks']) &&
  isStrOrNull(x.language) &&
  arrayOf(x.languages, isLanguage);

const isYear = (x: unknown) => isObj(x) && allNums(x, ['year', 'total', 'restricted']);

/** Structural check of data from the network or storage: every field present with the right type. */
export function validateProfileData(x: unknown): x is ProfileData {
  if (!isObj(x)) return false;
  const { user, pastYear, years, repos } = x;
  return (
    isObj(user) &&
    isStr(user.login) &&
    isStrOrNull(user.name) &&
    isStr(user.createdAt) &&
    isNum(user.followers) &&
    isObj(pastYear) &&
    allNums(pastYear, ['total', 'restricted', 'commits', 'pullRequests', 'issues', 'reviews']) &&
    arrayOf(pastYear.weeks, isNum) &&
    arrayOf(years, isYear) &&
    arrayOf(repos, isRepo)
  );
}
