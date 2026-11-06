import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { pingId, sendPing, TELEMETRY_URL } from '../src/action/telemetry';
import type { Fetch } from '../src/collect/graphql';

const URL = 'https://example.test/ping';

const ok = () => vi.fn<Fetch>(async () => new Response(null, { status: 204 }));

describe('pingId', () => {
  it('pingId is stable 64-hex and not the raw id', async () => {
    const id = await pingId('123456');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).toBe(await pingId('123456'));
    expect(id).not.toContain('123456');
  });

  it('is the SHA-256 of better-github-profile:<repoId>', async () => {
    const expected = createHash('sha256').update('better-github-profile:123456').digest('hex');
    expect(await pingId('123456')).toBe(expected);
  });
});

describe('sendPing', () => {
  it('posts exactly {id, version, theme}', async () => {
    const fetch = ok();
    await sendPing({ repoId: '123456', version: '1.0.0', theme: 'strip', url: URL, fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(URL);
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(Object.keys(body).sort()).toEqual(['id', 'theme', 'version']);
    expect(body).toEqual({ id: await pingId('123456'), version: '1.0.0', theme: 'strip' });
  });

  it('never rejects on network error, non-2xx or timeout', async () => {
    const fakes: Fetch[] = [
      async () => Promise.reject(new TypeError('fetch failed')),
      async () => new Response('nope', { status: 500 }),
      () => new Promise<Response>(() => {}), // hangs and ignores the abort signal
    ];
    for (const fetch of fakes) {
      const debug = vi.fn();
      await expect(
        sendPing({ repoId: '1', version: '1.0.0', theme: 'native', url: URL, fetch, timeoutMs: 10, debug }),
      ).resolves.toBeUndefined();
      expect(debug).toHaveBeenCalledTimes(1);
    }
  });

  it('skips when repoId is undefined', async () => {
    const fetch = ok();
    await sendPing({ repoId: undefined, version: '1.0.0', theme: 'native', url: URL, fetch });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('skips when url is empty', async () => {
    const fetch = ok();
    await sendPing({ repoId: '1', version: '1.0.0', theme: 'native', url: '', fetch });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('url defaults to TELEMETRY_URL (empty until the owner deploys the Worker: no ping)', async () => {
    const fetch = ok();
    await sendPing({ repoId: '1', version: '1.0.0', theme: 'native', fetch });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(TELEMETRY_URL ? [TELEMETRY_URL] : []);
  });
});
