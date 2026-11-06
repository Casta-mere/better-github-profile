import { validateSnapshot, type Snapshot } from '../snapshot/types';

export type Plausibility = { ok: true } | { ok: false; reasons: string[] };

/**
 * Headline totals that never legitimately fall to exactly 0 from a non-zero value in one
 * run; a fetch that silently came back empty does. Non-zero drops are accepted, since
 * deleting a repo or adding an exclude causes them.
 */
const HEADLINES: [field: string, value: (s: Snapshot) => number][] = [
  ['repos.stars', (s) => s.repos.stars],
  ['repos.count', (s) => s.repos.count],
  ['contributions.allTime', (s) => s.contributions.allTime],
  ['language bytes', (s) => s.languages.reduce((a, l) => a + l.bytes, 0)],
];

/**
 * Decide whether `next` may replace `prev`. Without a previous snapshot (first run) any
 * valid snapshot passes, zeros included; an invalid one never does.
 */
export function checkPlausible(next: unknown, prev: Snapshot | null): Plausibility {
  if (!validateSnapshot(next)) return { ok: false, reasons: ['snapshot failed validation'] };
  if (prev === null) return { ok: true };
  const reasons = HEADLINES.flatMap(([field, value]) => {
    const before = value(prev);
    return before > 0 && value(next) === 0 ? [`${field} dropped from ${before} to 0`] : [];
  });
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
