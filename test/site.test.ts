import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyControl } from '../site/state';
import { DEFAULT_SETUP } from '../src/snippets/index';

describe('applyControl', () => {
  it('switching theme to strip resets cards to the theme cards', () => {
    const c = applyControl(DEFAULT_SETUP, 'theme', 'strip');
    expect(c.theme).toBe('strip');
    expect(c.cards).toEqual(['strip']);
  });

  it('switching back to native selects all native cards again', () => {
    const strip = applyControl(DEFAULT_SETUP, 'theme', 'strip');
    expect(applyControl(strip, 'theme', 'native').cards).toEqual(['overview', 'languages']);
  });

  it('rejects an unknown theme', () => {
    expect(() => applyControl(DEFAULT_SETUP, 'theme', 'neon')).toThrow(/native, strip/);
  });

  it('unchecking languages leaves overview', () => {
    expect(applyControl(DEFAULT_SETUP, 'card:languages', false).cards).toEqual(['overview']);
  });

  it('the last card cannot be unchecked, so cards is never empty', () => {
    const one = applyControl(DEFAULT_SETUP, 'card:languages', false);
    expect(applyControl(one, 'card:overview', false).cards).toEqual(['overview']);
    const strip = applyControl(DEFAULT_SETUP, 'theme', 'strip');
    expect(applyControl(strip, 'card:strip', false).cards).toEqual(['strip']);
  });

  it('checking a card puts it back in theme order', () => {
    const one = applyControl(DEFAULT_SETUP, 'card:overview', false);
    expect(one.cards).toEqual(['languages']);
    expect(applyControl(one, 'card:overview', true).cards).toEqual(['overview', 'languages']);
  });

  it('rejects a card the theme does not have', () => {
    expect(() => applyControl(DEFAULT_SETUP, 'card:strip', true)).toThrow(/overview, languages/);
  });

  it('excludeRepos input "a, b" becomes [a, b]', () => {
    expect(applyControl(DEFAULT_SETUP, 'excludeRepos', 'a, b').excludeRepos).toEqual(['a', 'b']);
  });

  it('exclude inputs trim entries and drop empty ones', () => {
    expect(applyControl(DEFAULT_SETUP, 'excludeLangs', ' HTML , ,CSS, ').excludeLangs).toEqual(['HTML', 'CSS']);
    expect(applyControl(DEFAULT_SETUP, 'excludeRepos', '   ').excludeRepos).toEqual([]);
  });

  it('switches set includePrivate, includeForks and telemetry', () => {
    let c = applyControl(DEFAULT_SETUP, 'includePrivate', false);
    c = applyControl(c, 'includeForks', true);
    c = applyControl(c, 'telemetry', false);
    expect(c).toMatchObject({ includePrivate: false, includeForks: true, telemetry: false });
  });

  it('readmeFormat switches between markdown and picture', () => {
    const md = applyControl(DEFAULT_SETUP, 'readmeFormat', 'markdown');
    expect(md).toEqual({ ...DEFAULT_SETUP, readmeFormat: 'markdown' });
    expect(applyControl(md, 'readmeFormat', 'picture')).toEqual(DEFAULT_SETUP);
  });

  it('rejects an unknown README format', () => {
    expect(() => applyControl(DEFAULT_SETUP, 'readmeFormat', 'html')).toThrow(/picture, markdown/);
    expect(() => applyControl(DEFAULT_SETUP, 'readmeFormat', 'toString')).toThrow(/picture, markdown/);
    expect(() => applyControl(DEFAULT_SETUP, 'readmeFormat', true)).toThrow(/string/);
  });

  it('does not mutate its input', () => {
    const before = structuredClone(DEFAULT_SETUP);
    applyControl(DEFAULT_SETUP, 'card:languages', false);
    applyControl(DEFAULT_SETUP, 'theme', 'strip');
    applyControl(DEFAULT_SETUP, 'excludeRepos', 'x');
    applyControl(DEFAULT_SETUP, 'readmeFormat', 'markdown');
    applyControl(DEFAULT_SETUP, 'stats', 'joined');
    expect(DEFAULT_SETUP).toEqual(before);
  });

  it('stats sets an ordered list', () => {
    expect(applyControl(DEFAULT_SETUP, 'stats', 'joined,stars').stats).toEqual(['joined', 'stars']);
  });

  it('stats drops unknown keys and duplicates', () => {
    expect(applyControl(DEFAULT_SETUP, 'stats', 'joined,Stars,nope,joined, forks').stats).toEqual(['joined', 'forks']);
  });

  it('stats left empty keeps the setup unchanged', () => {
    expect(applyControl(DEFAULT_SETUP, 'stats', '')).toBe(DEFAULT_SETUP);
    expect(applyControl(DEFAULT_SETUP, 'stats', 'nope')).toBe(DEFAULT_SETUP);
  });

  it('stats over the theme cap keeps the setup unchanged', () => {
    const strip = applyControl(DEFAULT_SETUP, 'theme', 'strip');
    const seven = 'stars,forks,allTime,pastYear,repos,followers,commits';
    expect(applyControl(strip, 'stats', seven)).toBe(strip);
    expect(applyControl(strip, 'stats', 'stars,forks,allTime,pastYear,repos,followers').stats).toHaveLength(6);
    expect(applyControl(DEFAULT_SETUP, 'stats', seven).stats).toHaveLength(7); // native has no such cap
  });

  it('theme switch resets stats to the theme default', () => {
    const many = applyControl(DEFAULT_SETUP, 'stats', 'stars,forks,allTime,pastYear,repos,followers,commits,joined');
    expect(applyControl(many, 'theme', 'strip').stats).toEqual(['allTime', 'pastYear', 'repos', 'stars', 'followers']);
    expect(applyControl(many, 'theme', 'native').stats).toEqual(['stars', 'forks', 'allTime', 'pastYear', 'repos']);
  });

  it('rejects an unknown control or a value of the wrong type', () => {
    expect(() => applyControl(DEFAULT_SETUP, 'outputDirr', 'x')).toThrow(/Unknown control/);
    expect(() => applyControl(DEFAULT_SETUP, 'telemetry', 'false')).toThrow(/boolean/);
    expect(() => applyControl(DEFAULT_SETUP, 'excludeRepos', true)).toThrow(/string/);
  });
});

describe('site/sample-snapshot.json', () => {
  it('is a byte-for-byte copy of test/fixtures/snapshot-casta-mere.json', () => {
    const site = readFileSync(new URL('../site/sample-snapshot.json', import.meta.url));
    const fixture = readFileSync(new URL('./fixtures/snapshot-casta-mere.json', import.meta.url));
    expect(site.equals(fixture)).toBe(true);
  });
});
