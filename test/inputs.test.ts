import { describe, expect, it } from 'vitest';
import { readInputs } from '../src/action/inputs';

/** `core.getInput` returns '' for inputs that were not given. */
const inputs = (given: Record<string, string>) => (name: string) => given[name] ?? '';

describe('readInputs', () => {
  it('applies the defaults', () => {
    expect(readInputs(inputs({ token: 'ghp_x' }))).toEqual({
      token: 'ghp_x',
      theme: 'native',
      cards: undefined,
      includePrivate: true,
      includeForks: false,
      excludeRepos: [],
      excludeLangs: [],
      outputDir: 'cards',
      telemetry: true,
    });
  });

  it('splits comma lists, trims entries and drops empty ones', () => {
    const cfg = readInputs(inputs({ token: 't', exclude_repos: 'a, ,b', exclude_langs: ' TeX ,HTML,', cards: ' languages, ' }));
    expect(cfg.excludeRepos).toEqual(['a', 'b']);
    expect(cfg.excludeLangs).toEqual(['TeX', 'HTML']);
    expect(cfg.cards).toEqual(['languages']);
  });

  it('reads booleans, theme and output_dir', () => {
    const cfg = readInputs(
      inputs({
        token: 't',
        theme: 'strip',
        include_private: 'false',
        include_forks: 'True',
        telemetry: 'FALSE',
        output_dir: ' img/stats/ ',
      }),
    );
    expect(cfg).toMatchObject({
      theme: 'strip',
      includePrivate: false,
      includeForks: true,
      telemetry: false,
      outputDir: 'img/stats',
    });
  });

  it('an empty token throws a message mentioning STATS_TOKEN', () => {
    expect(() => readInputs(inputs({}))).toThrow('STATS_TOKEN');
    expect(() => readInputs(inputs({ token: '   ' }))).toThrow('STATS_TOKEN');
  });

  it('an unknown theme throws a message listing native, strip', () => {
    expect(() => readInputs(inputs({ token: 't', theme: 'fancy' }))).toThrow('native, strip');
  });

  it('a card the theme does not have throws', () => {
    expect(() => readInputs(inputs({ token: 't', theme: 'strip', cards: 'overview' }))).toThrow(
      'Unknown card "overview" for theme "strip"',
    );
  });

  it('reads stats in order, trimmed; empty means the theme default', () => {
    expect(readInputs(inputs({ token: 't', stats: ' allTime , stars ' })).stats).toEqual(['allTime', 'stars']);
    expect(readInputs(inputs({ token: 't', stats: '' })).stats).toBeUndefined();
    expect(readInputs(inputs({ token: 't', stats: ' , ' })).stats).toBeUndefined();
    expect(readInputs(inputs({ token: 't' })).stats).toBeUndefined();
  });

  it('stats keys are exact after trimming', () => {
    expect(() => readInputs(inputs({ token: 't', stats: 'Stars, forks' }))).toThrow(/Unknown stat "Stars"/);
    expect(() => readInputs(inputs({ token: 't', stats: 'Stars, forks' }))).toThrow('available: stars, forks, allTime');
    expect(readInputs(inputs({ token: 't', stats: 'stars, forks' })).stats).toEqual(['stars', 'forks']);
  });

  it('a stat listed twice throws', () => {
    expect(() => readInputs(inputs({ token: 't', stats: 'stars,repos,stars' }))).toThrow('Stat "stars" is listed twice');
  });

  it('stats over the theme cap throw', () => {
    const seven = 'stars,forks,allTime,pastYear,repos,followers,commits';
    expect(() => readInputs(inputs({ token: 't', theme: 'strip', stats: seven }))).toThrow(/at most 6/);
    expect(readInputs(inputs({ token: 't', stats: seven })).stats).toHaveLength(7);
  });

  it('a boolean that is not true/false throws', () => {
    expect(() => readInputs(inputs({ token: 't', include_private: 'yes please' }))).toThrow('include_private');
  });
});
