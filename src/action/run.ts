import { checkPlausible } from '../guard/plausible';
import { renderCards } from '../render/index';
import { sameContent } from '../snapshot/compare';
import type { Snapshot } from '../snapshot/types';
import type { ActionConfig } from './inputs';

export interface OutputFile {
  path: string;
  content: string;
}

/** Everything `run` touches outside itself, so the flow is testable in memory. */
export interface RunDeps {
  ping(): Promise<void>;
  collect(): Promise<Snapshot>;
  /** The last good snapshot, or null when there is none (or it is unreadable). */
  readPrev(): Promise<Snapshot | null>;
  /** Writes the files; returns the paths whose content actually changed. */
  write(files: OutputFile[]): Promise<string[]>;
  /** Commits and pushes the given paths; false when there was nothing to commit. */
  commit(changed: string[]): Promise<boolean>;
  warn(msg: string): void;
  now(): Date;
}

export type RunResult = { status: 'fresh' | 'stale' | 'unchanged'; committed: boolean };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The fail-safe flow. A failed or implausible fetch never replaces the last good snapshot:
 * with one, the cards are re-rendered from it, marked stale, and the step only warns. Throws
 * only when there is no previous snapshot to fall back on. The usage ping (when enabled) is
 * the very last thing on every outcome, and its errors are swallowed.
 */
export async function run(cfg: ActionConfig, deps: RunDeps): Promise<RunResult> {
  try {
    return await update(cfg, deps);
  } finally {
    if (cfg.telemetry) {
      try {
        await deps.ping();
      } catch {
        // A telemetry failure never affects the run.
      }
    }
  }
}

async function update(cfg: ActionConfig, deps: RunDeps): Promise<RunResult> {
  const snapshotPath = `${cfg.outputDir}/snapshot.json`;
  const prev = await deps.readPrev();

  let next: Snapshot | null = null;
  let reasons: string[];
  try {
    const collected = await deps.collect();
    const plausible = checkPlausible(collected, prev);
    if (plausible.ok) next = collected;
    reasons = plausible.ok ? [] : plausible.reasons;
  } catch (err) {
    reasons = [message(err)];
  }

  const cards = (s: Snapshot, staleAsOf?: string): OutputFile[] =>
    renderCards(s, { theme: cfg.theme, cards: cfg.cards, stats: cfg.stats, staleAsOf }).map((c) => ({
      path: `${cfg.outputDir}/${c.file}`,
      content: c.svg,
    }));

  const save = async (files: OutputFile[]) => {
    const changed = await deps.write(files);
    return { changed, committed: changed.length > 0 ? await deps.commit(changed) : false };
  };

  if (next === null) {
    if (prev === null) throw new Error(`Could not build the first snapshot: ${reasons.join('; ')}`);
    const asOf = prev.generatedAt.slice(0, 10);
    const why = reasons.join('; ').replace(/\.+$/, '');
    deps.warn(
      `Using last good snapshot from ${asOf}: ${why}. ` +
        `The cards show "stale · data as of ${asOf}" until a run succeeds. ` +
        `If a value really did drop to 0, delete ${snapshotPath} and the next run starts fresh.`,
    );
    // The snapshot file is left alone: only the cards are re-rendered.
    const { committed } = await save(cards(prev, asOf));
    return { status: 'stale', committed };
  }

  // Unchanged data keeps the previous timestamp, so the snapshot file stays byte-identical.
  const snapshot = prev !== null && sameContent(next, prev) ? prev : next;
  const { changed, committed } = await save([
    { path: snapshotPath, content: `${JSON.stringify(snapshot, null, 2)}\n` },
    ...cards(snapshot),
  ]);
  return { status: changed.length > 0 ? 'fresh' : 'unchanged', committed };
}
