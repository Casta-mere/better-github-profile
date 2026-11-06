import { describe, expect, it } from 'vitest';
import { sameContent } from '../src/snapshot/compare';
import { SCHEMA_VERSION, validateSnapshot, type Snapshot } from '../src/snapshot/types';
import castaJson from './fixtures/snapshot-casta-mere.json';
import emptyJson from './fixtures/snapshot-empty.json';

const casta = castaJson as Snapshot;
const empty = emptyJson as Snapshot;

describe('validateSnapshot', () => {
  it('accepts both fixtures', () => {
    expect(validateSnapshot(casta)).toBe(true);
    expect(validateSnapshot(empty)).toBe(true);
  });

  it('rejects missing fields and wrong schema version', () => {
    const { repos, ...noRepos } = casta;
    expect(validateSnapshot(noRepos)).toBe(false);
    expect(validateSnapshot({ ...casta, schemaVersion: 2 })).toBe(false);
    expect(validateSnapshot({ ...casta, repos: { ...casta.repos, stars: '21' } })).toBe(false);
  });

  it('rejects non-objects', () => {
    for (const x of [null, undefined, 1, 'snapshot', [], true]) expect(validateSnapshot(x)).toBe(false);
  });

  it('rejects wrong element shapes inside arrays', () => {
    const [top0] = casta.repos.top;
    const [lang0] = casta.languages;
    expect(validateSnapshot({ ...casta, repos: { ...casta.repos, top: [{ ...top0, stars: '5' }] } })).toBe(false);
    expect(validateSnapshot({ ...casta, repos: { ...casta.repos, top: [{ name: 'x', stars: 1 }] } })).toBe(false);
    expect(validateSnapshot({ ...casta, languages: [{ ...lang0, bytes: null }] })).toBe(false);
    expect(validateSnapshot({ ...casta, languages: [{ ...lang0, color: 3 }] })).toBe(false);
    expect(validateSnapshot({ ...casta, calendar: { weeks: [1, '2', 3] } })).toBe(false);
    expect(validateSnapshot({ ...casta, calendar: { weeks: 'nope' } })).toBe(false);
  });

  it('rejects NaN and Infinity, which JSON cannot carry', () => {
    expect(validateSnapshot({ ...casta, repos: { ...casta.repos, stars: Number.NaN } })).toBe(false);
    expect(validateSnapshot({ ...casta, calendar: { weeks: [Number.POSITIVE_INFINITY] } })).toBe(false);
  });

  it('accepts null where the schema allows it, and only there', () => {
    const [top0] = casta.repos.top;
    const [lang0] = casta.languages;
    expect(validateSnapshot({ ...casta, user: { ...casta.user, name: null } })).toBe(true);
    expect(validateSnapshot({ ...casta, repos: { ...casta.repos, top: [{ ...top0, language: null }] } })).toBe(true);
    expect(validateSnapshot({ ...casta, languages: [{ ...lang0, color: null }] })).toBe(true);
    expect(validateSnapshot({ ...casta, user: { ...casta.user, login: null } })).toBe(false);
  });

  it('exports the schema version the fixtures use', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(casta.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('sameContent', () => {
  it('sameContent ignores generatedAt only', () => {
    expect(sameContent(casta, { ...casta, generatedAt: '2030-01-01T00:00:00Z' })).toBe(true);
    expect(sameContent(casta, { ...casta, user: { ...casta.user, followers: 23 } })).toBe(false);
  });

  it('sees a change inside the weekly totals', () => {
    const weeks = [...casta.calendar.weeks];
    weeks[weeks.length - 1] += 1;
    expect(sameContent(casta, { ...casta, calendar: { weeks } })).toBe(false);
  });

  it('does not mutate its arguments', () => {
    const copy = structuredClone(casta);
    sameContent(casta, { ...casta, generatedAt: '2030-01-01T00:00:00Z' });
    expect(casta).toEqual(copy);
  });
});

describe('fixtures', () => {
  it('casta fixture carries the plan numbers', () => {
    const weeks = casta.calendar.weeks;
    expect(weeks).toHaveLength(53);
    expect(weeks.reduce((a, b) => a + b, 0)).toBe(795);
    expect(weeks.at(-1)).toBe(4);
    const total = casta.languages.reduce((a, l) => a + l.bytes, 0);
    const html = casta.languages.find((l) => l.name === 'HTML');
    expect(((html!.bytes / total) * 100).toFixed(1)).toBe('42.2');
    expect(casta.repos.top.map((r) => `${r.name}:${r.stars}:${r.language}`)).toEqual([
      'LaTeX-GraduationTemplate:5:TeX',
      'Read-Book:4:TeX',
      'My-Website:3:TypeScript',
      'Dash-Board:2:TypeScript',
      'CPP-Ticket:2:TypeScript',
      'Safehome:1:HTML',
    ]);
  });

  it('languages are sorted by bytes desc', () => {
    const bytes = casta.languages.map((l) => l.bytes);
    expect(bytes).toEqual([...bytes].sort((a, b) => b - a));
  });

  it('empty fixture is all zeros with 53 weeks', () => {
    expect(empty.user.name).toBeNull();
    expect(empty.calendar.weeks).toEqual(Array(53).fill(0));
    expect(empty.repos.top).toEqual([]);
    expect(empty.languages).toEqual([]);
  });
});
