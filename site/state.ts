import { THEMES } from '../src/render/index';
import type { SetupConfig } from '../src/snippets/index';
import type { ThemeName } from '../src/snapshot/types';

/** Switch controls: their value is the checkbox state. */
const SWITCHES = ['includePrivate', 'includeForks', 'telemetry'] as const;
/** Comma-separated text inputs. */
const LISTS = ['excludeRepos', 'excludeLangs'] as const;

const isTheme = (v: string): v is ThemeName => Object.hasOwn(THEMES, v);

function bool(control: string, value: string | boolean): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`Control "${control}" takes a boolean`);
  return value;
}

function text(control: string, value: string | boolean): string {
  if (typeof value !== 'string') throw new TypeError(`Control "${control}" takes a string`);
  return value;
}

/** `'a, ,b'` → `['a', 'b']`. */
function splitList(value: string): string[] {
  return value
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/**
 * The selector page's reducer: one control change → the next setup. Controls are
 * `theme`, `card:<name>` (checkbox), the switches `includePrivate` / `includeForks` /
 * `telemetry`, and the text inputs `excludeRepos` / `excludeLangs`.
 *
 * Switching theme selects all of the new theme's cards. Cards stay in theme order, and the
 * last checked card can't be unchecked, so `cards` is never empty.
 */
export function applyControl(c: SetupConfig, control: string, value: string | boolean): SetupConfig {
  if (control === 'theme') {
    const theme = text(control, value);
    if (!isTheme(theme)) throw new Error(`Unknown theme "${theme}"; available: ${Object.keys(THEMES).join(', ')}`);
    return { ...c, theme, cards: [...THEMES[theme].cards] };
  }

  if (control.startsWith('card:')) {
    const card = control.slice('card:'.length);
    const all = THEMES[c.theme].cards;
    if (!all.includes(card)) throw new Error(`Unknown card "${card}" for theme "${c.theme}"; available: ${all.join(', ')}`);
    const on = bool(control, value);
    const cards = all.filter((x) => (x === card ? on : c.cards.includes(x)));
    return cards.length > 0 ? { ...c, cards } : c;
  }

  for (const key of SWITCHES) if (control === key) return { ...c, [key]: bool(control, value) };
  for (const key of LISTS) if (control === key) return { ...c, [key]: splitList(text(control, value)) };

  throw new Error(`Unknown control "${control}"`);
}
