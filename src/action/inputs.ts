import type { CollectOptions } from '../collect/collect';
import { THEMES } from '../render/index';
import { unknownCard } from '../render/theme';
import type { ThemeName } from '../snapshot/types';

export interface ActionConfig extends CollectOptions {
  theme: ThemeName;
  /** Undefined = every card of the theme. */
  cards?: string[];
  /** Repo-relative, without a trailing slash. */
  outputDir: string;
  telemetry: boolean;
}

const MISSING_TOKEN =
  'Missing input "token". Create a classic personal access token with the read:user scope ' +
  '(plus repo to include private work), save it as the repository secret STATS_TOKEN, and pass ' +
  '`token: ${{ secrets.STATS_TOKEN }}` to the action.';

const list = (raw: string) =>
  raw
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

/**
 * Turn the Action's inputs into a config. `get` behaves like `core.getInput`: '' for an input
 * that was not given. Throws on an empty token, an unknown theme or card, or a bad boolean.
 */
export function readInputs(get: (name: string) => string): ActionConfig {
  const input = (name: string) => get(name).trim();

  const bool = (name: string, fallback: boolean) => {
    const v = input(name).toLowerCase();
    if (v === '') return fallback;
    if (v === 'true') return true;
    if (v === 'false') return false;
    throw new Error(`Input "${name}" must be true or false, got "${get(name)}"`);
  };

  const token = input('token');
  if (token === '') throw new Error(MISSING_TOKEN);

  const themeName = input('theme') || 'native';
  if (!Object.hasOwn(THEMES, themeName)) {
    throw new Error(`Unknown theme "${themeName}"; available: ${Object.keys(THEMES).join(', ')}`);
  }
  const theme = THEMES[themeName as ThemeName];

  const chosen = list(get('cards'));
  for (const card of chosen) if (!theme.cards.includes(card)) throw unknownCard(theme, card);

  return {
    token,
    theme: theme.name,
    cards: chosen.length > 0 ? chosen : undefined,
    includePrivate: bool('include_private', true),
    includeForks: bool('include_forks', false),
    excludeRepos: list(get('exclude_repos')),
    excludeLangs: list(get('exclude_langs')),
    outputDir: input('output_dir').replace(/\/+$/, '') || 'cards',
    telemetry: bool('telemetry', true),
  };
}
