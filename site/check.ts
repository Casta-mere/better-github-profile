import { rawFileUrl, WORKFLOW_PATH } from '../src/snippets/index';

/**
 * The selector page's setup check: unauthenticated GitHub REST calls from the browser, read
 * into a verdict. Pure apart from the injected `fetch`, so every branch is tested with canned
 * answers. Secrets can't be read without admin rights, so the check reads the latest
 * workflow run instead.
 */

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Why GitHub gave no usable answer. */
export type Trouble = { kind: 'rate-limited' } | { kind: 'network-error' } | { kind: 'http-error'; status: number };

export type RepoLookup = { kind: 'found'; owner: string; branch: string } | { kind: 'missing' } | Trouble;

export type FailureCause = 'secret-missing' | 'token-rejected' | 'other';

export type CheckResult =
  | { kind: 'no-workflow' }
  | { kind: 'not-run' }
  | { kind: 'running'; runUrl: string }
  /** `message`: the run's most telling error annotation, or null when it has none. */
  | { kind: 'failed'; cause: FailureCause; message: string | null; runUrl: string }
  /** `stale`: the run's "Using last good snapshot" warning, or null for fresh cards. */
  | { kind: 'ready'; runUrl: string; previewUrl: string | null; stale: string | null }
  | { kind: 'no-snapshot'; runUrl: string }
  | Trouble;

const API = 'https://api.github.com';
const WORKFLOW_FILE = WORKFLOW_PATH.slice(WORKFLOW_PATH.lastIndexOf('/') + 1);
/** The runner adds this to every failed step; the Action's own message says more. */
const GENERIC_EXIT = /^Process completed with exit code \d+\.?$/;
/** The Action's warning when it re-renders the last good snapshot (src/action/run.ts). */
const STALE = 'Using last good snapshot';

/** Ends the check early with a trouble result. */
class Stop extends Error {
  constructor(readonly trouble: Trouble) {
    super(trouble.kind);
  }
}

/** A JSON object's fields, or `{}` for anything else. */
type Json = Record<string, unknown>;
const fields = (x: unknown): Json => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Json) : {});
const text = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null);

/** A body that doesn't have the shape GitHub documents. */
const badBody = () => new Stop({ kind: 'http-error', status: 200 });

/**
 * GET an API path: the parsed body, or null for a 404. Throws `Stop` for the rate limit, a
 * network error or any other status. `no-cache` makes the browser revalidate with the ETag,
 * so a re-check sees new runs and an unchanged answer (304) costs none of the rate limit.
 */
async function get(fetch: Fetch, path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-cache' });
  } catch {
    throw new Stop({ kind: 'network-error' });
  }
  if (res.status === 404) return null;
  const limited = res.headers.get('x-ratelimit-remaining') === '0';
  if (res.status === 429 || (res.status === 403 && limited)) throw new Stop({ kind: 'rate-limited' });
  if (!res.ok) throw new Stop({ kind: 'http-error', status: res.status });
  try {
    return await res.json();
  } catch {
    throw new Stop({ kind: 'network-error' });
  }
}

async function guard<T>(work: () => Promise<T>): Promise<T | Trouble> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof Stop) return err.trouble;
    throw err;
  }
}

/** The profile repository `<user>/<user>`: its owner login as GitHub spells it, and its default branch. */
export function lookupProfileRepo(user: string, fetch: Fetch): Promise<RepoLookup> {
  return guard(async () => {
    const repo = await get(fetch, `/repos/${user}/${user}`);
    if (repo === null) return { kind: 'missing' };
    const { default_branch, owner } = fields(repo);
    return { kind: 'found', owner: text(fields(owner).login) ?? user, branch: text(default_branch) ?? 'main' };
  });
}

interface Annotation {
  level: string;
  message: string;
}

