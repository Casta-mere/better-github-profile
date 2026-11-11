import { STAT_KEYS, THEMES, type StatKey } from '../src/render/index';
import type { ReadmeFormat, SetupConfig } from '../src/snippets/index';
import type { ThemeName } from '../src/snapshot/types';

/** Switch controls: their value is the checkbox state. */
const SWITCHES = ['includePrivate', 'includeForks', 'telemetry'] as const;
/** Comma-separated text inputs. */
const LISTS = ['excludeRepos', 'excludeLangs'] as const;

const README_FORMATS: readonly ReadmeFormat[] = ['picture', 'markdown'];

const isTheme = (v: string): v is ThemeName => Object.hasOwn(THEMES, v);
const isStat = (v: string): v is StatKey => (STAT_KEYS as readonly string[]).includes(v);
const isReadmeFormat = (v: string): v is ReadmeFormat => (README_FORMATS as readonly string[]).includes(v);

function bool(control: string, value: string | boolean): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`Control "${control}" takes a boolean`);
  return value;
}

function text(control: string, value: string | boolean): string {
  if (typeof value !== 'string') throw new TypeError(`Control "${control}" takes a string`);
  return value;
}

/** `'a, ,b'` → `['a', 'b']`. A full-width comma (`，`, what a Chinese input method types) counts too. */
function splitList(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/**
 * The selector page's reducer: one control change → the next setup. Controls are
 * `theme`, `card:<name>` (checkbox), the switches `includePrivate` / `includeForks` /
 * `telemetry`, the text inputs `excludeRepos` / `excludeLangs`, `readmeFormat`
 * (`picture` or `markdown`), and `stats` (the chosen stat keys, comma-separated, in order).
 *
 * Switching theme selects all of the new theme's cards and its default stats. Cards stay in
 * theme order, and the last checked card can't be unchecked, so `cards` is never empty.
 * `stats` drops unknown and repeated keys; a list left empty, or longer than the theme
 * shows, leaves the setup as it was.
 */
export function applyControl(c: SetupConfig, control: string, value: string | boolean): SetupConfig {
  if (control === 'theme') {
    const theme = text(control, value);
    if (!isTheme(theme)) throw new Error(`Unknown theme "${theme}"; available: ${Object.keys(THEMES).join(', ')}`);
    return { ...c, theme, cards: [...THEMES[theme].cards], stats: [...THEMES[theme].defaultStats] };
  }

  if (control === 'stats') {
    const stats = [...new Set(splitList(text(control, value)).filter(isStat))];
    return stats.length > 0 && stats.length <= THEMES[c.theme].maxStats ? { ...c, stats } : c;
  }

  if (control.startsWith('card:')) {
    const card = control.slice('card:'.length);
    const all = THEMES[c.theme].cards;
    if (!all.includes(card)) throw new Error(`Unknown card "${card}" for theme "${c.theme}"; available: ${all.join(', ')}`);
    const on = bool(control, value);
    const cards = all.filter((x) => (x === card ? on : c.cards.includes(x)));
    return cards.length > 0 ? { ...c, cards } : c;
  }

  if (control === 'readmeFormat') {
    const format = text(control, value);
    if (!isReadmeFormat(format)) {
      throw new Error(`Unknown README format "${format}"; available: ${README_FORMATS.join(', ')}`);
    }
    return { ...c, readmeFormat: format };
  }

  for (const key of SWITCHES) if (control === key) return { ...c, [key]: bool(control, value) };
  for (const key of LISTS) if (control === key) return { ...c, [key]: splitList(text(control, value)) };

  throw new Error(`Unknown control "${control}"`);
}
