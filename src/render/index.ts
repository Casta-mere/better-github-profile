import type { Mode, Snapshot } from '../snapshot/types';
import { unknownCard } from './theme';
import { THEMES, type ThemeName } from './themes/index';

export type { RenderOptions, Theme } from './theme';
export { THEMES, type ThemeName } from './themes/index';
export { topLanguages, type LanguageSlice } from './languages';
export { escapeXml, fmtInt, fmtPct } from './svg';

export interface RenderedCard {
  /** `<theme>-<card>-<mode>.svg` */
  file: string;
  svg: string;
}

const MODES: Mode[] = ['light', 'dark'];

/**
 * Renders every requested card (default: all of the theme's cards, in theme order) in
 * both modes. Card names are checked before anything is rendered.
 */
export function renderCards(s: Snapshot, cfg: { theme: ThemeName; cards?: string[]; staleAsOf?: string }): RenderedCard[] {
  const theme = THEMES[cfg.theme];
  if (!theme) throw new Error(`Unknown theme "${cfg.theme}"; available: ${Object.keys(THEMES).join(', ')}`);
  const cards = cfg.cards?.length ? cfg.cards : theme.cards;
  for (const card of cards) if (!theme.cards.includes(card)) throw unknownCard(theme, card);
  return cards.flatMap((card) =>
    MODES.map((mode) => ({
      file: `${theme.name}-${card}-${mode}.svg`,
      svg: theme.render(card, s, { mode, staleAsOf: cfg.staleAsOf }),
    })),
  );
}
