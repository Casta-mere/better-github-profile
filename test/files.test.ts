import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listFiles, removeFiles } from '../src/action/files';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bgp-files-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('listFiles', () => {
  it('lists the files directly in the directory, not subdirectories', async () => {
    await writeFile(join(dir, 'native-overview-light.svg'), 'x');
    await writeFile(join(dir, 'snapshot.json'), '{}');
    await mkdir(join(dir, 'native-overview-dark.svg'));
    await writeFile(join(dir, 'native-overview-dark.svg', 'inner.svg'), 'x');
    expect((await listFiles(dir)).sort()).toEqual(['native-overview-light.svg', 'snapshot.json']);
  });

  it('a missing directory has nothing in it', async () => {
    expect(await listFiles(join(dir, 'cards'))).toEqual([]);
  });
});

describe('removeFiles', () => {
  it('deletes the files and returns the ones it deleted', async () => {
    await writeFile(join(dir, 'a.svg'), 'x');
    await writeFile(join(dir, 'b.svg'), 'x');
    await writeFile(join(dir, 'keep.svg'), 'x');
    const paths = [join(dir, 'a.svg'), join(dir, 'gone.svg'), join(dir, 'b.svg')];
    expect(await removeFiles(paths)).toEqual([join(dir, 'a.svg'), join(dir, 'b.svg')]);
    expect(await readdir(dir)).toEqual(['keep.svg']);
  });
});
