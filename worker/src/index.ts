/**
 * Usage counter for better-github-profile.
 *
 * The Action posts `{ id, version, theme }` once per run, where `id` is a pseudonymous
 * SHA-256 hex of the repository ID. Runs are daily, so we keep one row per (id, ISO week)
 * and only ever report counts of distinct ids, never hits.
 *
 * It also serves `GET /gh/<path>`, the selector page's read-only GitHub proxy (./proxy.ts),
 * `GET /profile/<login>`, a user's public data for the page's live preview (./profile.ts),
 * and `GET /auth/start` + `GET /auth/callback`, the page's "Sign in with GitHub" (./auth.ts):
 * it sends back only the login and revokes the token, which never leaves the Worker.
 */

import { auth } from './auth';
import { profile } from './profile';
import { proxy, type Deps } from './proxy';

export type { Deps } from './proxy';

export interface Env {
  DB: D1Database;
  /** The owner's no-permission GitHub token for /gh and /profile: a secret (`wrangler secret put GITHUB_TOKEN`). Unset, both answer 503. */
  GITHUB_TOKEN?: string;
  /** The per-IP limit for /gh (`[[ratelimits]]` in wrangler.toml); skipped when absent. */
  CHECK_LIMIT?: RateLimit;
  /** The per-IP limit for /profile (`[[ratelimits]]` in wrangler.toml); skipped when absent. */
  PROFILE_LIMIT?: RateLimit;
  /** The selector page, where /auth sends the browser back to: a `[vars]` entry in wrangler.toml. */
  SITE_URL?: string;
  /** The OAuth App for /auth: secrets (`wrangler secret put`). Either one unset, sign-in is "unavailable". */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}

interface Ping {
  id: string;
  version: string;
  theme: string;
}

type Handler = (request: Request, env: Env, now: Date) => Promise<Response>;

const ID = /^[0-9a-f]{64}$/;
const THEME = /^[a-z]{1,20}$/;
const VERSION = /^[0-9A-Za-z.\-]{1,32}$/;

const ROUTES = new Map<string, { method: string; handler: Handler }>([
  ['/ping', { method: 'POST', handler: ping }],
  ['/stats', { method: 'GET', handler: stats }],
  ['/badge', { method: 'GET', handler: badge }],
]);

/** ISO 8601 week of `now` in UTC, like `2026-W45`. The week belongs to the year holding its Thursday. */
export function isoWeek(now: Date): string {
  const thursday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekday = thursday.getUTCDay() || 7; // Monday = 1 … Sunday = 7
  thursday.setUTCDate(thursday.getUTCDate() + 4 - weekday);
  const year = thursday.getUTCFullYear();
  const dayOfYear = (thursday.getTime() - Date.UTC(year, 0, 1)) / 86_400_000; // 0-based
  const week = Math.floor(dayOfYear / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * Routes one request. `now` is injected so the ISO week is deterministic in tests, and `deps`
 * so tests answer for GitHub.
 */
export async function handle(request: Request, env: Env, now: Date, deps: Deps = {}): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname.startsWith('/gh/')) {
    return proxy(request, env, deps);
  }
  if (pathname.startsWith('/profile/')) {
    return profile(request, env, deps);
  }
  if (pathname.startsWith('/auth/')) {
    return auth(request, env, deps);
  }
  const route = ROUTES.get(pathname);
  if (!route) {
    return new Response('Not Found', { status: 404 });
  }
  if (request.method !== route.method) {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: route.method } });
  }
  return route.handler(request, env, now);
}

async function ping(request: Request, env: Env, now: Date): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  if (!isPing(body)) {
    return new Response('Bad Request', { status: 400 });
  }
  await env.DB.prepare('INSERT OR REPLACE INTO pings (id, week, theme, version) VALUES (?1, ?2, ?3, ?4)')
    .bind(body.id, isoWeek(now), body.theme, body.version)
    .run();
  return new Response(null, { status: 204 });
}

async function stats(_request: Request, env: Env, now: Date): Promise<Response> {
  const [allTime, thisWeek, themes] = await Promise.all([
    countIds(env),
    env.DB.prepare('SELECT COUNT(DISTINCT id) AS ids FROM pings WHERE week = ?1').bind(isoWeek(now)).first<number>('ids'),
    // Each id counts once, under the theme from its latest week.
    env.DB.prepare(
      `SELECT theme, COUNT(*) AS ids FROM pings AS p
       WHERE week = (SELECT MAX(week) FROM pings WHERE id = p.id)
       GROUP BY theme ORDER BY theme`,
    ).all<{ theme: string; ids: number }>(),
  ]);
  const byTheme = Object.fromEntries(themes.results.map((row) => [row.theme, row.ids]));
  return publicJson({ allTime, thisWeek: thisWeek ?? 0, byTheme });
}

async function badge(_request: Request, env: Env): Promise<Response> {
  const n = await countIds(env);
  return publicJson({
    schemaVersion: 1,
    label: 'used by',
    message: `${n} ${n === 1 ? 'profile' : 'profiles'}`,
    color: '2ea44f',
  });
}

async function countIds(env: Env): Promise<number> {
  return (await env.DB.prepare('SELECT COUNT(DISTINCT id) AS ids FROM pings').first<number>('ids')) ?? 0;
}

function isPing(body: unknown): body is Ping {
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  const { id, version, theme } = body as Record<string, unknown>;
  return matches(ID, id) && matches(VERSION, version) && matches(THEME, theme);
}

function matches(pattern: RegExp, value: unknown): value is string {
  return typeof value === 'string' && pattern.test(value);
}

function publicJson(body: unknown): Response {
  return Response.json(body, {
    headers: { 'cache-control': 'max-age=3600', 'access-control-allow-origin': '*' },
  });
}

export default {
  fetch(request, env) {
    return handle(request, env, new Date());
  },
} satisfies ExportedHandler<Env>;
