import { describe, expect, it } from 'vitest';
import { checkSetup, lookupProfileRepo, type Fetch } from '../site/check';

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
