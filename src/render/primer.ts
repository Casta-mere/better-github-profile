import type { Mode } from '../snapshot/types';

/**
 * GitHub Primer color tokens, light and dark, as in the approved mockups
 * (`card-styles.html`, `card-styles-3.html`). Each mode is its own SVG file, so there is
 * no media query: the README `<picture>` picks the file.
 */
export interface Palette {
  /** Primary text. */
  fg: string;
  /** Muted text, labels, icons. */
  mut: string;
  /** Borders and divider rules. */
  bd: string;
  /** Card background (the GitHub page background). */
  card: string;
  /** Accent: titles. */
  acc: string;
  /** Empty track. */
  trk: string;
  /** Contribution greens, lightest to strongest. */
  g1: string;
  g2: string;
  g3: string;
  g4: string;
  gold: string;
}

export const PRIMER: Record<Mode, Palette> = {
  light: {
    fg: '#1f2328',
    mut: '#59636e',
    bd: '#d1d9e0',
    card: '#ffffff',
    acc: '#0969da',
    trk: '#eff2f5',
    g1: '#9be9a8',
    g2: '#40c463',
    g3: '#30a14e',
    g4: '#216e39',
    gold: '#bf8700',
  },
  dark: {
    fg: '#e6edf3',
    mut: '#9198a1',
    bd: '#3d444d',
    card: '#0d1117',
    acc: '#4493f8',
    trk: '#21262d',
    g1: '#0e4429',
    g2: '#006d32',
    g3: '#26a641',
    g4: '#39d353',
    gold: '#e3b341',
  },
};

/** Color of the `Other` language slice and of languages GitHub has no color for. */
export const OTHER_COLOR = '#8b949e';

export const FONT_STACK = '-apple-system,"Segoe UI",Helvetica,Arial,sans-serif';
