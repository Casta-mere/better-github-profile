/**
 * `GET /gh/<path>`: a read-only GitHub REST proxy for the selector page's setup check and
 * username lookup. Unauthenticated browser calls get 60 requests an hour per IP; through here
 * they use the owner's token (5,000 an hour), which never leaves the Worker.
 *
 * Only the reads the page makes are allowed, and only on profile repositories `<u>/<u>`.
 * Answers are cached for 30 s, and each IP is limited by the optional CHECK_LIMIT binding.
 */

import type { Env } from './index';

/** Injected in tests: the upstream fetch and the cache (default `caches.default`). */
export interface Deps {
  fetch?: typeof fetch;
  cache?: Cache;
}

const API = 'https://api.github.com';
/** GitHub's username rule, the same as `src/snippets/links.ts`. */
export const USER = '[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}';
/** `<u>/<u>` itself, any file or directory in it, or the Actions reads `site/check.ts` makes. */
const ALLOWED = new RegExp(
  `^/repos/(${USER})/(${USER})` +
    '(?:' +
    '/contents/(.+)' +
    '|/actions/workflows/[A-Za-z0-9._-]+\\.yml/runs' +
    '|/actions/runs/\\d+/jobs' +
    '|/check-runs/\\d+/annotations' +
    ')?$',
);

const CORS = { 'access-control-allow-origin': '*' };
/** The upstream headers the page reads; everything else (cookies, ETag, scopes…) stays here. */
const PASSED_HEADERS = ['content-type', 'x-ratelimit-remaining'];
/** Statuses kept in the cache. Others, like the rate limit, must be asked again. */
const CACHED = new Set([200, 404]);
const CACHE_SECONDS = 30;
/** Statuses whose response can't carry a body. */
const NO_BODY = new Set([101, 204, 205, 304]);

/**
 * A contents path is safe when no segment, once decoded, is empty, `.` or `..`, or hides a
 * slash: dot segments in the URL are resolved before routing, but `%2F` would let GitHub see
 * a path outside `<u>/<u>/contents`.
 */
function safeContentsPath(path: string): boolean {
  return path.split('/').every((segment) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return false;
    }
    return decoded !== '' && decoded !== '.' && decoded !== '..' && !/[/\\]/.test(decoded);
  });
}

function allowed(path: string): boolean {
  const match = ALLOWED.exec(path);
  if (!match) return false;
  const [, owner = '', repo = '', contents] = match;
  return owner.toLowerCase() === repo.toLowerCase() && (contents === undefined || safeContentsPath(contents));
}

/** Only `per_page` (1–3 digits, at most 100) goes upstream. */
function upstreamQuery(params: URLSearchParams): string {
  const perPage = params.get('per_page');
  if (perPage === null || !/^\d{1,3}$/.test(perPage) || Number(perPage) > 100) return '';
  return `?per_page=${Number(perPage)}`;
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...CORS, 'cache-control': 'no-store', ...headers } });
}

/** Handles `/gh/<path>`; `request.url`'s path starts with `/gh/`. */
export async function proxy(
  request: Request,
  env: Pick<Env, 'GITHUB_TOKEN' | 'CHECK_LIMIT'>,
  deps: Deps = {},
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice('/gh'.length);
  if (!allowed(path)) {
    return new Response('Not Found', { status: 404, headers: CORS });
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS,
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'Accept',
        'access-control-max-age': '86400',
      },
    });
  }
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: { ...CORS, allow: 'GET, OPTIONS' } });
  }
  // No secret: say so at once, and the page asks GitHub directly instead.
  if (!env.GITHUB_TOKEN) {
    return json({ error: 'proxy not configured' }, 503);
  }
  if (env.CHECK_LIMIT) {
    const { success } = await env.CHECK_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' });
    // The page reads `x-ratelimit-remaining: 0` (or a 429) as "rate limited".
    if (!success) return json({ error: 'rate limited' }, 429, { 'x-ratelimit-remaining': '0' });
  }

  const target = `${API}${path}${upstreamQuery(url.searchParams)}`;
  const cache = deps.cache ?? caches.default;
  const key = new Request(target);
  const hit = await cache.match(key);
  if (hit) return hit;

  let upstream: Response;
  try {
    upstream = await (deps.fetch ?? fetch)(target, {
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'better-github-profile-usage',
      },
    });
  } catch {
    return json({ error: 'GitHub unreachable' }, 502);
  }

  const keep = CACHED.has(upstream.status);
  const headers = new Headers({ ...CORS, 'cache-control': keep ? `max-age=${CACHE_SECONDS}` : 'no-store' });
  for (const name of PASSED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const body = NO_BODY.has(upstream.status) ? null : await upstream.arrayBuffer();
  if (keep) await cache.put(key, new Response(body, { status: upstream.status, headers }));
  return new Response(body, { status: upstream.status, headers });
}
