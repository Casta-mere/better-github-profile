import { describe, expect, it } from 'vitest';
import { renderCards, STAT_KEYS, STATS, THEMES } from '../src/render/index';
import { topLanguages } from '../src/render/languages';
import { PRIMER } from '../src/render/primer';
import { escapeXml, fmtInt, fmtPct } from '../src/render/svg';
import type { Snapshot } from '../src/snapshot/types';
import castaJson from './fixtures/snapshot-casta-mere.json';
import emptyJson from './fixtures/snapshot-empty.json';
import { texts } from './svg-text';

const casta = castaJson as Snapshot;
const empty = emptyJson as Snapshot;
const MODES = ['light', 'dark'] as const;

/** One huge language and six 1-byte ones: five 0.0% entries, four of them mid-bar. */
const tiny: Snapshot = {
  ...casta,
  languages: [
    { name: 'A', color: '#111111', bytes: 1_000_000_000 },
    ...['B', 'C', 'D', 'E', 'F', 'G'].map((name) => ({ name, color: null, bytes: 1 })),
  ],
};

describe('helpers', () => {
  it('formats numbers en-US', () => {
    expect(fmtInt(2383)).toBe('2,383');
    expect(fmtInt(0)).toBe('0');
    expect(fmtInt(1234567)).toBe('1,234,567');
    expect(fmtPct(42.2)).toBe('42.2%');
    expect(fmtPct(5)).toBe('5.0%');
  });

  it('escapes the XML specials', () => {
    expect(escapeXml(`A&B <x> "q"`)).toBe('A&amp;B &lt;x&gt; &quot;q&quot;');
  });

  it('topLanguages returns the top n plus Other, rounded to one decimal', () => {
    const top = topLanguages(casta, 5);
    expect(top.map((l) => l.name)).toEqual(['HTML', 'Python', 'TypeScript', 'TeX', 'Shell', 'Other']);
    expect(top[0]).toEqual({ name: 'HTML', color: '#e34c26', pct: 42.2 });
    expect(top.at(-1)!.color).toBe('#8b949e');
    for (const l of top) expect(l.pct).toBe(Math.round(l.pct * 10) / 10);
  });

  it('topLanguages: null color becomes #8b949e, no Other when nothing is left, [] when total is 0', () => {
    const two: Snapshot = { ...casta, languages: [{ name: 'Go', color: null, bytes: 3 }, { name: 'C', color: '#555555', bytes: 1 }] };
    expect(topLanguages(two, 5)).toEqual([
      { name: 'Go', color: '#8b949e', pct: 75 },
      { name: 'C', color: '#555555', pct: 25 },
    ]);
    expect(topLanguages(empty, 5)).toEqual([]);
    expect(topLanguages({ ...casta, languages: [{ name: 'Go', color: null, bytes: 0 }] }, 5)).toEqual([]);
  });
});

