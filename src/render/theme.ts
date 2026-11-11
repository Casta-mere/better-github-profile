import type { Mode, Snapshot, ThemeName } from '../snapshot/types';
import type { StatKey } from './stats';

export interface RenderOptions {
  mode: Mode;
  /** `YYYY-MM-DD`. When set, every card shows `stale · data as of <date>`. */
  staleAsOf?: string;
  /** Stats on the cards that show them, in order. Default: the theme's `defaultStats`. */
  stats?: StatKey[];
}

export interface Theme {
  name: ThemeName;
  cards: string[];
  /** Stats shown when none are chosen: today's fixed set, so existing cards don't change. */
  defaultStats: readonly StatKey[];
  /** How many stats the theme's layout has room for. */
  maxStats: number;
  render(card: string, s: Snapshot, o: RenderOptions): string;
}

export type CardRenderer = (s: Snapshot, o: RenderOptions) => string;

export function unknownCard(theme: Pick<Theme, 'name' | 'cards'>, card: string): Error {
  return new Error(`Unknown card "${card}" for theme "${theme.name}"; available: ${theme.cards.join(', ')}`);
}

/** A theme whose cards, in display order, are the keys of `renderers`. */
export function defineTheme(
  name: ThemeName,
  stats: { defaultStats: readonly StatKey[]; maxStats: number },
  renderers: Record<string, CardRenderer>,
): Theme {
  const theme: Theme = {
    name,
    defaultStats: stats.defaultStats,
    maxStats: stats.maxStats,
    cards: Object.keys(renderers),
    render(card, s, o) {
      if (!Object.hasOwn(renderers, card)) throw unknownCard(theme, card);
      return renderers[card](s, o);
    },
  };
  return theme;
}
