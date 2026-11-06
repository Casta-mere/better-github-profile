import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHECK_PROXY,
  checkSetup,
  lookupProfileRepo,
  proxied,
  TYPING_PAUSE_MS,
  whenTypingStops,
  type Fetch,
} from '../site/check';
import { TELEMETRY_URL } from '../src/action/telemetry';

/** A canned GitHub API answer, or a fetch that throws like a browser does when offline. */
type Route = { status?: number; body?: unknown; headers?: Record<string, string> } | 'network-error';

/** Answers from `routes` keyed by API path; anything else is GitHub's 404. Records the URLs it was asked for. */
function fakeFetch(routes: Record<string, Route>): Fetch & { calls: string[] } {
  const calls: string[] = [];
  const fetch: Fetch = async (url) => {
    calls.push(url);
    const route = routes[url.replace(/^https:\/\/api\.github\.com/, '')];
    if (route === 'network-error') throw new TypeError('Failed to fetch');
    if (route === undefined) return Response.json({ message: 'Not Found' }, { status: 404 });
    return Response.json(route.body ?? {}, { status: route.status ?? 200, headers: route.headers });
  };
  return Object.assign(fetch, { calls });
}

const RATE_LIMITED: Route = {
  status: 403,
  body: { message: 'API rate limit exceeded for 203.0.113.7.' },
  headers: { 'x-ratelimit-remaining': '0' },
};

const REPO = '/repos/octo/octo';
const WORKFLOW_FILE = `${REPO}/contents/.github/workflows/profile-cards.yml`;
const RUNS = `${REPO}/actions/workflows/profile-cards.yml/runs?per_page=1`;
const JOBS = `${REPO}/actions/runs/7/jobs`;
const annotations = (job: number) => `${REPO}/check-runs/${job}/annotations`;
const CARDS_DIR = `${REPO}/contents/cards`;
const RUN_URL = 'https://github.com/octo/octo/actions/runs/7';

const run = (status: string, conclusion: string | null): Route => ({
  body: { total_count: 1, workflow_runs: [{ id: 7, status, conclusion, html_url: RUN_URL }] },
});
const jobs = (...list: { id: number; conclusion: string }[]): Route => ({ body: { total_count: list.length, jobs: list } });
const notes = (...list: [level: string, message: string][]): Route => ({
  body: list.map(([annotation_level, message]) => ({ annotation_level, message, path: '.github' })),
});
const files = (...names: string[]): Route => ({ body: names.map((name) => ({ name, type: 'file' })) });

const UBUNTU_NOTICE: [string, string] = ['notice', 'The ubuntu-latest label will migrate to Ubuntu 26.'];
const MISSING_TOKEN =
  'Missing input "token". Create a classic personal access token with the read:user scope (plus repo to include private work), save it as the repository secret STATS_TOKEN, and pass `token: ${{ secrets.STATS_TOKEN }}` to the action.';
const TOKEN_REJECTED =
  'Could not build the first snapshot: GitHub rejected the token (HTTP 401). Check the token secret (STATS_TOKEN) and its scopes: read:user, plus repo to include private work.';
const STALE_WARNING =
  'Using last good snapshot from 2026-11-01: GitHub rejected the token (HTTP 401). Check the token secret (STATS_TOKEN) and its scopes: read:user, plus repo to include private work. The cards show "stale · data as of 2026-11-01" until a run succeeds.';
const NATIVE_FILES = [
  'native-languages-dark.svg',
  'native-languages-light.svg',
  'native-overview-dark.svg',
  'native-overview-light.svg',
  'snapshot.json',
];

/** A repo whose workflow file exists, plus `routes`. */
const withWorkflow = (routes: Record<string, Route>) =>
  fakeFetch({ [WORKFLOW_FILE]: { body: { name: 'profile-cards.yml' } }, ...routes });

const failedRun = (...annotationList: [string, string][]) =>
  withWorkflow({
    [RUNS]: run('completed', 'failure'),
    [JOBS]: jobs({ id: 70, conclusion: 'failure' }),
    [annotations(70)]: notes(...annotationList),
  });

const check = (fetch: Fetch, outputDir = 'cards') => checkSetup('octo', 'main', outputDir, fetch);

