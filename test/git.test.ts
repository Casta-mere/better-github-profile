import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commitIfChanged } from '../src/action/git';

const NATIVE = ['cards/native-overview-light.svg', 'cards/native-overview-dark.svg'];
const STRIP = ['cards/strip-strip-light.svg', 'cards/strip-strip-dark.svg'];

describe('commitIfChanged with a fake git', () => {
  it('stages, commits and pushes deleted paths together with written ones', async () => {
    const calls: string[][] = [];
    const git = async (args: string[]) => {
      calls.push(args);
      // `diff --cached --quiet` exits 1 when something is staged.
      return { exitCode: args.includes('diff') ? 1 : 0, stdout: '', stderr: '' };
    };
    expect(await commitIfChanged([...STRIP, ...NATIVE], git)).toBe(true);
    const commands = calls.map((args) => args.filter((a) => a !== '-c' && !a.startsWith('user.')));
    expect(commands).toEqual([
      ['add', '--', ...STRIP, ...NATIVE],
      ['diff', '--cached', '--quiet', '--', ...STRIP, ...NATIVE],
      ['commit', '-m', 'Update profile cards', '--', ...STRIP, ...NATIVE],
      ['push'],
    ]);
  });
});

describe('commitIfChanged with real git', () => {
  let root: string;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  /** Git in `cwd`, ignoring the machine's own config and any GIT_* from a calling hook. */
  const gitIn = (cwd: string) => async (args: string[]) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
    const r = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
    });
    return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
  };
  const must = async (git: ReturnType<typeof gitIn>, args: string[]) => {
    const r = await git(args);
    if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };

  it('commits and pushes the deletion of a card in the same commit as the new cards', async () => {
    root = await mkdtemp(join(tmpdir(), 'bgp-git-'));
    const work = join(root, 'work');
    await must(gitIn(root), ['init', '-q', '--bare', '-b', 'main', 'remote.git']);
    await must(gitIn(root), ['clone', '-q', 'remote.git', 'work']);
    const git = gitIn(work);

    await must(git, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    await mkdir(join(work, 'cards'));
    for (const path of [...NATIVE, 'cards/README.md']) await writeFile(join(work, path), path);
    await must(git, ['add', '.']);
    await must(git, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init']);
    await must(git, ['push', '-q', '-u', 'origin', 'main']);

    // A theme switch: the strip cards are written, the native ones deleted.
    for (const path of STRIP) await writeFile(join(work, path), path);
    for (const path of NATIVE) await unlink(join(work, path));
    expect(await commitIfChanged([...STRIP, ...NATIVE], git)).toBe(true);

    const show = await must(git, ['show', '--name-status', '--format=%an', 'HEAD']);
    expect(show.split('\n').filter(Boolean).sort()).toEqual(
      ['github-actions[bot]', ...NATIVE.map((p) => `D\t${p}`), ...STRIP.map((p) => `A\t${p}`)].sort(),
    );
    expect(await must(git, ['status', '--porcelain'])).toBe('');
    expect(await must(git, ['rev-parse', 'HEAD'])).toBe(await must(git, ['rev-parse', 'origin/main']));
    expect((await must(git, ['ls-files', 'cards'])).split('\n').sort()).toEqual(['cards/README.md', ...STRIP].sort());
  });
});
