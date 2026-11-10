import type { Theme } from '../theme';

// The theme registry: one import line per theme, and its name in `registered` below.
// Each theme lives in its own folder, `<name>/index.ts`, exporting a `const <name>`.
// ThemeName, the Action's `theme` input, the selector's previews and the tests are all
// derived from here. See CONTRIBUTING.md, "Add a theme".
import { native } from './native';
import { strip } from './strip';

/** In selector order. */
const registered = { native, strip };

/** Every theme by name. The type checks that each key is its theme's own name. */
export const THEMES: { [K in keyof typeof registered]: Theme<K> } = registered;

export type ThemeName = keyof typeof THEMES;