describe('checkSetup', () => {
  it('no workflow file: says to do step 2, after one request', async () => {
    const fetch = fakeFetch({});
    expect(await check(fetch)).toEqual({ kind: 'no-workflow' });
    expect(fetch.calls).toEqual([`https://api.github.com${WORKFLOW_FILE}`]);
  });

  it('no runs yet', async () => {
    expect(await check(withWorkflow({ [RUNS]: { body: { total_count: 0, workflow_runs: [] } } }))).toEqual({
      kind: 'not-run',
    });
  });

  it('no runs yet, when GitHub has not registered the new workflow (runs 404)', async () => {
    expect(await check(withWorkflow({}))).toEqual({ kind: 'not-run' });
  });

  it('a queued or in-progress run', async () => {
    for (const status of ['queued', 'in_progress', 'waiting']) {
      expect(await check(withWorkflow({ [RUNS]: run(status, null) })), status).toEqual({
        kind: 'running',
        runUrl: RUN_URL,
      });
    }
  });

  it('failed, missing token: the secret is missing', async () => {
    expect(await check(failedRun(UBUNTU_NOTICE, ['failure', MISSING_TOKEN]))).toEqual({
      kind: 'failed',
      cause: 'secret-missing',
      message: MISSING_TOKEN,
      runUrl: RUN_URL,
    });
  });

  it('failed, rejected token: invalid, expired or missing scopes', async () => {
    expect(await check(failedRun(['failure', TOKEN_REJECTED]))).toEqual({
      kind: 'failed',
      cause: 'token-rejected',
      message: TOKEN_REJECTED,
      runUrl: RUN_URL,
    });
    expect(await check(failedRun(['failure', 'Request failed: HTTP 401 Bad credentials']))).toMatchObject({
      cause: 'token-rejected',
    });
  });

  it('failed, other: the first failure message, skipping the generic exit-code line and notices', async () => {
    const message = 'Could not build the first snapshot: GraphQL error: Something went wrong.';
    const fetch = failedRun(UBUNTU_NOTICE, ['failure', 'Process completed with exit code 1.'], ['failure', message]);
    expect(await check(fetch)).toEqual({ kind: 'failed', cause: 'other', message, runUrl: RUN_URL });
  });

  it('failed, other: only the generic exit-code line, or no annotations at all', async () => {
    expect(await check(failedRun(['failure', 'Process completed with exit code 1.']))).toEqual({
      kind: 'failed',
      cause: 'other',
      message: 'Process completed with exit code 1.',
      runUrl: RUN_URL,
    });
    expect(await check(failedRun())).toEqual({ kind: 'failed', cause: 'other', message: null, runUrl: RUN_URL });
  });

  it('failed, other: reads the annotations of failed jobs only', async () => {
    const fetch = withWorkflow({
      [RUNS]: run('completed', 'failure'),
      [JOBS]: jobs({ id: 70, conclusion: 'success' }, { id: 71, conclusion: 'failure' }),
      [annotations(70)]: notes(['failure', MISSING_TOKEN]),
      [annotations(71)]: notes(['failure', 'Boom']),
    });
    expect(await check(fetch)).toMatchObject({ cause: 'other', message: 'Boom' });
    expect(fetch.calls).not.toContain(`https://api.github.com${annotations(70)}`);
  });

  it('a run that ended cancelled (or similar) counts as failed, other', async () => {
    expect(await check(withWorkflow({ [RUNS]: run('completed', 'cancelled') }))).toEqual({
      kind: 'failed',
      cause: 'other',
      message: 'The run ended as "cancelled".',
      runUrl: RUN_URL,
    });
  });

  it('success with snapshot: ready, previewing the light overview card', async () => {
    const fetch = withWorkflow({
      [RUNS]: run('completed', 'success'),
      [CARDS_DIR]: files(...NATIVE_FILES),
      [JOBS]: jobs({ id: 70, conclusion: 'success' }),
      [annotations(70)]: notes(UBUNTU_NOTICE),
    });
    expect(await check(fetch)).toEqual({
      kind: 'ready',
      runUrl: RUN_URL,
      previewUrl: 'https://raw.githubusercontent.com/octo/octo/main/cards/native-overview-light.svg',
      stale: null,
    });
  });

  it('success with snapshot: previews the first light card when there is no overview card', async () => {
    const fetch = withWorkflow({
      [RUNS]: run('completed', 'success'),
      [`${REPO}/contents/assets/stats`]: files('snapshot.json', 'strip-strip-dark.svg', 'strip-strip-light.svg'),
    });
    expect(await check(fetch, 'assets/stats')).toMatchObject({
      kind: 'ready',
      previewUrl: 'https://raw.githubusercontent.com/octo/octo/main/assets/stats/strip-strip-light.svg',
    });
  });

  it('success with a stale warning: still ready, with the warning', async () => {
    const fetch = withWorkflow({
      [RUNS]: run('completed', 'success'),
      [CARDS_DIR]: files(...NATIVE_FILES),
      [JOBS]: jobs({ id: 70, conclusion: 'success' }),
      [annotations(70)]: notes(UBUNTU_NOTICE, ['warning', STALE_WARNING]),
    });
    expect(await check(fetch)).toMatchObject({ kind: 'ready', stale: STALE_WARNING });
  });

  it('success with snapshot: still ready when the stale lookup itself fails', async () => {
    const fetch = withWorkflow({
      [RUNS]: run('completed', 'success'),
      [CARDS_DIR]: files(...NATIVE_FILES),
      [JOBS]: RATE_LIMITED,
    });
    expect(await check(fetch)).toMatchObject({ kind: 'ready', stale: null });
  });

  it('success without snapshot: no output directory, or no snapshot.json in it', async () => {
    const noDir = withWorkflow({ [RUNS]: run('completed', 'success') });
    expect(await check(noDir)).toEqual({ kind: 'no-snapshot', runUrl: RUN_URL });
    const noSnapshot = withWorkflow({ [RUNS]: run('completed', 'success'), [CARDS_DIR]: files('README.md') });
    expect(await check(noSnapshot)).toEqual({ kind: 'no-snapshot', runUrl: RUN_URL });
  });

  it('rate limited, at any step', async () => {
    expect(await check(fakeFetch({ [WORKFLOW_FILE]: RATE_LIMITED }))).toEqual({ kind: 'rate-limited' });
    expect(await check(withWorkflow({ [RUNS]: RATE_LIMITED }))).toEqual({ kind: 'rate-limited' });
    expect(
      await check(withWorkflow({ [RUNS]: run('completed', 'failure'), [JOBS]: { status: 429, body: {} } })),
    ).toEqual({ kind: 'rate-limited' });
  });

  it('a 403 that is not the rate limit is an HTTP error', async () => {
    expect(await check(fakeFetch({ [WORKFLOW_FILE]: { status: 403, body: {} } }))).toEqual({
      kind: 'http-error',
      status: 403,
    });
  });

  it('network error', async () => {
    expect(await check(fakeFetch({ [WORKFLOW_FILE]: 'network-error' }))).toEqual({ kind: 'network-error' });
    expect(await check(withWorkflow({ [RUNS]: 'network-error' }))).toEqual({ kind: 'network-error' });
  });

  it('a server error', async () => {
    expect(await check(withWorkflow({ [RUNS]: { status: 502, body: {} } }))).toEqual({ kind: 'http-error', status: 502 });
  });

  it('a body of the wrong shape is an HTTP error, not a crash', async () => {
    expect(await check(withWorkflow({ [RUNS]: { body: 'oops' } }))).toEqual({ kind: 'http-error', status: 200 });
  });
});