/** Every annotation of the run's jobs; `onlyFailed` keeps the jobs that didn't succeed. */
async function runAnnotations(fetch: Fetch, repo: string, runId: number, onlyFailed: boolean): Promise<Annotation[]> {
  const list = fields(await get(fetch, `${repo}/actions/runs/${runId}/jobs`)).jobs;
  if (!Array.isArray(list)) throw badBody();
  const jobs = list.map(fields).filter((job) => !onlyFailed || ['failure', 'timed_out'].includes(String(job.conclusion)));
  const out: Annotation[] = [];
  for (const job of jobs) {
    const notes = await get(fetch, `${repo}/check-runs/${Number(job.id)}/annotations`);
    if (!Array.isArray(notes)) continue;
    for (const note of notes.map(fields)) {
      const message = text(note.message);
      if (message) out.push({ level: String(note.annotation_level), message });
    }
  }
  return out;
}

/** Why the run failed, from its error annotations. */
function classify(notes: Annotation[]): { cause: FailureCause; message: string | null } {
  const errors = notes.filter((n) => n.level === 'failure').map((n) => n.message);
  const find = (test: (m: string) => boolean) => errors.find(test);
  const missing = find((m) => m.includes('Missing input "token"'));
  if (missing) return { cause: 'secret-missing', message: missing };
  const rejected = find((m) => m.includes('rejected the token') || /\bHTTP 401\b|Bad credentials/.test(m));
  if (rejected) return { cause: 'token-rejected', message: rejected };
  return { cause: 'other', message: find((m) => !GENERIC_EXIT.test(m)) ?? errors[0] ?? null };
}

/** The light overview card, else the first light card; null when there is none. */
function previewFile(names: string[]): string | null {
  const light = names.filter((n) => n.endsWith('-light.svg')).sort();
  return light.find((n) => n.endsWith('-overview-light.svg')) ?? light[0] ?? null;
}

/**
 * Checks the profile repository `<user>/<user>` step by step: the workflow file, its latest
 * run, why that run failed, and finally the snapshot and cards in `outputDir`. Stops at the
 * first thing that isn't done yet. Uses up to 5 requests of GitHub's 60 an hour, plus one per
 * extra job when a run has several.
 */
export function checkSetup(user: string, branch: string, outputDir: string, fetch: Fetch): Promise<CheckResult> {
  const repo = `/repos/${user}/${user}`;
  return guard(async (): Promise<CheckResult> => {
    if ((await get(fetch, `${repo}/contents/${WORKFLOW_PATH}`)) === null) return { kind: 'no-workflow' };

    const runs = await get(fetch, `${repo}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=1`);
    if (runs === null) return { kind: 'not-run' };
    const list = fields(runs).workflow_runs;
    if (!Array.isArray(list)) throw badBody();
    if (list.length === 0) return { kind: 'not-run' };
    const latest = fields(list[0]);
    const runId = Number(latest.id);
    const runUrl = text(latest.html_url) ?? `https://github.com/${user}/${user}/actions/runs/${runId}`;

    if (latest.status !== 'completed') return { kind: 'running', runUrl };
    const conclusion = String(latest.conclusion);
    if (['failure', 'timed_out', 'startup_failure'].includes(conclusion)) {
      return { kind: 'failed', ...classify(await runAnnotations(fetch, repo, runId, true)), runUrl };
    }
    if (conclusion !== 'success') {
      return { kind: 'failed', cause: 'other', message: `The run ended as "${conclusion}".`, runUrl };
    }

    const dir = outputDir.replace(/^\/+|\/+$/g, '');
    const listing = await get(fetch, `${repo}/contents/${dir}`);
    const names = Array.isArray(listing) ? listing.map((f) => text(fields(f).name) ?? '') : [];
    if (!names.includes('snapshot.json')) return { kind: 'no-snapshot', runUrl };

    const preview = previewFile(names);
    // Best effort: a failed lookup here doesn't make ready cards any less ready.
    const notes = await runAnnotations(fetch, repo, runId, false).catch((): Annotation[] => []);
    const stale = notes.find((n) => n.level === 'warning' && n.message.includes(STALE))?.message ?? null;
    return {
      kind: 'ready',
      runUrl,
      previewUrl: preview === null ? null : rawFileUrl(user, branch, `${dir}/${preview}`),
      stale,
    };
  });
}
