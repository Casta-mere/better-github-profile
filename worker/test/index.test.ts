import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { handle, isoWeek } from '../src/index';

// Friday of ISO week 2026-W45, and the same weekday one week earlier (2026-W44).
const NOW = new Date('2026-11-06T12:00:00Z');
const LAST_WEEK = new Date('2026-10-30T12:00:00Z');

const ID_A = 'a'.repeat(64);
const ID_B = 'b'.repeat(64);
const ID_C = '0123456789abcdef'.repeat(4);

const ORIGIN = 'https://usage.test';

function ping(body: unknown, now = NOW): Promise<Response> {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const request = new Request(`${ORIGIN}/ping`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw,
  });
  return handle(request, env, now);
}

function get(path: string, now = NOW): Promise<Response> {
  return handle(new Request(`${ORIGIN}${path}`), env, now);
}

async function rows() {
  const { results } = await env.DB.prepare('SELECT id, week, theme, version FROM pings ORDER BY week, id').all();
  return results;
}

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM pings').run();
});

describe('isoWeek', () => {
  it.each([
    ['2026-11-06T12:00:00Z', '2026-W45'],
    ['2026-11-02T00:00:00Z', '2026-W45'], // Monday starts the week
    ['2026-11-08T23:59:59Z', '2026-W45'], // Sunday ends it
    ['2026-11-09T00:00:00Z', '2026-W46'],
    ['2026-01-05T08:00:00Z', '2026-W02'], // zero-padded
    ['2027-01-01T00:00:00Z', '2026-W53'], // 2026 starts on a Thursday, so it has 53 weeks
    ['2024-12-30T00:00:00Z', '2025-W01'], // late December can belong to next year
    ['2021-01-03T12:00:00Z', '2020-W53'], // early January can belong to last year
  ])('%s is %s', (iso, week) => {
    expect(isoWeek(new Date(iso))).toBe(week);
  });

  it('uses UTC, not the caller time zone', () => {
    // 23:30 on Sunday in New York is already Monday in UTC.
    expect(isoWeek(new Date('2026-11-08T23:30:00-05:00'))).toBe('2026-W46');
  });
});

describe('POST /ping', () => {
  it('stores one row per id per ISO week', async () => {
    expect((await ping({ id: ID_A, version: '1.0.0', theme: 'native' })).status).toBe(204);
    expect((await ping({ id: ID_A, version: '1.0.1', theme: 'strip' })).status).toBe(204);

    expect(await rows()).toEqual([{ id: ID_A, week: '2026-W45', theme: 'strip', version: '1.0.1' }]);

    expect((await ping({ id: ID_A, version: '1.0.0', theme: 'native' }, LAST_WEEK)).status).toBe(204);
    expect(await rows()).toEqual([
      { id: ID_A, week: '2026-W44', theme: 'native', version: '1.0.0' },
      { id: ID_A, week: '2026-W45', theme: 'strip', version: '1.0.1' },
    ]);
  });

  it('ignores extra keys', async () => {
    const res = await ping({ id: ID_A, version: '1.0.0', theme: 'native', login: 'octocat', stars: 9 });
    expect(res.status).toBe(204);
    expect(await rows()).toEqual([{ id: ID_A, week: '2026-W45', theme: 'native', version: '1.0.0' }]);
  });

  it('accepts the edges of each format', async () => {
    const ok = [
      { id: ID_C, version: '1', theme: 'a' },
      { id: ID_C, version: 'v1.2.3-rc.1', theme: 'strip' },
      { id: ID_C, version: 'x'.repeat(32), theme: 'z'.repeat(20) },
    ];
    for (const body of ok) {
      expect((await ping(body)).status, JSON.stringify(body)).toBe(204);
    }
  });

  it.each([
    ['id too short', { id: 'abc', version: '1.0.0', theme: 'native' }],
    ['id uppercase hex', { id: 'A'.repeat(64), version: '1.0.0', theme: 'native' }],
    ['id 65 chars', { id: 'a'.repeat(65), version: '1.0.0', theme: 'native' }],
    ['id not a string', { id: 12345, version: '1.0.0', theme: 'native' }],
    ['missing id', { version: '1.0.0', theme: 'native' }],
    ['missing theme', { id: ID_A, version: '1.0.0' }],
    ['theme with uppercase', { id: ID_A, version: '1.0.0', theme: 'Native' }],
    ['theme too long', { id: ID_A, version: '1.0.0', theme: 'a'.repeat(21) }],
    ['theme empty', { id: ID_A, version: '1.0.0', theme: '' }],
    ['missing version', { id: ID_A, theme: 'native' }],
    ['version with a space', { id: ID_A, version: '1.0 beta', theme: 'native' }],
    ['version too long', { id: ID_A, version: '1'.repeat(33), theme: 'native' }],
    ['version empty', { id: ID_A, version: '', theme: 'native' }],
    ['non-JSON body', 'not json'],
    ['empty body', ''],
    ['JSON null', 'null'],
    ['JSON array', JSON.stringify([ID_A, '1.0.0', 'native'])],
    ['JSON string', JSON.stringify(ID_A)],
  ])('rejects %s with 400', async (_name, body) => {
    expect((await ping(body)).status).toBe(400);
    expect(await rows()).toEqual([]);
  });
});

