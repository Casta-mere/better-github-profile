import { describe, expect, it, vi } from 'vitest';
import type { ActionConfig } from '../src/action/inputs';
import { run, type RunDeps } from '../src/action/run';
import { GraphQLFailure } from '../src/collect/graphql';
import type { Snapshot } from '../src/snapshot/types';
import castaJson from './fixtures/snapshot-casta-mere.json';
import emptyJson from './fixtures/snapshot-empty.json';
import { texts } from './svg-text';

const casta = castaJson as Snapshot;
const empty = emptyJson as Snapshot;

const cfg: ActionConfig = {
  token: 't',
  includePrivate: true,
  includeForks: false,
  excludeRepos: [],
  excludeLangs: [],
  theme: 'native',
  outputDir: 'cards',
  telemetry: true,
};

const CARD_FILES = [
  'cards/native-overview-light.svg',
  'cards/native-overview-dark.svg',
  'cards/native-languages-light.svg',
  'cards/native-languages-dark.svg',
];

const STRIP_FILES = ['cards/strip-strip-light.svg', 'cards/strip-strip-dark.svg'];

/**
 * An in-memory repo: `write` keeps the files and reports which ones changed, `list` and
 * `remove` see the same files. `existing` are other files already in the repo.
 */
function fakeDeps(opts: { prev?: Snapshot | null; collect?: () => Promise<Snapshot>; existing?: string[] } = {}) {
  const files = new Map<string, string>();
  if (opts.prev) files.set('cards/snapshot.json', `${JSON.stringify(opts.prev, null, 2)}\n`);
  for (const path of opts.existing ?? []) files.set(path, `kept ${path}`);
  const deps = {
    ping: vi.fn(async () => {}),
    collect: vi.fn(opts.collect ?? (async () => ({ ...casta, generatedAt: '2026-11-06T03:17:00.000Z' }))),
    readPrev: vi.fn(async () => {
      const raw = files.get('cards/snapshot.json');
      return raw === undefined ? null : (JSON.parse(raw) as Snapshot);
    }),
    write: vi.fn(async (out: { path: string; content: string }[]) => {
      const changed = out.filter((f) => files.get(f.path) !== f.content).map((f) => f.path);
      for (const f of out) files.set(f.path, f.content);
      return changed;
    }),
    list: vi.fn(async (dir: string) =>
      [...files.keys()]
        .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
        .map((p) => p.slice(dir.length + 1)),
    ),
    remove: vi.fn(async (paths: string[]) => paths.filter((p) => files.delete(p))),
    commit: vi.fn(async (changed: string[]) => changed.length > 0),
    info: vi.fn((msg: string) => void msg),
    warn: vi.fn((msg: string) => void msg),
    now: () => new Date('2026-11-06T03:17:00.000Z'),
  } satisfies RunDeps;
  return { deps, files };
}

const prevSnapshot: Snapshot = { ...casta, generatedAt: '2026-11-01T03:17:00.000Z' };

