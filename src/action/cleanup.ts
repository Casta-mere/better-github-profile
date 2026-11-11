import { THEMES } from '../render/index';
import type { Mode } from '../snapshot/types';

const MODES: Mode[] = ['light', 'dark'];

/** Every file name the Action can write for a card: `<theme>-<card>-<mode>.svg`. */
const OWN_CARDS = new Set(
  Object.values(THEMES).flatMap((theme) =>
    theme.cards.flatMap((card) => MODES.map((mode) => `${theme.name}-${card}-${mode}.svg`)),
  ),
);

/**
 * The cards in the output directory that this run did not render, e.g. after a theme switch.
 * `existing` and `rendered` are file names in that directory. Only exact names of the
 * Action's own cards are returned, so `snapshot.json` and anything else a user keeps there
 * (other SVGs, unknown themes or cards, subdirectories) are never touched.
 */
export function staleCards(existing: string[], rendered: string[]): string[] {
  const keep = new Set(rendered);
  return existing.filter((name) => OWN_CARDS.has(name) && !keep.has(name));
}
