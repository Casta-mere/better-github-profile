import { describe, expect, it } from 'vitest';
import { aggregate, validateProfileData, type AggregateOptions, type ProfileData, type ProfileRepo } from '../src/collect/profile';
import { validateSnapshot } from '../src/snapshot/types';

const NOW = new Date('2026-11-11T00:00:00.000Z');

const repo = (r: Partial<ProfileRepo> & { name: string }): ProfileRepo => ({
  isPrivate: false,
  isFork: false,
  stars: 0,
  forks: 0,
  language: null,
  languages: [],
  ...r,
});

/** Made-up data: one fork, one private repo (the most-starred), and a few public ones. */
const PROFILE: ProfileData = {
  user: { login: 'octo', name: 'Octo Cat', createdAt: '2019-03-02T10:00:00Z', followers: 7 },
  pastYear: { total: 120, restricted: 20, commits: 80, pullRequests: 5, issues: 3, reviews: 2, weeks: [1, 0, 4, 115] },
  years: [
    { year: 2025, total: 300, restricted: 50 },
    { year: 2026, total: 100, restricted: 10 },
  ],
  repos: [
    repo({ name: 'foo', stars: 3, forks: 1, language: 'Go', languages: [{ name: 'Go', color: '#00ADD8', bytes: 1000 }] }),
    repo({
      name: 'bar',
      stars: 10,
      forks: 2,
      language: 'TypeScript',
      languages: [
        { name: 'TypeScript', color: '#3178c6', bytes: 5000 },
        { name: 'CSS', color: '#663399', bytes: 300 },
      ],
    }),
    repo({ name: 'forked-lib', isFork: true, stars: 40, forks: 9, language: 'C', languages: [{ name: 'C', color: '#555555', bytes: 9000 }] }),
    repo({ name: 'secret-thing', isPrivate: true, stars: 99, forks: 4, language: 'Go', languages: [{ name: 'Go', color: '#00ADD8', bytes: 2000 }] }),
  ],
};

const OPTS: AggregateOptions = { includePrivate: true, includeForks: false, excludeRepos: [], excludeLangs: [] };
const run = (o: Partial<AggregateOptions> = {}) => aggregate(PROFILE, { ...OPTS, ...o }, NOW);

describe('aggregate', () => {
  it('builds a valid snapshot', () => {
    const s = run();
    expect(validateSnapshot(s)).toBe(true);
    expect(s.generatedAt).toBe(NOW.toISOString());
    expect(s.user).toEqual({ login: 'octo', name: 'Octo Cat', createdYear: 2019, followers: 7 });
    expect(s.calendar.weeks).toEqual([1, 0, 4, 115]);
    expect(s.contributions).toEqual({ allTime: 400, pastYear: 120, commits: 80, pullRequests: 5, issues: 3, reviews: 2, private: 20 });
  });

  it('drops forks unless includeForks', () => {
    expect(run().repos.top.map((r) => r.name)).not.toContain('forked-lib');
    expect(run().repos.count).toBe(3);
    const s = run({ includeForks: true });
    expect(s.repos.count).toBe(4);
    expect(s.repos.top[0].name).toBe('forked-lib');
    expect(s.languages.map((l) => l.name)).toContain('C');
  });

  it('drops private repos and private contributions unless includePrivate', () => {
    const s = run({ includePrivate: false });
    expect(s.repos.count).toBe(2);
    expect(s.repos.stars).toBe(13);
    expect(s.repos.forks).toBe(3);
    expect(s.contributions.private).toBe(0);
    expect(s.contributions.pastYear).toBe(100);
    expect(s.contributions.allTime).toBe(400 - 60);
    expect(s.languages.find((l) => l.name === 'Go')?.bytes).toBe(1000);
  });

  it('counts private repos in totals but never names them', () => {
    const s = run();
    expect(s.repos.stars).toBe(112);
    expect(s.repos.top.map((r) => r.name)).toEqual(['bar', 'foo']);
    expect(JSON.stringify(s)).not.toContain('secret-thing');
    expect(s.languages.find((l) => l.name === 'Go')?.bytes).toBe(3000);
  });

  it('excludeRepos is case-insensitive', () => {
    const s = run({ excludeRepos: ['FOO'] });
    expect(s.repos.top.map((r) => r.name)).toEqual(['bar']);
    expect(s.repos.count).toBe(2);
  });

  it('excludeLangs drops a language from the totals', () => {
    const s = run({ excludeLangs: ['css'] });
    expect(s.languages.map((l) => l.name)).toEqual(['TypeScript', 'Go']);
  });

  it('orders languages by bytes, then name', () => {
    const tie: ProfileData = {
      ...PROFILE,
      repos: [repo({ name: 'x', languages: [{ name: 'Zig', color: null, bytes: 5 }, { name: 'Ada', color: null, bytes: 5 }] })],
    };
    expect(aggregate(tie, OPTS, NOW).languages.map((l) => l.name)).toEqual(['Ada', 'Zig']);
  });

  it('treats a blank name as missing', () => {
    const s = aggregate({ ...PROFILE, user: { ...PROFILE.user, name: '  ' } }, OPTS, NOW);
    expect(s.user.name).toBeNull();
  });

  it('keeps at most 6 top repos, stars desc', () => {
    const many: ProfileData = { ...PROFILE, repos: Array.from({ length: 9 }, (_, i) => repo({ name: `r${i}`, stars: i })) };
    expect(aggregate(many, OPTS, NOW).repos.top.map((r) => r.stars)).toEqual([8, 7, 6, 5, 4, 3]);
  });
});

describe('validateProfileData', () => {
  it('accepts a well-formed profile', () => {
    expect(validateProfileData(PROFILE)).toBe(true);
    expect(validateProfileData(JSON.parse(JSON.stringify(PROFILE)))).toBe(true);
  });

  it('rejects a repo with a string stars count', () => {
    const bad = { ...PROFILE, repos: [{ ...PROFILE.repos[0], stars: '3' }] };
    expect(validateProfileData(bad)).toBe(false);
  });

  it('rejects missing parts', () => {
    expect(validateProfileData(null)).toBe(false);
    expect(validateProfileData({ ...PROFILE, years: undefined })).toBe(false);
    expect(validateProfileData({ ...PROFILE, pastYear: { ...PROFILE.pastYear, weeks: ['1'] } })).toBe(false);
    expect(validateProfileData({ ...PROFILE, user: { ...PROFILE.user, name: 3 } })).toBe(false);
  });
});