describe('GET /stats', () => {
  it('counts distinct ids', async () => {
    await ping({ id: ID_A, version: '1.0.0', theme: 'native' });
    await ping({ id: ID_A, version: '1.0.0', theme: 'native' });
    await ping({ id: ID_B, version: '1.0.0', theme: 'native' });
    await ping({ id: ID_C, version: '1.0.0', theme: 'strip' }, LAST_WEEK);

    const res = await get('/stats');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allTime: 3, thisWeek: 2, byTheme: { native: 2, strip: 1 } });
  });

  it('counts each id under its most recent theme', async () => {
    await ping({ id: ID_A, version: '1.0.0', theme: 'native' }, LAST_WEEK);
    await ping({ id: ID_A, version: '1.0.0', theme: 'strip' });

    expect(await (await get('/stats')).json()).toEqual({ allTime: 1, thisWeek: 1, byTheme: { strip: 1 } });
  });

  it('is all zeros with no pings', async () => {
    expect(await (await get('/stats')).json()).toEqual({ allTime: 0, thisWeek: 0, byTheme: {} });
  });

  it('is cacheable JSON readable from any origin', async () => {
    const res = await get('/stats');
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('cache-control')).toBe('max-age=3600');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('GET /badge', () => {
  it('is shields endpoint JSON counting all-time distinct ids', async () => {
    await ping({ id: ID_A, version: '1.0.0', theme: 'native' });
    await ping({ id: ID_B, version: '1.0.0', theme: 'native' });
    await ping({ id: ID_C, version: '1.0.0', theme: 'strip' }, LAST_WEEK);

    const res = await get('/badge');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      schemaVersion: 1,
      label: 'used by',
      message: '3 profiles',
      color: '2ea44f',
    });
  });

  it('says "1 profile" for one id, even across weeks', async () => {
    await ping({ id: ID_A, version: '1.0.0', theme: 'native' }, LAST_WEEK);
    await ping({ id: ID_A, version: '1.0.0', theme: 'native' });

    expect(await (await get('/badge')).json()).toMatchObject({ message: '1 profile' });
  });

  it('says "0 profiles" with no pings', async () => {
    expect(await (await get('/badge')).json()).toMatchObject({ message: '0 profiles' });
  });

  it('is cacheable JSON readable from any origin', async () => {
    const res = await get('/badge');
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('cache-control')).toBe('max-age=3600');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('routing', () => {
  it.each([
    ['GET', '/'],
    ['GET', '/nope'],
    ['POST', '/pings'],
    ['GET', '/stats/extra'],
  ])('%s %s is 404', async (method, path) => {
    expect((await handle(new Request(`${ORIGIN}${path}`, { method }), env, NOW)).status).toBe(404);
  });

  it.each([
    ['GET', '/ping', 'POST'],
    ['PUT', '/ping', 'POST'],
    ['POST', '/stats', 'GET'],
    ['DELETE', '/badge', 'GET'],
  ])('%s %s is 405 and allows %s', async (method, path, allow) => {
    const res = await handle(new Request(`${ORIGIN}${path}`, { method }), env, NOW);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe(allow);
  });
});

describe('deployed entry point', () => {
  it('stamps pings with the real current ISO week', async () => {
    const before = isoWeek(new Date());
    const res = await exports.default.fetch(`${ORIGIN}/ping`, {
      method: 'POST',
      body: JSON.stringify({ id: ID_A, version: '1.0.0', theme: 'native' }),
    });
    const after = isoWeek(new Date());

    expect(res.status).toBe(204);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect([before, after]).toContain(stored[0]?.week);
  });
});
