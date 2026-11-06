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

  it('a boolean that is not true/false throws', () => {
    expect(() => readInputs(inputs({ token: 't', include_private: 'yes please' }))).toThrow('include_private');
  });
});