describe('lookupProfileRepo', () => {
  it('found: the owner login as GitHub spells it, and the default branch', async () => {
    const fetch = fakeFetch({ [REPO]: { body: { name: 'octo', default_branch: 'trunk', owner: { login: 'Octo' } } } });
    expect(await lookupProfileRepo('octo', fetch)).toEqual({ kind: 'found', owner: 'Octo', branch: 'trunk' });
    expect(fetch.calls).toEqual(['https://api.github.com/repos/octo/octo']);
  });

  it('found without a default branch or owner: main, and the name as typed', async () => {
    expect(await lookupProfileRepo('octo', fakeFetch({ [REPO]: { body: {} } }))).toEqual({
      kind: 'found',
      owner: 'octo',
      branch: 'main',
    });
  });

  it('missing (404)', async () => {
    expect(await lookupProfileRepo('octo', fakeFetch({}))).toEqual({ kind: 'missing' });
  });

  it('rate limited, network error, HTTP error', async () => {
    expect(await lookupProfileRepo('octo', fakeFetch({ [REPO]: RATE_LIMITED }))).toEqual({ kind: 'rate-limited' });
    expect(await lookupProfileRepo('octo', fakeFetch({ [REPO]: 'network-error' }))).toEqual({ kind: 'network-error' });
    expect(await lookupProfileRepo('octo', fakeFetch({ [REPO]: { status: 500 } }))).toEqual({
      kind: 'http-error',
      status: 500,
    });
  });
});

