import * as core from '@actions/core';
import { collectSnapshot } from '../collect/collect';
import { readSnapshot, writeOutputs } from './files';
import { commitIfChanged } from './git';
import { readInputs } from './inputs';
import { run, type RunResult } from './run';

const SUMMARY: Record<RunResult['status'], string> = {
  fresh: 'Cards updated from fresh data.',
  unchanged: 'Data unchanged since the last run.',
  stale: 'Cards re-rendered from the last good snapshot.',
};

async function main(): Promise<void> {
  try {
    const cfg = readInputs((name) => core.getInput(name));
    core.setSecret(cfg.token);
    const now = () => new Date();
    const result = await run(cfg, {
      ping: async () => {},
      collect: () => collectSnapshot({ ...cfg, now }),
      readPrev: () => readSnapshot(`${cfg.outputDir}/snapshot.json`, (msg) => core.warning(msg)),
      write: (files) => writeOutputs(files),
      commit: (changed) => commitIfChanged(changed),
      warn: (msg) => core.warning(msg),
      now,
    });
    core.info(`${SUMMARY[result.status]} ${result.committed ? 'Committed and pushed.' : 'Nothing to commit.'}`);
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

await main();
