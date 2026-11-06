import type { Mode, Snapshot, ThemeName } from '../snapshot/types';
import { defineTheme, unknownCard, type Theme } from './theme';
import { native } from './themes/native';

export type { RenderOptions, Theme } from './theme';
export { topLanguages, type LanguageSlice } from './languages';
export { escapeXml, fmtInt, fmtPct } from './svg';

export const THEMES: Record<ThemeName, Theme> = {
  native,
  strip: defineTheme('strip', {}), // implemented in the next task
};

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
