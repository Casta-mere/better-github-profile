import { describe, expect, it } from 'vitest';
import { staleCards } from '../src/action/cleanup';
import { THEMES } from '../src/render/index';

const NATIVE = [
  'native-overview-light.svg',
  'native-overview-dark.svg',
  'native-languages-light.svg',
  'native-languages-dark.svg',
];
const STRIP = ['strip-strip-light.svg', 'strip-strip-dark.svg'];

describe('staleCards', () => {
  it('returns the cards of a previous theme', () => {
    expect(staleCards([...NATIVE, ...STRIP, 'snapshot.json'], [...STRIP, 'snapshot.json'])).toEqual(NATIVE);
  });

  it('returns the cards of the same theme that were dropped', () => {
    const rendered = ['native-languages-light.svg', 'native-languages-dark.svg'];
    expect(staleCards(NATIVE, rendered)).toEqual(['native-overview-light.svg', 'native-overview-dark.svg']);
  });

  it('returns nothing when every card was rendered', () => {
    expect(staleCards([...NATIVE, 'snapshot.json'], [...NATIVE, 'snapshot.json'])).toEqual([]);
    expect(staleCards([], STRIP)).toEqual([]);
  });

  it('owns every card of every theme, in both modes', () => {
    const all = Object.values(THEMES).flatMap((t) =>
      t.cards.flatMap((c) => [`${t.name}-${c}-light.svg`, `${t.name}-${c}-dark.svg`]),
    );
    expect(staleCards(all, [])).toEqual(all);
  });

  it('keeps everything that is not exactly one of its own card names', () => {
    const others = [
      'snapshot.json',
      'README.md',
      'logo.svg',
      'my-badge-light.svg', // unknown theme
      'neon-overview-dark.svg', // unknown theme, known card
      'native-strip-light.svg', // a card of another theme
      'strip-overview-dark.svg', // a card of another theme
      'native-sparkline-light.svg', // unknown card
      'native-overview-dim.svg', // unknown mode
      'native-overview.svg', // no mode
      'native-overview-light.png', // other extension
      'native-overview-light.svg.bak',
      'native-overview-light.SVG',
      'Native-overview-light.svg',
      'old/native-overview-light.svg', // in a subdirectory
      'cards/native-overview-light.svg',
      ' native-overview-light.svg',
    ];
    expect(staleCards(others, [])).toEqual([]);
  });

  it('keeps the order of the directory listing', () => {
    expect(staleCards(['strip-strip-dark.svg', 'native-overview-light.svg', 'strip-strip-light.svg'], [])).toEqual([
      'strip-strip-dark.svg',
      'native-overview-light.svg',
      'strip-strip-light.svg',
    ]);
  });
});