describe('theme native', () => {
  it('overview shows the real numbers next to the right labels', () => {
    const svg = THEMES.native.render('overview', casta, { mode: 'light' });
    const t = texts(svg);
    const valueOf = (label: string) => t[t.indexOf(label) + 1];
    expect(t).toContain("Castamere's GitHub Statistics");
    expect(valueOf('Stars')).toBe('21');
    expect(valueOf('Forks')).toBe('5');
    expect(valueOf('All-time contributions')).toBe('2,383');
    expect(valueOf('Contributions (past year)')).toBe('795');
    expect(valueOf('Repositories')).toBe('59');
    expect(t).toContain('last 52 weeks');
    expect((svg.match(/<rect[^>]*class="wk"/g) ?? []).length).toBe(casta.calendar.weeks.length);
  });

  it('overview rows come in the specified order', () => {
    const t = texts(THEMES.native.render('overview', casta, { mode: 'light' }));
    const labels = ['Stars', 'Forks', 'All-time contributions', 'Contributions (past year)', 'Repositories'];
    expect(labels.map((l) => t.indexOf(l))).toEqual([...labels.map((l) => t.indexOf(l))].sort((a, b) => a - b));
    expect(labels.every((l) => t.includes(l))).toBe(true);
  });

  it('sparkline follows calendar.weeks, not a fixed 53', () => {
    const s: Snapshot = { ...casta, calendar: { weeks: [3, 0, 6] } };
    const svg = THEMES.native.render('overview', s, { mode: 'light' });
    const heights = [...svg.matchAll(/<rect[^>]*class="wk"[^>]*height="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(heights).toHaveLength(3);
    expect(heights[1]).toBe(1); // a zero week still shows a 1px bar
    expect(heights[2]).toBeCloseTo(heights[0] * 2);
  });

  it('languages card lists top 5 + Other with percentages', () => {
    const t = texts(THEMES.native.render('languages', casta, { mode: 'light' }));
    expect(t[0]).toBe('Languages');
    expect(t).toContain('HTML 42.2%');
    expect(t.slice(1).map((x) => x.replace(/ [\d.]+%$/, ''))).toEqual(['HTML', 'Python', 'TypeScript', 'TeX', 'Shell', 'Other']);
    expect(t.at(-1)).toMatch(/^Other \d+\.\d%$/);
  });

  it('falls back to login and escapes', () => {
    const s = { ...casta, user: { ...casta.user, name: null } };
    expect(THEMES.native.render('overview', s, { mode: 'dark' })).toContain("Casta-mere's GitHub Statistics");
    const evil = { ...casta, user: { ...casta.user, name: 'A&B <x>' } };
    const svg = THEMES.native.render('overview', evil, { mode: 'dark' });
    expect(svg).toContain('A&amp;B &lt;x&gt;');
    expect(svg).not.toContain('<x>');
    expect(texts(svg)).toContain("A&B <x>'s GitHub Statistics");
  });

  it('a 0.0% language does not produce a negative width', () => {
    const svg = THEMES.native.render('languages', tiny, { mode: 'light' });
    expect(svg).not.toMatch(/width="-/);
    expect(texts(svg)).toContain('B 0.0%');
  });

  it('empty account renders cleanly', () => {
    for (const c of THEMES.native.cards)
      for (const mode of MODES) {
        const svg = THEMES.native.render(c, empty, { mode });
        expect(svg).not.toMatch(/NaN|Infinity|d=""/);
        expect(svg).not.toMatch(/width="-|height="-/);
      }
  });

  it('stale marker', () =>
    expect(texts(THEMES.native.render('overview', casta, { mode: 'light', staleAsOf: '2026-11-01' }))).toContain(
      'stale · data as of 2026-11-01',
    ));

  it('stale marker on every card, and only when stale', () => {
    for (const c of renderCards(casta, { theme: 'native', staleAsOf: '2026-11-01' }))
      expect(texts(c.svg)).toContain('stale · data as of 2026-11-01');
    for (const c of renderCards(casta, { theme: 'native' })) expect(c.svg).not.toContain('stale');
  });

  it('uses the Primer colors of the requested mode', () => {
    const light = THEMES.native.render('overview', casta, { mode: 'light' });
    const dark = THEMES.native.render('overview', casta, { mode: 'dark' });
    expect(light).toContain(PRIMER.light.acc);
    expect(light).not.toContain(PRIMER.dark.acc);
    expect(dark).toContain(PRIMER.dark.acc);
    expect(dark).not.toContain(PRIMER.light.acc);
    expect(light).not.toContain('@media');
  });

  it('renderCards names files and covers both modes', () => {
    expect(renderCards(casta, { theme: 'native' }).map((c) => c.file)).toEqual([
      'native-overview-light.svg',
      'native-overview-dark.svg',
      'native-languages-light.svg',
      'native-languages-dark.svg',
    ]);
    expect(renderCards(casta, { theme: 'native', cards: ['languages'] }).map((c) => c.file)).toEqual([
      'native-languages-light.svg',
      'native-languages-dark.svg',
    ]);
    expect(renderCards(casta, { theme: 'native', cards: [] })).toHaveLength(4); // empty list = all cards
  });

  it('unknown card throws', () => {
    expect(() => renderCards(casta, { theme: 'native', cards: ['nope'] })).toThrow('Unknown card "nope"');
    expect(() => renderCards(casta, { theme: 'native', cards: ['nope'] })).toThrow(
      'Unknown card "nope" for theme "native"; available: overview, languages',
    );
    expect(() => THEMES.native.render('nope', casta, { mode: 'light' })).toThrow('Unknown card "nope"');
  });

  it('overview shows the chosen stats, in order', () => {
    const svg = THEMES.native.render('overview', casta, { mode: 'light', stats: ['followers', 'joined'] });
    const t = texts(svg);
    expect(t.slice(1, 5)).toEqual(['Followers', '22', 'On GitHub since', '2021']);
    expect(t).not.toContain('2,021');
    expect(t).not.toContain('Stars');
    expect((svg.match(/<path class="ic"/g) ?? []).length).toBe(2);
  });

  it('overview: every stat has a row and an icon, commits has its own glyph', () => {
    const svg = THEMES.native.render('overview', casta, { mode: 'light', stats: [...STAT_KEYS] });
    const t = texts(svg);
    for (const k of STAT_KEYS) expect(t).toContain(STATS[k].label);
    const icons = [...svg.matchAll(/<path class="ic"[^>]* d="([^"]+)"/g)].map((m) => m[1]);
    expect(icons).toHaveLength(STAT_KEYS.length);
    expect(new Set(icons).size).toBe(STAT_KEYS.length);
    expect(icons[STAT_KEYS.indexOf('commits')]).not.toBe(icons[STAT_KEYS.indexOf('allTime')]);
    expect(svg).not.toMatch(/NaN|undefined|d=""/);
  });

  it('renderCards passes stats to the overview, the languages card ignores them', () => {
    const [overview, , languages] = renderCards(casta, { theme: 'native', stats: ['repos'] });
    expect(texts(overview.svg)).toContain('Repositories');
    expect(texts(overview.svg)).not.toContain('Stars');
    expect(languages.svg).toBe(THEMES.native.render('languages', casta, { mode: 'light' }));
  });

  it('the default stats render the same as no stats', () => {
    const svg = THEMES.native.render('overview', casta, { mode: 'light' });
    expect(THEMES.native.render('overview', casta, { mode: 'light', stats: [...THEMES.native.defaultStats] })).toBe(svg);
  });

  it('matches file snapshots', async () => {
    for (const c of renderCards(casta, { theme: 'native' })) await expect(c.svg).toMatchFileSnapshot(`__snapshots__/${c.file}`);
  });
});