describe('run', () => {
  it('fresh run writes snapshot + 4 cards and commits', async () => {
    const { deps, files } = fakeDeps();
    expect(await run(cfg, deps)).toEqual({ status: 'fresh', committed: true });
    const written = deps.write.mock.calls[0][0].map((f) => f.path);
    expect(written).toEqual(['cards/snapshot.json', ...CARD_FILES]);
    expect(deps.commit).toHaveBeenCalledWith(['cards/snapshot.json', ...CARD_FILES]);
    expect(files.get('cards/snapshot.json')).toBe(
      `${JSON.stringify({ ...casta, generatedAt: '2026-11-06T03:17:00.000Z' }, null, 2)}\n`,
    );
    expect(texts(files.get('cards/native-overview-light.svg')!).join(' ')).not.toContain('stale');
    expect(deps.warn).not.toHaveBeenCalled();
  });

  it('identical data on second run changes nothing', async () => {
    const { deps, files } = fakeDeps();
    await run(cfg, deps);
    const before = new Map(files);
    // Same content, only a later timestamp: the old timestamp is kept.
    deps.collect.mockImplementation(async () => ({ ...casta, generatedAt: '2026-11-07T03:17:00.000Z' }));
    deps.commit.mockClear();
    expect(await run(cfg, deps)).toEqual({ status: 'unchanged', committed: false });
    await expect(deps.write.mock.results[1].value).resolves.toEqual([]);
    expect(deps.remove).not.toHaveBeenCalled();
    expect(deps.commit).not.toHaveBeenCalled();
    expect(files).toEqual(before);
  });

  it('only cards that changed are committed', async () => {
    const { deps } = fakeDeps({ prev: prevSnapshot });
    await run({ ...cfg, theme: 'strip' }, deps);
    expect(deps.commit).toHaveBeenCalledWith(['cards/strip-strip-light.svg', 'cards/strip-strip-dark.svg']);
  });

  it("a theme switch removes the previous theme's cards in the same commit", async () => {
    const { deps, files } = fakeDeps();
    await run(cfg, deps); // native
    deps.commit.mockClear();

    expect(await run({ ...cfg, theme: 'strip' }, deps)).toEqual({ status: 'fresh', committed: true });
    expect(deps.remove).toHaveBeenCalledWith(CARD_FILES);
    expect(deps.commit).toHaveBeenCalledTimes(1);
    expect(deps.commit).toHaveBeenCalledWith([...STRIP_FILES, ...CARD_FILES]);
    expect([...files.keys()].sort()).toEqual(['cards/snapshot.json', ...STRIP_FILES].sort());
    expect(deps.info.mock.calls.map(([msg]) => msg)).toEqual(
      CARD_FILES.map((path) => `Removed ${path}: this run no longer renders it.`),
    );
  });

  it('removes cards after writing the new ones', async () => {
    const order: string[] = [];
    const { deps } = fakeDeps({ prev: prevSnapshot, existing: CARD_FILES });
    deps.write.mockImplementation(async (out) => (order.push('write'), out.map((f) => f.path)));
    deps.remove.mockImplementation(async (paths) => (order.push('remove'), paths));
    deps.commit.mockImplementation(async () => (order.push('commit'), true));
    await run({ ...cfg, theme: 'strip' }, deps);
    expect(order).toEqual(['write', 'remove', 'commit']);
  });

  it('unchanged data with cards to remove still removes them and commits', async () => {
    const { deps, files } = fakeDeps();
    await run(cfg, deps);
    deps.commit.mockClear();

    const languagesOnly = { ...cfg, cards: ['languages'] };
    expect(await run(languagesOnly, deps)).toEqual({ status: 'unchanged', committed: true });
    await expect(deps.write.mock.results[1].value).resolves.toEqual([]);
    const overview = ['cards/native-overview-light.svg', 'cards/native-overview-dark.svg'];
    expect(deps.commit).toHaveBeenCalledWith(overview);
    for (const path of overview) expect(files.has(path)).toBe(false);

    // Nothing left to remove: the next run commits nothing.
    deps.commit.mockClear();
    deps.remove.mockClear();
    expect(await run(languagesOnly, deps)).toEqual({ status: 'unchanged', committed: false });
    expect(deps.remove).not.toHaveBeenCalled();
    expect(deps.commit).not.toHaveBeenCalled();
  });

  it('leaves unrelated files in the output directory alone', async () => {
    const unrelated = [
      'cards/README.md',
      'cards/logo.svg',
      'cards/my-native-overview-light.svg',
      'cards/neon-overview-light.svg',
      'cards/native-strip-light.svg',
      'cards/old/native-overview-light.svg',
      'native-overview-light.svg',
    ];
    const { deps, files } = fakeDeps({ prev: prevSnapshot, existing: [...unrelated, ...CARD_FILES] });
    await run({ ...cfg, theme: 'strip' }, deps);
    expect([...files.keys()].sort()).toEqual([...unrelated, 'cards/snapshot.json', ...STRIP_FILES].sort());
  });

  it('only looks in the current output directory', async () => {
    const { deps, files } = fakeDeps({ existing: CARD_FILES });
    await run({ ...cfg, theme: 'strip', outputDir: 'img/stats' }, deps);
    expect(deps.list).toHaveBeenCalledWith('img/stats');
    expect(deps.remove).not.toHaveBeenCalled();
    for (const path of CARD_FILES) expect(files.has(path)).toBe(true);
  });

  it('a stale run removes nothing', async () => {
    for (const collect of [
      async () => Promise.reject(new Error('HTTP 502')),
      async () => ({ ...casta, generatedAt: '2026-11-06T03:17:00.000Z', repos: { ...casta.repos, stars: 0 } }),
    ]) {
      const { deps, files } = fakeDeps({ prev: prevSnapshot, existing: CARD_FILES, collect });
      expect(await run({ ...cfg, theme: 'strip' }, deps)).toEqual({ status: 'stale', committed: true });
      expect(deps.list).not.toHaveBeenCalled();
      expect(deps.remove).not.toHaveBeenCalled();
      expect(deps.commit).toHaveBeenCalledWith(STRIP_FILES);
      for (const path of CARD_FILES) expect(files.has(path)).toBe(true);
    }
  });

  it('a failed first run removes nothing', async () => {
    const { deps, files } = fakeDeps({
      existing: CARD_FILES,
      collect: async () => Promise.reject(new Error('HTTP 502')),
    });
    await expect(run({ ...cfg, theme: 'strip' }, deps)).rejects.toThrow('HTTP 502');
    expect(deps.list).not.toHaveBeenCalled();
    expect(deps.remove).not.toHaveBeenCalled();
    for (const path of CARD_FILES) expect(files.has(path)).toBe(true);
  });

  it('fetch error with prev → stale, warns, keeps snapshot', async () => {
    const failure = new GraphQLFailure('GitHub GraphQL request failed after 4 attempts: HTTP 502 (try later).', 4);
    const { deps, files } = fakeDeps({ prev: prevSnapshot, collect: async () => Promise.reject(failure) });
    const snapshotBefore = files.get('cards/snapshot.json');

    expect(await run(cfg, deps)).toEqual({ status: 'stale', committed: true });

    expect(deps.warn).toHaveBeenCalledTimes(1);
    const warning = deps.warn.mock.calls[0][0];
    expect(warning).toContain('Using last good snapshot from 2026-11-01');
    expect(warning).toContain(failure.message);
    expect(warning).toContain('cards/snapshot.json');
    expect(warning).not.toContain('..');
    const changed = deps.commit.mock.calls[0][0];
    expect(changed).not.toContain('cards/snapshot.json');
    expect(changed).toEqual(CARD_FILES);
    expect(files.get('cards/snapshot.json')).toBe(snapshotBefore);
    for (const path of CARD_FILES) expect(texts(files.get(path)!)).toContain('stale · data as of 2026-11-01');
  });

  it('implausible with prev → stale', async () => {
    const zeroStars = { ...casta, generatedAt: '2026-11-06T03:17:00.000Z', repos: { ...casta.repos, stars: 0 } };
    const { deps, files } = fakeDeps({ prev: prevSnapshot, collect: async () => zeroStars });

    expect((await run(cfg, deps)).status).toBe('stale');
    const warning = deps.warn.mock.calls[0][0];
    expect(warning).toContain('Using last good snapshot from 2026-11-01');
    expect(warning).toContain('repos.stars dropped from 21 to 0');
    expect(JSON.parse(files.get('cards/snapshot.json')!)).toEqual(prevSnapshot);
  });

  it('a second stale run with the same reason changes nothing', async () => {
    const { deps } = fakeDeps({ prev: prevSnapshot, collect: async () => Promise.reject(new Error('boom')) });
    await run(cfg, deps);
    deps.commit.mockClear();
    expect(await run(cfg, deps)).toEqual({ status: 'stale', committed: false });
    expect(deps.commit).not.toHaveBeenCalled();
  });

  it('fetch error without prev → throws', async () => {
    const { deps } = fakeDeps({ collect: async () => Promise.reject(new Error('HTTP 502')) });
    await expect(run(cfg, deps)).rejects.toThrow('HTTP 502');
    expect(deps.write).not.toHaveBeenCalled();
    expect(deps.commit).not.toHaveBeenCalled();
  });

  it('invalid snapshot without prev → throws', async () => {
    const { deps } = fakeDeps({ collect: async () => ({}) as Snapshot });
    await expect(run(cfg, deps)).rejects.toThrow('snapshot failed validation');
    expect(deps.write).not.toHaveBeenCalled();
  });

  it('first run with zeros → fresh', async () => {
    const { deps, files } = fakeDeps({ collect: async () => empty });
    expect(await run(cfg, deps)).toEqual({ status: 'fresh', committed: true });
    expect(JSON.parse(files.get('cards/snapshot.json')!)).toEqual(empty);
  });

  it('honours outputDir and the chosen cards', async () => {
    const { deps } = fakeDeps();
    await run({ ...cfg, outputDir: 'img/stats', cards: ['languages'] }, deps);
    expect(deps.write.mock.calls[0][0].map((f) => f.path)).toEqual([
      'img/stats/snapshot.json',
      'img/stats/native-languages-light.svg',
      'img/stats/native-languages-dark.svg',
    ]);
  });

  it('ping is called once per run when telemetry is true, never when false', async () => {
    for (const make of [
      () => fakeDeps(), // fresh
      () => fakeDeps({ prev: prevSnapshot, collect: async () => Promise.reject(new Error('x')) }), // stale
      () => fakeDeps({ collect: async () => Promise.reject(new Error('x')) }), // throws
    ]) {
      const on = make();
      await run(cfg, on.deps).catch(() => undefined);
      expect(on.deps.ping).toHaveBeenCalledTimes(1);

      const off = make();
      await run({ ...cfg, telemetry: false }, off.deps).catch(() => undefined);
      expect(off.deps.ping).not.toHaveBeenCalled();
    }
  });

  it('ping runs last', async () => {
    const order: string[] = [];
    const { deps } = fakeDeps();
    deps.commit.mockImplementation(async () => (order.push('commit'), true));
    deps.ping.mockImplementation(async () => void order.push('ping'));
    await run(cfg, deps);
    expect(order).toEqual(['commit', 'ping']);
  });

  it('a rejecting ping does not change the result or throw', async () => {
    const { deps } = fakeDeps();
    deps.ping.mockRejectedValue(new Error('ping down'));
    expect(await run(cfg, deps)).toEqual({ status: 'fresh', committed: true });

    const failing = fakeDeps({ collect: async () => Promise.reject(new Error('HTTP 502')) });
    failing.deps.ping.mockRejectedValue(new Error('ping down'));
    await expect(run(cfg, failing.deps)).rejects.toThrow('HTTP 502');
  });
});
