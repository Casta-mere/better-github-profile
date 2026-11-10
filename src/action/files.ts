import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { validateSnapshot, type Snapshot } from '../snapshot/types';
import type { OutputFile } from './run';

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';

async function readBytes(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

/**
 * The previous snapshot, or null when the file is missing or fails validation (which makes
 * this run a first run). Other read errors throw rather than silently starting over.
 */
export async function readSnapshot(path: string, warn?: (msg: string) => void): Promise<Snapshot | null> {
  const bytes = await readBytes(path);
  if (bytes === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    parsed = undefined;
  }
  if (validateSnapshot(parsed)) return parsed;
  warn?.(`${path} is not a valid snapshot; this run counts as a first run.`);
  return null;
}

/** Writes each file whose bytes differ from what is on disk; returns the paths it wrote. */
export async function writeOutputs(files: OutputFile[]): Promise<string[]> {
  const changed: string[] = [];
  for (const f of files) {
    const next = Buffer.from(f.content, 'utf8');
    const current = await readBytes(f.path);
    if (current !== null && current.equals(next)) continue;
    await mkdir(dirname(f.path), { recursive: true });
    await writeFile(f.path, next);
    changed.push(f.path);
  }
  return changed;
}

/** The names of the regular files directly in `dir`; empty when the directory is missing. */
export async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

/** Deletes each file; returns the paths it deleted. A file that is already gone is skipped. */
export async function removeFiles(paths: string[]): Promise<string[]> {
  const removed: string[] = [];
  for (const path of paths) {
    try {
      await unlink(path);
      removed.push(path);
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }
  return removed;
}
