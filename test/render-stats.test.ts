import { describe, expect, it } from 'vitest';
import { checkStats, STAT_KEYS, STATS, THEMES } from '../src/render/index';
import type { Snapshot } from '../src/snapshot/types';
import castaJson from './fixtures/snapshot-casta-mere.json';

const casta = castaJson as Snapshot;

describe('stat registry', () => {
  it('has every public key, in order, with a definition each', () => {
    expect(STAT_KEYS).toEqual([
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
    ]);
    expect(Object.keys(STATS).sort()).toEqual([...STAT_KEYS].sort());
  });

  it('reads each value from the snapshot', () => {
    expect(STAT_KEYS.map((k) => STATS[k].value(casta))).toEqual([
      casta.repos.stars,
      casta.repos.forks,
      casta.contributions.allTime,
      casta.contributions.pastYear,
      casta.repos.count,
      casta.user.followers,
      casta.contributions.commits,
      casta.contributions.pullRequests,
      casta.contributions.issues,
      casta.contributions.reviews,
      casta.contributions.private,
      casta.user.createdYear,
    ]);
  });

  it('theme defaults and caps', () => {
    expect(THEMES.native.defaultStats).toEqual(['stars', 'forks', 'allTime', 'pastYear', 'repos']);
    expect(THEMES.strip.defaultStats).toEqual(['allTime', 'pastYear', 'repos', 'stars', 'followers']);
    expect(THEMES.native.maxStats).toBe(12);
    expect(THEMES.strip.maxStats).toBe(6);
  });
});

describe('checkStats', () => {
  it('empty list is the theme default (a copy)', () => {
    const got = checkStats(THEMES.native, []);
    expect(got).toEqual(THEMES.native.defaultStats);
    expect(got).not.toBe(THEMES.native.defaultStats);
    expect(checkStats(THEMES.strip, [])).toEqual(THEMES.strip.defaultStats);
  });

  it('keeps the given order', () => expect(checkStats(THEMES.native, ['joined', 'stars'])).toEqual(['joined', 'stars']));

  it('unknown stat lists the valid keys', () => {
    expect(() => checkStats(THEMES.native, ['nope'])).toThrow(/Unknown stat "nope"; available: stars, forks/);
    expect(() => checkStats(THEMES.native, ['nope'])).toThrow(`available: ${STAT_KEYS.join(', ')}`);
  });

  it('a stat listed twice', () => expect(() => checkStats(THEMES.native, ['stars', 'stars'])).toThrow(/listed twice/));

  it('over the theme cap', () => {
    const seven = ['stars', 'forks', 'allTime', 'pastYear', 'repos', 'followers', 'commits'];
    expect(() => checkStats(THEMES.strip, seven)).toThrow(/at most 6/);
    expect(() => checkStats(THEMES.strip, seven)).toThrow('Theme "strip" shows at most 6 stats, got 7');
    expect(checkStats(THEMES.native, seven)).toEqual(seven);
    expect(checkStats(THEMES.native, [...STAT_KEYS])).toEqual(STAT_KEYS);
  });
});
