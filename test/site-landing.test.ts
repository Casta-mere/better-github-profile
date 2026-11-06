import { describe, expect, it } from 'vitest';
import { CHECK_PROXY } from '../site/check';
import { AUTH_START, readLanding, signInUrl, withoutLanding } from '../site/landing';
import { TELEMETRY_URL } from '../src/action/telemetry';

const SITE = 'https://casta-mere.github.io/better-github-profile/';

describe('AUTH_START', () => {
  it('is the Worker the Action pings and the page proxies through, so the URLs cannot drift apart', () => {
    expect(new URL(AUTH_START).origin).toBe(new URL(TELEMETRY_URL).origin);
    expect(new URL(AUTH_START).origin).toBe(new URL(CHECK_PROXY).origin);
    expect(new URL(AUTH_START).pathname).toBe('/auth/start');
  });
});

describe('signInUrl', () => {
  it('sends the page origin and path as the return URL', () => {
    const url = new URL(signInUrl(SITE));
    expect(`${url.origin}${url.pathname}`).toBe(AUTH_START);
    expect([...url.searchParams.keys()]).toEqual(['return']);
    expect(url.searchParams.get('return')).toBe(SITE);
  });

  it('URL-encodes the return URL', () => {
    expect(signInUrl(SITE)).toBe(`${AUTH_START}?return=https%3A%2F%2Fcasta-mere.github.io%2Fbetter-github-profile%2F`);
  });

  it('drops the query and the hash, so a stale ?user= or ?auth= never comes back', () => {
    const url = new URL(signInUrl(`${SITE}?user=octocat&auth=failed&x=1#step-2`));
    expect(url.searchParams.get('return')).toBe(SITE);
  });

  it('returns to a local dev server as is', () => {
    const url = new URL(signInUrl('http://localhost:5173/better-github-profile/?user=a'));
    expect(url.searchParams.get('return')).toBe('http://localhost:5173/better-github-profile/');
  });
});

describe('readLanding', () => {
  it('reads nothing from an empty query', () => {
    expect(readLanding('')).toEqual({ user: null, auth: null });
    expect(readLanding('?')).toEqual({ user: null, auth: null });
    expect(readLanding('?tab=readme')).toEqual({ user: null, auth: null });
  });

  it('reads ?user=, trimmed', () => {
    expect(readLanding('?user=octocat')).toEqual({ user: 'octocat', auth: null });
    expect(readLanding('?user=%20Octocat%20')).toEqual({ user: 'Octocat', auth: null });
    expect(readLanding('?user=+octocat+')).toEqual({ user: 'octocat', auth: null });
  });

  it('treats an empty or blank ?user= as absent', () => {
    expect(readLanding('?user=').user).toBeNull();
    expect(readLanding('?user').user).toBeNull();
    expect(readLanding('?user=%20%20').user).toBeNull();
  });

  it('keeps a ?user= that is not a valid username: the box says why', () => {
    expect(readLanding('?user=not%20a%20login').user).toBe('not a login');
    expect(readLanding('?user=a/b').user).toBe('a/b');
  });

  it('reads the three sign-in outcomes', () => {
    expect(readLanding('?auth=cancelled').auth).toBe('cancelled');
    expect(readLanding('?auth=failed').auth).toBe('failed');
    expect(readLanding('?auth=unavailable').auth).toBe('unavailable');
  });

  it('ignores an unknown ?auth= value', () => {
    expect(readLanding('?auth=ok').auth).toBeNull();
    expect(readLanding('?auth=').auth).toBeNull();
    expect(readLanding('?auth=FAILED').auth).toBeNull();
  });

  it('reads both at once, wherever they sit', () => {
    expect(readLanding('?x=1&auth=failed&user=octocat')).toEqual({ user: 'octocat', auth: 'failed' });
  });
});

describe('withoutLanding', () => {
  it('removes ?user= and ?auth=', () => {
    expect(withoutLanding('?user=octocat')).toBe('');
    expect(withoutLanding('?auth=cancelled')).toBe('');
    expect(withoutLanding('?user=octocat&auth=failed')).toBe('');
  });

  it('keeps other parameters, in order and exactly as written', () => {
    expect(withoutLanding('?a=1&user=octocat&b=x%20y+z&auth=failed&c')).toBe('?a=1&b=x%20y+z&c');
  });

  it('leaves a query without them alone', () => {
    expect(withoutLanding('')).toBe('');
    expect(withoutLanding('?a=1&b=2')).toBe('?a=1&b=2');
  });

  it('removes every copy and every spelling readLanding would read', () => {
    expect(withoutLanding('?user=a&user=b&a=1')).toBe('?a=1');
    expect(withoutLanding('?%75ser=octocat&a=1')).toBe('?a=1');
    expect(readLanding('?%75ser=octocat').user).toBe('octocat');
  });

  it('drops empty pairs left behind', () => {
    expect(withoutLanding('?&user=a&&b=1&')).toBe('?b=1');
  });
});
