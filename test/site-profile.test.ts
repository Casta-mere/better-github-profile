import { describe, expect, it, vi } from 'vitest';
import type { Fetch } from '../site/check';
import {
  acceptProfile,
  fetchProfile,
  PROFILE_CACHE_MS,
  PROFILE_URL,
  readCachedProfile,
  writeCachedProfile,
} from '../site/profile';
import sample from '../site/sample-profile.json';
import type { ProfileData } from '../src/collect/profile';

const data = sample as ProfileData;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const answering = (res: () => Response | Promise<Response>) => vi.fn<Fetch>(async () => res());

describe('fetchProfile', () => {
  it('a 200 with a valid body → the data', async () => {
    expect(await fetchProfile('Casta-mere', answering(() => json(200, data)))).toEqual(data);
  });

  it('asks <base>/<user>', async () => {
    const fetch = answering(() => json(200, data));
    await fetchProfile('Casta-mere', fetch, 'https://worker.test/profile');
    expect(fetch).toHaveBeenCalledWith('https://worker.test/profile/Casta-mere');
    await fetchProfile('octocat', fetch);
    expect(fetch).toHaveBeenLastCalledWith(`${PROFILE_URL}/octocat`);
  });

  it('fetchProfile → null on 404', async () => {
    expect(await fetchProfile('this-user-does-not-exist-zz9', answering(() => json(404, { error: 'not found' })))).toBeNull();
  });

  it('a rate limit → null', async () => {
    expect(await fetchProfile('octocat', answering(() => json(429, { error: 'rate limited' })))).toBeNull();
  });

  it('a network error → null', async () => {
    const fetch = vi.fn<Fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await fetchProfile('octocat', fetch)).toBeNull();
  });

  it('a body that is not profile data → null', async () => {
    expect(await fetchProfile('octocat', answering(() => json(200, { repos: 'x' })))).toBeNull();
    expect(await fetchProfile('octocat', answering(() => new Response('<html>', { status: 200 })))).toBeNull();
  });
});

/** An in-memory `localStorage`. */
function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

const T = 1_800_000_000_000;

describe('profile cache', () => {
  it('reads a value back until it is an hour old', () => {
    const storage = memoryStorage();
    writeCachedProfile(storage, 'octocat', data, T);
    expect(readCachedProfile(storage, 'octocat', T)).toEqual(data);
    expect(readCachedProfile(storage, 'octocat', T + PROFILE_CACHE_MS - 1)).toEqual(data);
    expect(readCachedProfile(storage, 'octocat', T + PROFILE_CACHE_MS)).toBeNull();
    expect(PROFILE_CACHE_MS).toBe(60 * 60 * 1000);
  });

  it('keys by the lowercased login', () => {
    const storage = memoryStorage();
    writeCachedProfile(storage, 'Casta-mere', data, T);
    expect([...storage.items.keys()]).toEqual(['bgp-profile:casta-mere']);
    expect(JSON.parse(storage.items.get('bgp-profile:casta-mere')!)).toEqual({ at: T, data });
    expect(readCachedProfile(storage, 'casta-mere', T + 1)).toEqual(data);
  });

  it('nothing stored → null', () => {
    expect(readCachedProfile(memoryStorage(), 'octocat', T)).toBeNull();
  });

  it('corrupt or foreign values → null', () => {
    const storage = memoryStorage();
    for (const value of ['{not json', 'null', '[]', JSON.stringify({ at: T, data: { repos: 'x' } }), JSON.stringify({ at: 'x', data })]) {
      storage.items.set('bgp-profile:octocat', value);
      expect(readCachedProfile(storage, 'octocat', T), value).toBeNull();
    }
  });

  it('a value from the future is not trusted', () => {
    const storage = memoryStorage();
    writeCachedProfile(storage, 'octocat', data, T + PROFILE_CACHE_MS * 5);
    expect(readCachedProfile(storage, 'octocat', T)).toBeNull();
  });

  it('blocked storage means no cache, and no error', () => {
    const blocked = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    expect(() => writeCachedProfile(blocked, 'octocat', data, T)).not.toThrow();
    expect(readCachedProfile(blocked, 'octocat', T)).toBeNull();
  });
});

describe('acceptProfile', () => {
  it('ignores a late answer for an old username', () => {
    expect(acceptProfile('octocat', 'Casta-mere')).toBe(false);
    expect(acceptProfile('', 'Casta-mere')).toBe(false);
  });

  it('takes an answer for the name in the box, whatever its case', () => {
    expect(acceptProfile('Casta-mere', 'casta-mere')).toBe(true);
    expect(acceptProfile('octocat', 'octocat')).toBe(true);
  });
});
