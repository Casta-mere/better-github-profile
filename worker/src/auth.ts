/**
 * `GET /auth/start` and `GET /auth/callback`: "Sign in with GitHub" for the selector page, so
 * it can fill in the username. A static page can't see who is signed in to github.com, so the
 * Worker runs a GitHub OAuth App sign-in with no scopes (public identity only), reads the
 * login, revokes the token and sends the browser back with `?user=<login>`. The token and the
 * code never leave the Worker: not in a response, a header or a log.
 *
 * The page links to `/auth/start?return=<its origin + path>`, and the Worker always ends by
 * redirecting back there with exactly one of `?user=<login>`, `?auth=cancelled`,
 * `?auth=failed` or `?auth=unavailable` (no OAuth App configured). The return URL is checked
 * against an allowlist on the way in and again on the way back: no open redirect.
 */

import type { Env } from './index';
import type { Deps } from './proxy';

type AuthEnv = Pick<Env, 'SITE_URL' | 'GITHUB_CLIENT_ID' | 'GITHUB_CLIENT_SECRET'>;

/** How a sign-in ends, as the query parameter the page reads. */
type Outcome = { user: string } | { auth: 'cancelled' | 'failed' | 'unavailable' };

const AUTHORIZE = 'https://github.com/login/oauth/authorize';
const EXCHANGE = 'https://github.com/login/oauth/access_token';
const API = 'https://api.github.com';
/** GitHub's API headers, the same as `./proxy.ts`. */
const API_HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'better-github-profile-usage',
};
/**
 * GitHub's username rule, the same as `./proxy.ts` and `src/snippets/links.ts`. A login that
 * doesn't pass it is not something to put in the page.
 */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/**
 * The cookie that carries the state and the return URL from /auth/start to /auth/callback,
 * as `<state>.<URL-encoded return URL>`. Scoped to /auth and gone after 10 minutes.
 */
const COOKIE = 'bgp_auth';
const COOKIE_ATTRIBUTES = 'Path=/auth; HttpOnly; Secure; SameSite=Lax';
const COOKIE_SECONDS = 600;
/** 32 random bytes: 256 bits of state. */
const STATE_BYTES = 32;

const ROUTES = new Map<string, (request: Request, env: AuthEnv, site: URL, deps: Deps) => Promise<Response>>([
  ['/auth/start', start],
  ['/auth/callback', callback],
]);

/** Handles `/auth/<path>`; `request.url`'s path starts with `/auth/`. */
export async function auth(request: Request, env: AuthEnv, deps: Deps = {}): Promise<Response> {
  const route = ROUTES.get(new URL(request.url).pathname);
  if (!route) {
    return new Response('Not Found', { status: 404 });
  }
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET' } });
  }
  const site = parse(env.SITE_URL);
  // Without the site there is no safe page to send the browser back to. wrangler.toml sets it.
  if (!site) {
    return new Response('Sign-in is not set up: SITE_URL is missing.', {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    });
  }
  return route(request, env, site, deps);
}

/** Sends the browser to GitHub's consent page, remembering the state and the return URL in a cookie. */
async function start(request: Request, env: AuthEnv, site: URL): Promise<Response> {
  const url = new URL(request.url);
  const back = returnUrl(url.searchParams.get('return'), site);
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return redirect(back, { auth: 'unavailable' });
  }
  const state = randomState();
  const authorize = new URL(AUTHORIZE);
  authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', callbackUrl(url));
  authorize.searchParams.set('state', state);
  // No `scope`: the token can read only public profile information, and is revoked at once.
  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.href,
      'set-cookie': `${COOKIE}=${state}.${encodeURIComponent(back)}; ${COOKIE_ATTRIBUTES}; Max-Age=${COOKIE_SECONDS}`,
      'cache-control': 'no-store',
    },
  });
}

