// Runs for every theme in the registry (src/render/themes/index.ts): a new theme is tested
// here as soon as it is registered. Its own layout goes in test/render-<theme>.test.ts.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderCards, THEMES, type Theme, type ThemeName } from '../src/render/index';
import type { Mode, Snapshot } from '../src/snapshot/types';
import castaJson from './fixtures/snapshot-casta-mere.json';
import emptyJson from './fixtures/snapshot-empty.json';
import { svgProblems } from './svg-check';
import { texts } from './svg-text';

const root = new URL('../', import.meta.url);
const THEMES_DIR = new URL('src/render/themes/', root);

const MODES: Mode[] = ['light', 'dark'];
const STALE = '2026-11-01';

function deepFreeze<T>(x: T): T {
  if (typeof x === 'object' && x !== null) {
    for (const v of Object.values(x)) deepFreeze(v);
    Object.freeze(x);
  }
  return x;
}

/** Every name a card might print, with the XML specials in it. */
const withSpecials = (s: Snapshot): Snapshot => ({
  ...s,
  user: { ...s.user, name: 'A&B <x> "q"' },
  repos: { ...s.repos, top: s.repos.top.map((r) => ({ ...r, name: `${r.name}<&>` })) },
  languages: s.languages.map((l) => ({ ...l, name: `${l.name} <&>` })),
});

// Frozen: a card that writes to the snapshot throws instead of passing.
const FIXTURES = Object.entries({
  full: castaJson as Snapshot,
  empty: emptyJson as Snapshot,
}).map(([name, s]) => ({
  name,
  s: deepFreeze(structuredClone(s)),
  special: deepFreeze(withSpecials(structuredClone(s))),
}));

const themes = Object.entries(THEMES) as [ThemeName, Theme][];

/** Theme × card × mode × fixture. */
const cases = (theme: Theme) =>
  theme.cards.flatMap((card) =>
    MODES.flatMap((mode) => FIXTURES.map((fixture) => ({ card, mode, fixture: fixture.name, ...fixture }))),
  );