describe('proxied', () => {
  const PROXY = 'https://proxy.test/gh';
  const DIRECT = 'https://api.github.com/repos/octo/octo/actions/workflows/profile-cards.yml/runs?per_page=1';
  const VIA_PROXY = 'https://proxy.test/gh/repos/octo/octo/actions/workflows/profile-cards.yml/runs?per_page=1';
  const INIT: RequestInit = { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-cache' };

  /** Answers by full URL; records each URL and init it was called with. */
  function byUrl(routes: Record<string, Route>) {
    const calls: [string, RequestInit | undefined][] = [];
    const fetch: Fetch = async (url, init) => {
      calls.push([url, init]);
      const route = routes[url];
      if (route === 'network-error' || route === undefined) throw new TypeError('Failed to fetch');
      return Response.json(route.body ?? {}, { status: route.status ?? 200, headers: route.headers });
    };
    return { fetch, calls, urls: () => calls.map(([url]) => url) };
  }

  it('asks the proxy instead of api.github.com, with the same init', async () => {
    const f = byUrl({ [VIA_PROXY]: { body: { via: 'proxy' } } });
    const res = await proxied(f.fetch, PROXY)(DIRECT, INIT);
    expect(await res.json()).toEqual({ via: 'proxy' });
    expect(f.calls).toEqual([[VIA_PROXY, INIT]]);
  });

  it('defaults to CHECK_PROXY', async () => {
    const f = byUrl({ [`${CHECK_PROXY}/repos/octo/octo`]: { body: {} } });
    await proxied(f.fetch)('https://api.github.com/repos/octo/octo');
    expect(f.urls()).toEqual([`${CHECK_PROXY}/repos/octo/octo`]);
  });

  it('goes direct when the proxy is unreachable', async () => {
    const f = byUrl({ [VIA_PROXY]: 'network-error', [DIRECT]: { body: { via: 'direct' } } });
    const res = await proxied(f.fetch, PROXY)(DIRECT, INIT);
    expect(await res.json()).toEqual({ via: 'direct' });
    expect(f.calls).toEqual([
      [VIA_PROXY, INIT],
      [DIRECT, INIT],
    ]);
  });

  it.each([503, 500, 502])('goes direct when the proxy answers %i', async (status) => {
    const f = byUrl({ [VIA_PROXY]: { status, body: { error: 'proxy not configured' } }, [DIRECT]: { body: { via: 'direct' } } });
    const res = await proxied(f.fetch, PROXY)(DIRECT, INIT);
    expect(await res.json()).toEqual({ via: 'direct' });
    expect(f.urls()).toEqual([VIA_PROXY, DIRECT]);
  });

  it.each([
    ['404', { status: 404, body: { message: 'Not Found' } }],
    ['403 rate limit', RATE_LIMITED],
    ['429', { status: 429, headers: { 'x-ratelimit-remaining': '0' } }],
  ] as [string, Route][])('returns a %s as is, without going direct', async (_name, route) => {
    const f = byUrl({ [VIA_PROXY]: route, [DIRECT]: { body: { via: 'direct' } } });
    const res = await proxied(f.fetch, PROXY)(DIRECT, INIT);
    expect(res.status).toBe(route === 'network-error' ? 0 : route.status);
    expect(f.urls()).toEqual([VIA_PROXY]);
  });

  it('leaves other URLs alone', async () => {
    const raw = 'https://raw.githubusercontent.com/octo/octo/main/cards/snapshot.json';
    const lookalike = 'https://api.github.com.example.test/repos/octo/octo';
    const f = byUrl({ [raw]: { body: {} }, [lookalike]: { body: {} } });
    await proxied(f.fetch, PROXY)(raw);
    await proxied(f.fetch, PROXY)(lookalike);
    expect(f.urls()).toEqual([raw, lookalike]);
  });

  it('a setup check through the proxy reads the same verdicts', async () => {
    const f = byUrl({
      [`${PROXY}/repos/octo/octo`]: { body: { default_branch: 'trunk', owner: { login: 'Octo' } } },
    });
    expect(await lookupProfileRepo('octo', proxied(f.fetch, PROXY))).toEqual({
      kind: 'found',
      owner: 'Octo',
      branch: 'trunk',
    });
    const limited = byUrl({ [`${PROXY}/repos/octo/octo`]: { status: 429, headers: { 'x-ratelimit-remaining': '0' } } });
    expect(await lookupProfileRepo('octo', proxied(limited.fetch, PROXY))).toEqual({ kind: 'rate-limited' });
  });

  it('is the Worker the Action pings, so the two URLs cannot drift apart', () => {
    expect(new URL(CHECK_PROXY).origin).toBe(new URL(TELEMETRY_URL).origin);
    expect(new URL(CHECK_PROXY).pathname).toBe('/gh');
  });
});

describe('whenTypingStops', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Types `word` one character at a time, `gapMs` apart, like a person would. */
  function typeSlowly(typing: ReturnType<typeof whenTypingStops>, word: string, gapMs = 300): void {
    for (let i = 1; i <= word.length; i++) {
      typing.typed(word.slice(0, i));
      vi.advanceTimersByTime(gapMs);
    }
  }

  it('pauses 1.2 s', () => {
    expect(TYPING_PAUSE_MS).toBe(1200);
  });

  it('settles once, on the whole name, after a pause in typing', () => {
    const settled: string[] = [];
    const typing = whenTypingStops((v) => settled.push(v));
    typeSlowly(typing, 'Casta-mere');
    expect(settled).toEqual([]);
    vi.advanceTimersByTime(TYPING_PAUSE_MS - 300 - 1);
    expect(settled).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(settled).toEqual(['Casta-mere']);
    vi.advanceTimersByTime(60_000);
    expect(settled).toEqual(['Casta-mere']);
  });

  it('settles at once on commit (Enter, or leaving the field), and not again after the pause', () => {
    const settled: string[] = [];
    const typing = whenTypingStops((v) => settled.push(v));
    typeSlowly(typing, 'octo', 100);
    typing.commit('octo');
    expect(settled).toEqual(['octo']);
    vi.advanceTimersByTime(60_000);
    expect(settled).toEqual(['octo']);
  });

  it('ignores a commit with no typing since the value settled: Enter then change, or a pause then blur', () => {
    const settled: string[] = [];
    const typing = whenTypingStops((v) => settled.push(v));
    typeSlowly(typing, 'octo');
    typing.commit('octo');
    typing.commit('octo');
    expect(settled).toEqual(['octo']);

    typeSlowly(typing, 'octocat');
    vi.advanceTimersByTime(TYPING_PAUSE_MS);
    typing.commit('octocat');
    expect(settled).toEqual(['octo', 'octocat']);
  });

  it('settles again after more typing, even back to the same name', () => {
    const settled: string[] = [];
    const typing = whenTypingStops((v) => settled.push(v));
    typing.typed('octo');
    typing.commit('octo');
    typing.typed('octoc');
    typing.typed('octo');
    vi.advanceTimersByTime(TYPING_PAUSE_MS);
    expect(settled).toEqual(['octo', 'octo']);
  });

  it('markSettled: a lookup made another way cancels the pause, and a later commit of that name is ignored', () => {
    const settled: string[] = [];
    const typing = whenTypingStops((v) => settled.push(v));
    typing.typed('octo');
    typing.markSettled('octo');
    vi.advanceTimersByTime(TYPING_PAUSE_MS);
    typing.commit('octo');
    expect(settled).toEqual([]);
    typing.commit('octocat');
    expect(settled).toEqual(['octocat']);
  });

  it('typing: true from a keystroke until the name settles', () => {
    const typing = whenTypingStops(() => {});
    expect(typing.typing).toBe(false);
    typing.typed('o');
    expect(typing.typing).toBe(true);
    vi.advanceTimersByTime(TYPING_PAUSE_MS);
    expect(typing.typing).toBe(false);
    typing.typed('oc');
    typing.commit('oc');
    expect(typing.typing).toBe(false);
  });
});
