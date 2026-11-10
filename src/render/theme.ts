import type { Mode, Snapshot } from '../snapshot/types';

export interface RenderOptions {
  mode: Mode;
  /** `YYYY-MM-DD`. When set, every card shows `stale · data as of <date>`. */
  staleAsOf?: string;
}

/**
 * A theme: a name and the cards it can draw. `Name` is the theme's literal name, so the
 * registry (`themes/index.ts`) can derive `ThemeName` from its keys and check that each
 * key is its theme's own name.
 */
export interface Theme<Name extends string = string> {
  name: Name;
  /** Card names, in display order: the default `cards` input and the selector order. */
  cards: string[];
  /** One standalone SVG, as a string. Throws on a card that is not in `cards`. */
  render(card: string, s: Snapshot, o: RenderOptions): string;
}

export type CardRenderer = (s: Snapshot, o: RenderOptions) => string;

export function unknownCard(theme: Pick<Theme, 'name' | 'cards'>, card: string): Error {
  return new Error(`Unknown card "${card}" for theme "${theme.name}"; available: ${theme.cards.join(', ')}`);
}

/** A theme whose cards, in display order, are the keys of `renderers`. */
export function defineTheme<Name extends string>(name: Name, renderers: Record<string, CardRenderer>): Theme<Name> {
  const theme: Theme<Name> = {
    name,
    cards: Object.keys(renderers),
    render(card, s, o) {
      if (!Object.hasOwn(renderers, card)) throw unknownCard(theme, card);
      return renderers[card](s, o);
    },
  };
  return theme;
}
