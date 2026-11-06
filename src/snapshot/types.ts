export const SCHEMA_VERSION = 1;

/**
 * Everything the cards are rendered from. Committed to the user's (often public) repo,
 * so private repositories appear only as aggregate counts, never by name.
 * Holds nothing that changes daily by itself, so unchanged data means no commit.
 */
export interface Snapshot {
  schemaVersion: 1;
  generatedAt: string; // ISO 8601
  user: { login: string; name: string | null; createdYear: number; followers: number };
  repos: {
    count: number;
    stars: number;
    forks: number;
    top: { name: string; stars: number; language: string | null }[]; // public repos only, max 6, stars desc
  };
  contributions: {
    allTime: number;
    pastYear: number;
    commits: number;
    pullRequests: number;
    issues: number;
    reviews: number;
    private: number;
  };
  calendar: { weeks: number[] }; // weekly totals, oldest→newest (usually 53; never assume a fixed length)
  languages: { name: string; color: string | null; bytes: number }[]; // bytes desc
}

export type ThemeName = 'native' | 'strip';
export type Mode = 'light' | 'dark';

type Rec = Record<string, unknown>;

const isObj = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isStrOrNull = (x: unknown): x is string | null => x === null || isStr(x);
const allNums = (o: Rec, keys: string[]) => keys.every((k) => isNum(o[k]));
const arrayOf = (x: unknown, ok: (e: unknown) => boolean) => Array.isArray(x) && x.every(ok);

const isTopRepo = (x: unknown) =>
  isObj(x) && isStr(x.name) && isNum(x.stars) && isStrOrNull(x.language);

const isLanguage = (x: unknown) =>
  isObj(x) && isStr(x.name) && isStrOrNull(x.color) && isNum(x.bytes);

/** Structural check: every field present with the right type, and `schemaVersion === 1`. */
export function validateSnapshot(x: unknown): x is Snapshot {
  if (!isObj(x) || x.schemaVersion !== SCHEMA_VERSION || !isStr(x.generatedAt)) return false;
  const { user, repos, contributions, calendar, languages } = x;
  return (
    isObj(user) &&
    isStr(user.login) &&
    isStrOrNull(user.name) &&
    allNums(user, ['createdYear', 'followers']) &&
    isObj(repos) &&
    allNums(repos, ['count', 'stars', 'forks']) &&
    arrayOf(repos.top, isTopRepo) &&
    isObj(contributions) &&
    allNums(contributions, ['allTime', 'pastYear', 'commits', 'pullRequests', 'issues', 'reviews', 'private']) &&
    isObj(calendar) &&
    arrayOf(calendar.weeks, isNum) &&
    arrayOf(languages, isLanguage)
  );
}