describe('theme registry', () => {
  it('has themes', () => expect(themes.length).toBeGreaterThan(0));

  it('every theme folder is registered', () => {
    const folders = readdirSync(THEMES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(folders.sort()).toEqual(Object.keys(THEMES).sort());
  });
});

describe.each(themes)('theme %s', (key, theme) => {
  it('is registered under its own name, a lowercase word', () => {
    expect(theme.name).toBe(key);
    expect(key).toMatch(/^[a-z][a-z0-9]*$/); // part of file names: <theme>-<card>-<mode>.svg
  });

  it('has its folder: index.ts and README.md', () => {
    expect(existsSync(new URL(`${key}/index.ts`, THEMES_DIR))).toBe(true);
    expect(existsSync(new URL(`${key}/README.md`, THEMES_DIR))).toBe(true);
  });

  it('README previews exist', () => {
    const readme = new URL(`${key}/README.md`, THEMES_DIR);
    const srcs = [...readFileSync(readme, 'utf8').matchAll(/(?:src|srcset)="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) expect(existsSync(new URL(src, readme)), src).toBe(true);
  });

  it('has cards with unique lowercase names', () => {
    expect(theme.cards.length).toBeGreaterThan(0);
    expect(new Set(theme.cards).size).toBe(theme.cards.length);
    for (const card of theme.cards) expect(card).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('throws on an unknown card', () => {
    expect(() => theme.render('no-such-card', FIXTURES[0].s, { mode: 'light' })).toThrow(
      `Unknown card "no-such-card" for theme "${key}"`,
    );
  });

  it('renderCards names the files <theme>-<card>-<mode>.svg, every card in both modes', () => {
    expect(renderCards(FIXTURES[0].s, { theme: key }).map((c) => c.file)).toEqual(
      theme.cards.flatMap((card) => MODES.map((mode) => `${key}-${card}-${mode}.svg`)),
    );
  });

  describe.each(cases(theme))('$card, $mode, $fixture fixture', ({ card, mode, s, special }) => {
    const render = (o: { snapshot?: Snapshot; mode?: Mode; staleAsOf?: string } = {}) =>
      theme.render(card, o.snapshot ?? s, { mode: o.mode ?? mode, staleAsOf: o.staleAsOf });

    it('is a well-formed, self-contained SVG document', () => {
      const svg = render();
      expect(svg.trimStart()).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[\s>]/);
      expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
      expect(svgProblems(svg)).toEqual([]);
    });

    it('has a fixed size, a viewBox and an accessible title', () => {
      const svg = render();
      const open = svg.match(/<svg\b[^>]*>/)![0];
      const size = (attr: string) => Number(open.match(new RegExp(` ${attr}="([^"]+)"`))?.[1]);
      expect(size('width')).toBeGreaterThan(0);
      expect(size('height')).toBeGreaterThan(0);
      expect(open).toMatch(/ viewBox="[\d. ]+"/);
      expect(open).toContain('role="img"');
      expect(svg).toMatch(/<title>[^<]+<\/title>/);
    });

    it('has no NaN, Infinity, empty path or negative size', () => {
      const svg = render();
      expect(svg).not.toMatch(/NaN|Infinity|d=""/);
      expect(svg).not.toMatch(/(?:width|height|rx|ry|r)="-/);
    });

    it('draws the requested mode, with no color-scheme media query', () => {
      const svg = render();
      expect(svg).not.toBe(render({ mode: mode === 'light' ? 'dark' : 'light' }));
      expect(svg).not.toContain('prefers-color-scheme');
    });

    it('is pure: the same input gives the same output', () => {
      expect(render()).toBe(render());
    });

    it('shows the stale marker with staleAsOf, and only then', () => {
      expect(texts(render({ staleAsOf: STALE }))).toContain(`stale · data as of ${STALE}`);
      expect(texts(render()).join('\n')).not.toContain('data as of');
    });

    it('escapes text: names with & < > " stay text', () => {
      const out = render({ snapshot: special, staleAsOf: STALE });
      expect(svgProblems(out)).toEqual([]);
      expect(out).not.toContain('<x>');
      expect(out).not.toContain('<&>');
    });
  });

  it('matches its file snapshots in test/__snapshots__/<theme>/', async () => {
    for (const c of renderCards(FIXTURES[0].s, { theme: key }))
      await expect(c.svg).toMatchFileSnapshot(`__snapshots__/${key}/${c.file}`);
  });
});

describe('svgProblems', () => {
  it('passes a minimal document', () =>
    expect(
      svgProblems(
        '<svg xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="c"><rect/></clipPath></defs><g clip-path="url(#c)"><text>a &amp; b</text></g></svg>\n',
      ),
    ).toEqual([]));

  it.each([
    ['<svg><g></svg>', '</svg> closes <g>'],
    ['<svg><text>a & b</text></svg>', 'raw & in "a & b"'],
    ['<svg><text>a < b</text></svg>', 'bad tag <'],
    ['<svg><text x="1" x="2">a</text></svg>', '<text> repeats the attribute x'],
    ['<svg><image href="https://example.com/a.png"/></svg>', 'external reference href="https://example.com/a.png"'],
    ['<svg><style>@import url(x.css);</style></svg>', '@import or @font-face: no external fonts or stylesheets'],
    ['<svg><g clip-path="url(#nope)"/></svg>', '#nope refers to no element'],
    ['<svg><rect id="a"/><rect id="a"/></svg>', 'duplicate id="a"'],
    ['<svg><script>x()</script></svg>', '<script>'],
    ['<svg onload="x()"></svg>', 'event handler onload'],
    ['<svg></svg><svg></svg>', 'a second root element <svg>'],
  ])('flags %s', (svg, problem) => expect(svgProblems(svg).join('\n')).toContain(problem));
});
