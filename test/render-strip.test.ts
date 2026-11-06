import { describe, expect, it } from 'vitest';
import { renderCards, THEMES } from '../src/render/index';
import { topLanguages } from '../src/render/languages';
import type { Snapshot } from '../src/snapshot/types';
import castaJson from './fixtures/snapshot-casta-mere.json';
import emptyJson from './fixtures/snapshot-empty.json';
import { texts } from './svg-text';

const casta = castaJson as Snapshot;
const empty = emptyJson as Snapshot;
const MODES = ['light', 'dark'] as const;

describe('theme strip', () => {
  it('has one card, strip', () => expect(THEMES.strip.cards).toEqual(['strip']));

  it('pill row in order', () => {
    const line = texts(THEMES.strip.render('strip', casta, { mode: 'light' })).join(' ');
    const order = ['2,383', 'contributions', '795', 'past year', '59', 'repos', '★', '21', '22', 'followers'].map((t) =>
      line.indexOf(t),
    );
    expect(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]))).toBe(true);
  });

  it('pill sections pair each number with its label', () => {
    const t = texts(THEMES.strip.render('strip', casta, { mode: 'light' }));
    expect(t.slice(0, 5)).toEqual(['2,383 contributions', '795 past year', '59 repos', '★ 21', '22 followers']);
  });

  it('line 2: 52 wks, sparkline, langs, bar, top 3 languages', () => {
    const svg = THEMES.strip.render('strip', casta, { mode: 'light' });
    const t = texts(svg);
    const [l0, l1, l2] = topLanguages(casta, 3);
    expect(t.slice(5)).toEqual(['52 wks', 'langs', `${l0.name} · ${l1.name} · ${l2.name}`]);
    expect(t.join(' ')).not.toContain('Other');
    expect((svg.match(/<rect[^>]*class="wk"/g) ?? []).length).toBe(casta.calendar.weeks.length);
  });

  it('top 3 languages joined', () => {
    const [l0, l1, l2] = topLanguages(casta, 3);
    expect(texts(THEMES.strip.render('strip', casta, { mode: 'dark' }))).toContain(`${l0.name} · ${l1.name} · ${l2.name}`);
  });

  it('is 820 wide and about 76 high', () => {
    const svg = THEMES.strip.render('strip', casta, { mode: 'light' });
    const [, w, h] = svg.match(/<svg[^>]*width="([\d.]+)" height="([\d.]+)"/)!;
    expect(Number(w)).toBe(820);
    expect(Math.abs(Number(h) - 76)).toBeLessThanOrEqual(4);
  });

  it('stale marker is the last text on line 2', () => {
    const t = texts(THEMES.strip.render('strip', casta, { mode: 'light', staleAsOf: '2026-11-01' }));
    expect(t.at(-1)).toBe('stale · data as of 2026-11-01');
    expect(THEMES.strip.render('strip', casta, { mode: 'light' })).not.toContain('stale');
  });

  it('a 0.0% language does not produce a negative width', () => {
    const tiny: Snapshot = {
      ...casta,
      languages: [
        { name: 'A', color: '#111111', bytes: 1_000_000_000 },
        ...['B', 'C', 'D', 'E', 'F'].map((name) => ({ name, color: null, bytes: 1 })),
      ],
    };
    const svg = THEMES.strip.render('strip', tiny, { mode: 'light' });
    expect(svg).not.toMatch(/width="-/);
    expect(texts(svg)).toContain('A · B · C');
  });

  it('empty account renders cleanly', () => {
    for (const mode of MODES) {
      const svg = THEMES.strip.render('strip', empty, { mode });
      expect(svg).not.toMatch(/NaN|Infinity|d=""/);
      expect(svg).not.toMatch(/width="-|height="-/);
      expect(texts(svg).slice(0, 5)).toEqual(['0 contributions', '0 past year', '0 repos', '★ 0', '0 followers']);
    }
  });

  it('file names', () =>
    expect(renderCards(casta, { theme: 'strip' }).map((c) => c.file)).toEqual(['strip-strip-light.svg', 'strip-strip-dark.svg']));

  it('unknown card throws', () =>
    expect(() => renderCards(casta, { theme: 'strip', cards: ['overview'] })).toThrow(
      'Unknown card "overview" for theme "strip"; available: strip',
    ));
});
