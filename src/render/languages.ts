import type { Snapshot } from '../snapshot/types';
import { OTHER_COLOR } from './primer';

export interface LanguageSlice {
  name: string;
  color: string;
  /** Share of all bytes, in percent, rounded to one decimal. */
  pct: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * The `n` largest languages by bytes, then an `Other` slice for whatever bytes are left.
 * Returns `[]` when there are no bytes at all, so callers never divide by zero.
 */
export function topLanguages(s: Snapshot, n: number): LanguageSlice[] {
  const sorted = [...s.languages].sort((a, b) => b.bytes - a.bytes);
  const total = sorted.reduce((sum, l) => sum + l.bytes, 0);
  if (total <= 0) return [];
  const top = sorted.slice(0, n).map((l) => ({
    name: l.name,
    color: l.color ?? OTHER_COLOR,
    pct: round1((l.bytes / total) * 100),
  }));
  const rest = sorted.slice(n).reduce((sum, l) => sum + l.bytes, 0);
  if (rest > 0) top.push({ name: 'Other', color: OTHER_COLOR, pct: round1((rest / total) * 100) });
  return top;
}