/** GitHub sends the browser here with `code` and `state`, or with `error`. */
async function callback(request: Request, env: AuthEnv, site: URL, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  const saved = readCookie(request);
  const back = returnUrl(saved?.back, site);
  const done = (outcome: Outcome) => {
    const res = redirect(back, outcome);
    res.headers.set('set-cookie', `${COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`);
    // The URL holds the code: the next page must not see it through Referer.
    res.headers.set('referrer-policy', 'no-referrer');
    return res;
  };

  const error = url.searchParams.get('error');
  if (error !== null) {
    return done({ auth: error === 'access_denied' ? 'cancelled' : 'failed' });
  }
  const { GITHUB_CLIENT_ID: clientId, GITHUB_CLIENT_SECRET: clientSecret } = env;
  if (!clientId || !clientSecret) {
    return done({ auth: 'unavailable' });
  }
  const state = url.searchParams.get('state');
  if (!saved || state === null || !sameString(state, saved.state)) {
    return done({ auth: 'failed' });
  }
  const code = url.searchParams.get('code');
  if (!code) {
    return done({ auth: 'failed' });
  }

  const fetcher = deps.fetch ?? fetch;
  const token = await exchange(fetcher, { clientId, clientSecret, code, redirectUri: callbackUrl(url) });
  if (!token) {
    return done({ auth: 'failed' });
  }
  const login = await readLogin(fetcher, token);
  await revoke(fetcher, clientId, clientSecret, token);
  return done(login ? { user: login } : { auth: 'failed' });
}

/** Trades the code for a token; null on any failure. */
async function exchange(
  fetcher: typeof fetch,
  o: { clientId: string; clientSecret: string; code: string; redirectUri: string },
): Promise<string | null> {
  try {
    const res = await fetcher(EXCHANGE, {
      method: 'POST',
      headers: { accept: 'application/json', 'user-agent': API_HEADERS['user-agent'] },
      body: new URLSearchParams({
        client_id: o.clientId,
        client_secret: o.clientSecret,
        code: o.code,
        redirect_uri: o.redirectUri,
      }),
    });
    if (!res.ok) return null;
    // GitHub reports a bad or expired code as a 200 with an `error` field.
    const body = (await res.json()) as Record<string, unknown> | null;
    if (!body || 'error' in body) return null;
    const token = body.access_token;
    return typeof token === 'string' && token !== '' ? token : null;
  } catch {
    return null;
  }
}

/** The signed-in user's login from `GET /user`; null on any failure or an implausible login. */
async function readLogin(fetcher: typeof fetch, token: string): Promise<string | null> {
  try {
    const res = await fetcher(`${API}/user`, { headers: { ...API_HEADERS, authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown> | null;
    const login = body?.login;
    return typeof login === 'string' && LOGIN.test(login) ? login : null;
  } catch {
    return null;
  }
}

/**
 * Revokes the token: the Worker needed it for one call. Best effort, so a failure here doesn't
 * change the outcome. The grant stays (no `DELETE /grant`), so a returning user isn't asked to
 * consent again.
 */
async function revoke(fetcher: typeof fetch, clientId: string, clientSecret: string, token: string): Promise<void> {
  try {
    await fetcher(`${API}/applications/${encodeURIComponent(clientId)}/token`, {
      method: 'DELETE',
      headers: {
        ...API_HEADERS,
        authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ access_token: token }),
    });
  } catch {
    // Nothing to do: the token has no scopes, and GitHub expires unused ones.
  }
}

/**
 * The page to send the browser back to: `raw` when it parses and is either the site (its
 * origin, under its path) or local dev (`http://localhost` or `http://127.0.0.1`, any port).
 * Only origin and path are kept. Anything else, or nothing, is the site itself.
 */
function returnUrl(raw: string | null | undefined, site: URL): string {
  const url = parse(raw);
  if (url) {
    const onSite = url.origin === site.origin && url.pathname.startsWith(site.pathname);
    const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if (onSite || local) return url.origin + url.pathname;
  }
  return site.origin + site.pathname;
}

/** 302 to `back` (origin + path, no query) with the outcome as its only query parameter. */
function redirect(back: string, outcome: Outcome): Response {
  const target = new URL(back);
  for (const [name, value] of Object.entries(outcome)) target.searchParams.set(name, value);
  return new Response(null, { status: 302, headers: { location: target.href, 'cache-control': 'no-store' } });
}

/** This Worker's own callback URL, which must match the OAuth App's registered one. */
function callbackUrl(url: URL): string {
  return `${url.origin}/auth/callback`;
}

/** The state and return URL saved by /auth/start, or null when the cookie is missing or malformed. */
function readCookie(request: Request): { state: string; back: string } | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== COOKIE) continue;
    const value = rest.join('=');
    const dot = value.indexOf('.');
    if (dot <= 0) return null;
    try {
      return { state: value.slice(0, dot), back: decodeURIComponent(value.slice(dot + 1)) };
    } catch {
      return null;
    }
  }
  return null;
}

/** A fresh random state, base64url without padding. */
function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(STATE_BYTES));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Compares two strings in time that depends only on their lengths. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function parse(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}
