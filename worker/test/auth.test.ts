import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { handle, type Env } from '../src/index';

const NOW = new Date('2026-11-06T12:00:00Z');
const ORIGIN = 'https://usage.test';
const SITE = 'https://casta-mere.github.io/better-github-profile/';
const CLIENT_ID = 'Ov23liTestClientId';
const SECRET = 'oauth-app-client-secret-0123456789abcdef';
const CODE = 'one-time-code-5f3c9a';
const TOKEN = 'gho_user-access-token-0123456789';
const LOGIN = 'Octo-Cat';

/** A canned GitHub answer, or a fetch that throws like a network error. */
type Reply = { status?: number; body?: unknown } | 'network-error';

/** What GitHub answers for each of the three calls sign-in makes. */
interface Script {
  exchange?: Reply;
  user?: Reply;
  revoke?: Reply;
}

/** A stand-in for GitHub: records each request and answers by URL. Unknown URLs are a 404. */
function github(script: Script = {}) {
  const calls: Request[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    calls.push(request.clone());
    const reply = replyFor(request, script);
    if (reply === 'network-error') throw new TypeError('Network connection lost.');
    const status = reply.status ?? 200;
    if (status === 204) return new Response(null, { status });
    return typeof reply.body === 'string'
      ? new Response(reply.body, { status })
      : Response.json(reply.body ?? {}, { status });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

function replyFor(request: Request, script: Script): Reply {
  if (request.url === 'https://github.com/login/oauth/access_token') {
    return script.exchange ?? { body: { access_token: TOKEN, token_type: 'bearer', scope: '' } };
  }
  if (request.url === 'https://api.github.com/user') {
    return script.user ?? { body: { login: LOGIN, id: 1 } };
  }
  if (request.url === `https://api.github.com/applications/${CLIENT_ID}/token`) {
    return script.revoke ?? { status: 204 };
  }
  return { status: 404, body: { message: 'Not Found' } };
}

/** `env` with the OAuth App configured, plus `extra`. */
function configured(extra: Partial<Env> = {}): Env {
  return { DB: env.DB, SITE_URL: SITE, GITHUB_CLIENT_ID: CLIENT_ID, GITHUB_CLIENT_SECRET: SECRET, ...extra };
}

interface Options {
  method?: string;
  env?: Env;
  upstream?: ReturnType<typeof github>;
  cookie?: string;
}

function request(path: string, o: Options = {}): Promise<Response> {
  const headers: Record<string, string> = o.cookie ? { cookie: o.cookie } : {};
  const req = new Request(`${ORIGIN}${path}`, { method: o.method ?? 'GET', headers });
  return handle(req, o.env ?? configured(), NOW, { fetch: (o.upstream ?? github()).fetch });
}

function start(returnTo?: string, o: Options = {}): Promise<Response> {
  return request(returnTo === undefined ? '/auth/start' : `/auth/start?return=${encodeURIComponent(returnTo)}`, o);
}

/** Where a redirect goes: the Location header, parsed. */
function location(res: Response): URL {
  expect(res.status).toBe(302);
  return new URL(res.headers.get('location')!);
}

/** The redirect target without its query, and its query as an object. */
function landing(res: Response): { at: string; query: Record<string, string> } {
  const url = location(res);
  return { at: url.origin + url.pathname, query: Object.fromEntries(url.searchParams) };
}

/** The `name=value` part of the Set-Cookie header, and its attributes in lower case. */
function setCookie(res: Response): { pair: string; attributes: string[] } {
  const raw = res.headers.get('set-cookie');
  expect(raw).not.toBeNull();
  const [pair = '', ...attributes] = raw!.split(';').map((part) => part.trim());
  return { pair, attributes: attributes.map((a) => a.toLowerCase()) };
}

/** Runs /auth/start and returns what the browser carries to /auth/callback. */
async function begin(returnTo?: string, e = configured()) {
  const res = await start(returnTo, { env: e });
  return { state: location(res).searchParams.get('state')!, cookie: setCookie(res).pair };
}

/** Starts a sign-in, then comes back to /auth/callback with `query` (default: the code and the right state). */
async function finish(o: { query?: (state: string) => string; returnTo?: string; script?: Script; env?: Env } = {}) {
  const { state, cookie } = await begin(o.returnTo);
  const upstream = github(o.script);
  const query = o.query ? o.query(state) : `code=${CODE}&state=${state}`;
  const res = await request(`/auth/callback?${query}`, { cookie, upstream, env: o.env });
  return { res, upstream, state };
}

/** True when the response's cookie header clears the sign-in cookie. */
function clearsCookie(res: Response): boolean {
  const { pair, attributes } = setCookie(res);
  return pair.endsWith('=') && attributes.includes('max-age=0') && attributes.includes('path=/auth');
}

describe('GET /auth/start', () => {
  it('redirects to GitHub’s authorize page with client_id, redirect_uri and state, and no scope', async () => {
    const upstream = github();
    const res = await start(SITE, { upstream });
    const url = location(res);
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect([...url.searchParams.keys()].sort()).toEqual(['client_id', 'redirect_uri', 'state']);
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`);
    expect(url.searchParams.has('scope')).toBe(false);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(upstream.calls).toEqual([]);
  });

  it('makes a fresh state of at least 128 bits, base64url', async () => {
    const states = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const { state } = await begin();
      expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(state.length * 6).toBeGreaterThanOrEqual(128);
      states.add(state);
    }
    expect(states.size).toBe(5);
  });

  it('sets an HttpOnly, Secure, SameSite=Lax cookie on /auth for 10 minutes', async () => {
    const { pair, attributes } = setCookie(await start(SITE));
    expect(pair).toMatch(/^[A-Za-z0-9_-]+=\S+$/);
    expect(attributes.sort()).toEqual(['httponly', 'max-age=600', 'path=/auth', 'samesite=lax', 'secure']);
  });

  it('the cookie holds the state, never the client secret', async () => {
    const res = await start(SITE);
    const state = location(res).searchParams.get('state')!;
    expect(setCookie(res).pair).toContain(state);
    expect(JSON.stringify(Object.fromEntries(res.headers))).not.toContain(SECRET);
  });
});

describe('/auth: the return URL', () => {
  // Not configured, /auth/start redirects straight back: the clearest view of the chosen URL.
  const bare = configured({ GITHUB_CLIENT_ID: undefined });

  it.each([
    ['the site', SITE, SITE],
    ['a page under the site', `${SITE}index.html`, `${SITE}index.html`],
    ['the site with a query and a hash, dropped', `${SITE}?theme=dark&user=old#step-2`, SITE],
    ['local vite dev', 'http://localhost:5173/', 'http://localhost:5173/'],
    ['local vite preview with a path', 'http://127.0.0.1:4173/better-github-profile/', 'http://127.0.0.1:4173/better-github-profile/'],
    ['localhost without a port', 'http://localhost/', 'http://localhost/'],
  ])('accepts %s', async (_name, given, expected) => {
    expect(landing(await start(given, { env: bare })).at).toBe(expected);
  });

  it.each([
    ['a foreign origin', 'https://evil.test/better-github-profile/'],
    ['a look-alike host', 'https://casta-mere.github.io.evil.test/better-github-profile/'],
    ['a look-alike path', 'https://casta-mere.github.io/better-github-profile-evil/'],
    ['another path on the same host', 'https://casta-mere.github.io/other-repo/'],
    ['the host root', 'https://casta-mere.github.io/'],
    ['the site path without its trailing slash', 'https://casta-mere.github.io/better-github-profile'],
    ['a dot segment climbing out', 'https://casta-mere.github.io/better-github-profile/../other-repo/'],
    ['an encoded dot segment climbing out', 'https://casta-mere.github.io/better-github-profile/%2e%2e/other-repo/'],
    ['the site over http', 'http://casta-mere.github.io/better-github-profile/'],
    ['localhost over https', 'https://localhost:5173/'],
    ['a localhost look-alike', 'http://localhost.evil.test:5173/'],
    ['another local address', 'http://192.168.1.10:5173/'],
    ['a protocol-relative URL', '//evil.test/'],
    ['a relative path', '/better-github-profile/'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:text/html,hi'],
    ['not a URL', 'not a url'],
    ['an empty value', ''],
  ])('falls back to SITE_URL for %s', async (_name, given) => {
    expect(landing(await start(given, { env: bare }))).toEqual({ at: SITE, query: { auth: 'unavailable' } });
  });

  it('falls back to SITE_URL without a return parameter', async () => {
    expect(landing(await start(undefined, { env: bare }))).toEqual({ at: SITE, query: { auth: 'unavailable' } });
  });

  it('keeps userinfo out: only origin and path are used', async () => {
    expect(landing(await start(`https://user:pass@casta-mere.github.io/better-github-profile/`, { env: bare })).at).toBe(SITE);
  });

  it('carries the accepted return URL through GitHub to the callback', async () => {
    const { res } = await finish({ returnTo: 'http://localhost:5173/' });
    expect(landing(res)).toEqual({ at: 'http://localhost:5173/', query: { user: LOGIN } });
  });

  it('checks the return URL in the cookie again at the callback', async () => {
    const { state, cookie } = await begin(SITE);
    const forged = `${cookie.split('=')[0]}=${state}.${encodeURIComponent('https://evil.test/')}`;
    const res = await request(`/auth/callback?code=${CODE}&state=${state}`, { cookie: forged });
    expect(landing(res)).toEqual({ at: SITE, query: { user: LOGIN } });
  });
});

describe('/auth: not configured', () => {
  it.each([
    ['no client id', { GITHUB_CLIENT_ID: undefined }],
    ['no client secret', { GITHUB_CLIENT_SECRET: undefined }],
    ['neither', { GITHUB_CLIENT_ID: undefined, GITHUB_CLIENT_SECRET: undefined }],
    ['an empty client id', { GITHUB_CLIENT_ID: '' }],
    ['an empty client secret', { GITHUB_CLIENT_SECRET: '' }],
  ])('/auth/start with %s: back to the page with ?auth=unavailable, no cookie', async (_name, extra) => {
    const upstream = github();
    const res = await start('http://localhost:5173/', { env: configured(extra), upstream });
    expect(landing(res)).toEqual({ at: 'http://localhost:5173/', query: { auth: 'unavailable' } });
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(upstream.calls).toEqual([]);
  });

  it('/auth/callback: ?auth=unavailable without calling GitHub, and the cookie is cleared', async () => {
    const { res, upstream } = await finish({ env: configured({ GITHUB_CLIENT_SECRET: undefined }) });
    expect(landing(res)).toEqual({ at: SITE, query: { auth: 'unavailable' } });
    expect(clearsCookie(res)).toBe(true);
    expect(upstream.calls).toEqual([]);
  });

  it('without SITE_URL there is nowhere safe to go back to: 503', async () => {
    const res = await start(SITE, { env: configured({ SITE_URL: undefined }) });
    expect(res.status).toBe(503);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('GET /auth/callback: success', () => {
  it('redirects to the page with only ?user=<login>, as GitHub spells it', async () => {
    const { res } = await finish();
    expect(landing(res)).toEqual({ at: SITE, query: { user: LOGIN } });
  });

  it('exchanges the code with the client id and secret, asking for JSON', async () => {
    const { upstream } = await finish();
    const exchange = upstream.calls[0]!;
    expect(exchange.url).toBe('https://github.com/login/oauth/access_token');
    expect(exchange.method).toBe('POST');
    expect(exchange.headers.get('accept')).toBe('application/json');
    expect(exchange.headers.get('content-type')).toMatch(/^application\/x-www-form-urlencoded/);
    expect(Object.fromEntries(await exchange.formData())).toEqual({
      client_id: CLIENT_ID,
      client_secret: SECRET,
      code: CODE,
      redirect_uri: `${ORIGIN}/auth/callback`,
    });
  });

  it('reads the login from GET /user with the token and the GitHub API headers', async () => {
    const { upstream } = await finish();
    const user = upstream.calls[1]!;
    expect(user.url).toBe('https://api.github.com/user');
    expect(user.method).toBe('GET');
    expect(user.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(user.headers.get('accept')).toBe('application/vnd.github+json');
    expect(user.headers.get('x-github-api-version')).toBe('2022-11-28');
    expect(user.headers.get('user-agent')).toBe('better-github-profile-usage');
  });

  it('revokes the token with Basic client auth, and keeps the grant', async () => {
    const { upstream } = await finish();
    expect(upstream.calls.map((r) => `${r.method} ${r.url}`)).toEqual([
      'POST https://github.com/login/oauth/access_token',
      'GET https://api.github.com/user',
      `DELETE https://api.github.com/applications/${CLIENT_ID}/token`,
    ]);
    const revoke = upstream.calls[2]!;
    expect(revoke.headers.get('authorization')).toBe(`Basic ${btoa(`${CLIENT_ID}:${SECRET}`)}`);
    expect(revoke.headers.get('accept')).toBe('application/vnd.github+json');
    expect(revoke.headers.get('x-github-api-version')).toBe('2022-11-28');
    expect(revoke.headers.get('user-agent')).toBe('better-github-profile-usage');
    expect(await revoke.json()).toEqual({ access_token: TOKEN });
  });

  it('clears the cookie, and sends no-store and no-referrer', async () => {
    const { res } = await finish();
    expect(clearsCookie(res)).toBe(true);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('never puts the token, the code or the secret in the answer', async () => {
    const { res } = await finish();
    const headers = JSON.stringify(Object.fromEntries(res.headers));
    const body = await res.text();
    for (const secret of [TOKEN, CODE, SECRET]) {
      expect(headers).not.toContain(secret);
      expect(body).not.toContain(secret);
    }
  });

  it('a failed revoke still signs in', async () => {
    for (const revoke of [{ status: 500 }, { status: 404 }, 'network-error'] as const) {
      const { res } = await finish({ script: { revoke } });
      expect(landing(res), JSON.stringify(revoke)).toEqual({ at: SITE, query: { user: LOGIN } });
    }
  });
});

describe('GET /auth/callback: failures', () => {
  /** Asserts the answer lands on the site with `?auth=<outcome>`, clears the cookie and leaks nothing. */
  async function expectOutcome(res: Response, outcome: 'cancelled' | 'failed') {
    expect(landing(res)).toEqual({ at: SITE, query: { auth: outcome } });
    expect(clearsCookie(res)).toBe(true);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const all = JSON.stringify(Object.fromEntries(res.headers)) + (await res.text());
    for (const secret of [TOKEN, CODE, SECRET]) expect(all).not.toContain(secret);
  }

  it('access_denied (the user declined): ?auth=cancelled, GitHub not called', async () => {
    const { res, upstream } = await finish({ query: (state) => `error=access_denied&state=${state}` });
    await expectOutcome(res, 'cancelled');
    expect(upstream.calls).toEqual([]);
  });

  it('declining keeps the page the sign-in started from', async () => {
    const { res } = await finish({ returnTo: 'http://localhost:5173/', query: (s) => `error=access_denied&state=${s}` });
    expect(landing(res)).toEqual({ at: 'http://localhost:5173/', query: { auth: 'cancelled' } });
  });

  it.each(['redirect_uri_mismatch', 'application_suspended', 'unknown'])('error=%s: ?auth=failed', async (error) => {
    const { res, upstream } = await finish({ query: (state) => `error=${error}&state=${state}` });
    await expectOutcome(res, 'failed');
    expect(upstream.calls).toEqual([]);
  });

  it('no cookie: ?auth=failed, GitHub not called', async () => {
    const { state } = await begin();
    const upstream = github();
    const res = await request(`/auth/callback?code=${CODE}&state=${state}`, { upstream });
    await expectOutcome(res, 'failed');
    expect(upstream.calls).toEqual([]);
  });

  it.each([
    ['a different state', () => 'x'.repeat(43)],
    ['a state one character off', (state: string) => state.slice(0, -1) + (state.endsWith('A') ? 'B' : 'A')],
    ['an empty state', () => ''],
  ])('%s: ?auth=failed, GitHub not called', async (_name, wrong) => {
    const { res, upstream } = await finish({ query: (state) => `code=${CODE}&state=${encodeURIComponent(wrong(state))}` });
    await expectOutcome(res, 'failed');
    expect(upstream.calls).toEqual([]);
  });

  it('no state: ?auth=failed', async () => {
    const { res, upstream } = await finish({ query: () => `code=${CODE}` });
    await expectOutcome(res, 'failed');
    expect(upstream.calls).toEqual([]);
  });

  it('a malformed cookie: ?auth=failed', async () => {
    const { state, cookie } = await begin();
    const name = cookie.split('=')[0];
    for (const value of ['', state, `${state}.%E0%A4%A`, '.']) {
      const upstream = github();
      const res = await request(`/auth/callback?code=${CODE}&state=${state}`, { cookie: `${name}=${value}`, upstream });
      await expectOutcome(res, 'failed');
      expect(upstream.calls, value).toEqual([]);
    }
  });

  it('no code: ?auth=failed', async () => {
    const { res, upstream } = await finish({ query: (state) => `state=${state}` });
    await expectOutcome(res, 'failed');
    expect(upstream.calls).toEqual([]);
  });

  it.each([
    ['a non-2xx answer', { status: 500 }],
    ['an error field', { body: { error: 'bad_verification_code', error_description: 'The code is incorrect.' } }],
    ['no access_token', { body: { token_type: 'bearer' } }],
    ['an empty access_token', { body: { access_token: '' } }],
    ['a body that is not JSON', { body: 'access_token=gho_x&token_type=bearer' }],
    ['a network error', 'network-error' as const],
  ])('code exchange with %s: ?auth=failed, nothing more asked', async (_name, exchange) => {
    const { res, upstream } = await finish({ script: { exchange } });
    await expectOutcome(res, 'failed');
    expect(upstream.calls.map((r) => r.url)).toEqual(['https://github.com/login/oauth/access_token']);
  });

  it.each([
    ['401', { status: 401, body: { message: 'Bad credentials' } }],
    ['500', { status: 500 }],
    ['a network error', 'network-error' as const],
    ['no login', { body: { id: 1 } }],
    ['a login with a leading hyphen', { body: { login: '-octo' } }],
    ['a login with an underscore', { body: { login: 'oc_to' } }],
    ['a login of 40 characters', { body: { login: 'a'.repeat(40) } }],
    ['a login that is not a string', { body: { login: 42 } }],
    ['a body that is not JSON', { body: '<html>' }],
  ])('GET /user with %s: ?auth=failed, and the token is still revoked', async (_name, user) => {
    const { res, upstream } = await finish({ script: { user } });
    await expectOutcome(res, 'failed');
    expect(upstream.calls.map((r) => r.method)).toEqual(['POST', 'GET', 'DELETE']);
    expect(await upstream.calls[2]!.json()).toEqual({ access_token: TOKEN });
  });
});

describe('/auth/*: methods and paths', () => {
  it.each(['/auth/start', '/auth/callback'])('%s answers only GET: other methods are 405', async (path) => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const upstream = github();
      const res = await request(path, { method, upstream });
      expect(res.status, method).toBe(405);
      expect(res.headers.get('allow')).toBe('GET');
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(upstream.calls).toEqual([]);
    }
  });

  it.each(['/auth/', '/auth/token', '/auth/start/', '/auth/start/x', '/auth/logout'])('%s is 404', async (path) => {
    for (const method of ['GET', 'POST']) {
      expect((await request(path, { method })).status, method).toBe(404);
    }
  });
});

describe('deployed entry point', () => {
  it('wrangler.toml sets SITE_URL to the selector page', () => {
    expect(env.SITE_URL).toBe(SITE);
  });

  it('serves /auth/start, and without the OAuth App secrets says sign-in is unavailable', async () => {
    const res = await exports.default.fetch(`${ORIGIN}/auth/start?return=${encodeURIComponent(SITE)}`, { redirect: 'manual' });
    expect(landing(res)).toEqual({ at: SITE, query: { auth: 'unavailable' } });
  });
});
