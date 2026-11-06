import type { Mode, Snapshot, ThemeName } from '../snapshot/types';

export interface RenderOptions {
  mode: Mode;
  /** `YYYY-MM-DD`. When set, every card shows `stale · data as of <date>`. */
  staleAsOf?: string;
}

export interface Theme {
  name: ThemeName;
  cards: string[];
  render(card: string, s: Snapshot, o: RenderOptions): string;
}

export type CardRenderer = (s: Snapshot, o: RenderOptions) => string;

export function unknownCard(theme: Pick<Theme, 'name' | 'cards'>, card: string): Error {
  return new Error(`Unknown card "${card}" for theme "${theme.name}"; available: ${theme.cards.join(', ')}`);
}

/** A theme whose cards, in display order, are the keys of `renderers`. */
export function defineTheme(name: ThemeName, renderers: Record<string, CardRenderer>): Theme {
  const theme: Theme = {
    name,
    cards: Object.keys(renderers),
    render(card, s, o) {
      if (!Object.hasOwn(renderers, card)) throw unknownCard(theme, card);
      return renderers[card](s, o);
    },
  };
  return theme;
}
