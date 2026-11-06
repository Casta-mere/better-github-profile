import { describe, expect, it } from 'vitest';
import { checkPlausible } from '../src/guard/plausible';
import type { Snapshot } from '../src/snapshot/types';
import castaJson from './fixtures/snapshot-casta-mere.json';
import emptyJson from './fixtures/snapshot-empty.json';

const casta = castaJson as Snapshot;
const empty = emptyJson as Snapshot;
const castaBytes = casta.languages.reduce((a, l) => a + l.bytes, 0);

describe('checkPlausible', () => {
  it('ok when nothing dropped to zero', () => expect(checkPlausible(casta, casta)).toEqual({ ok: true }));

  it('accepts large non-zero drops', () =>
    expect(checkPlausible({ ...casta, repos: { ...casta.repos, stars: 1 } }, casta).ok).toBe(true));

  it('rejects stars dropping to 0', () => {
    const r = checkPlausible({ ...casta, repos: { ...casta.repos, stars: 0 } }, casta);
    expect(r).toEqual({ ok: false, reasons: ['repos.stars dropped from 21 to 0'] });
  });

  const zeroed: Record<string, [Snapshot, string]> = {
    'repos.count': [{ ...casta, repos: { ...casta.repos, count: 0 } }, 'repos.count dropped from 59 to 0'],
    'contributions.allTime': [
      { ...casta, contributions: { ...casta.contributions, allTime: 0 } },
      'contributions.allTime dropped from 2383 to 0',
    ],
    languages: [{ ...casta, languages: [] }, `language bytes dropped from ${castaBytes} to 0`],
  };

  it.each(['repos.count', 'contributions.allTime', 'languages'])('rejects %s dropping to 0', (field) => {
    const [next, reason] = zeroed[field];
    expect(checkPlausible(next, casta)).toEqual({ ok: false, reasons: [reason] });
  });

  it('counts languages whose bytes are all 0 as a drop to 0', () => {
    const next = { ...casta, languages: casta.languages.map((l) => ({ ...l, bytes: 0 })) };
    expect(checkPlausible(next, casta)).toEqual({ ok: false, reasons: [`language bytes dropped from ${castaBytes} to 0`] });
  });

  it('lists every field that dropped to 0', () => {
    expect(checkPlausible({ ...empty, generatedAt: casta.generatedAt }, casta)).toEqual({
      ok: false,
      reasons: [
        'repos.stars dropped from 21 to 0',
        'repos.count dropped from 59 to 0',
        'contributions.allTime dropped from 2383 to 0',
        `language bytes dropped from ${castaBytes} to 0`,
      ],
    });
  });

  it('accepts zeros that were already zero', () => expect(checkPlausible(empty, empty)).toEqual({ ok: true }));

  it('ignores fields outside the headline totals', () => {
    const next = { ...casta, repos: { ...casta.repos, forks: 0 }, contributions: { ...casta.contributions, pastYear: 0 } };
    expect(checkPlausible(next, casta)).toEqual({ ok: true });
  });

  it('accepts zeros on first run', () => expect(checkPlausible(empty, null).ok).toBe(true));

  it('rejects invalid schema even on first run', () => expect(checkPlausible({}, null).ok).toBe(false));

  it('names the schema failure', () => {
    const { repos, ...noRepos } = casta;
    expect(checkPlausible(noRepos, casta)).toEqual({ ok: false, reasons: ['snapshot failed validation'] });
    expect(checkPlausible(null, null)).toEqual({ ok: false, reasons: ['snapshot failed validation'] });
  });
});
