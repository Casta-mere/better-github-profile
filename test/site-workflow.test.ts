import { describe, expect, it } from 'vitest';
import type { Fetch } from '../site/check';
import { compareWorkflow, fetchWorkflowFile, workflowView, type WorkflowFile } from '../site/workflow-state';
import { DEFAULT_SETUP, workflowYaml } from '../src/snippets/index';

/** A canned GitHub API answer, or a fetch that throws like a browser does when offline. */
type Route = { status?: number; body?: unknown; headers?: Record<string, string> } | 'network-error';

const FILE = '/repos/octo/octo/contents/.github/workflows/profile-cards.yml';

/** Answers `route` for the workflow file; anything else is GitHub's 404. Records the URLs it was asked for. */
function fakeFetch(route?: Route): Fetch & { calls: string[] } {
  const calls: string[] = [];
  const fetch: Fetch = async (url) => {
    calls.push(url);
    const path = url.replace(/^https:\/\/api\.github\.com/, '');
    if (path !== FILE || route === undefined) return Response.json({ message: 'Not Found' }, { status: 404 });
    if (route === 'network-error') throw new TypeError('Failed to fetch');
    return Response.json(route.body ?? {}, { status: route.status ?? 200, headers: route.headers });
  };
  return Object.assign(fetch, { calls });
}

/** The contents API's answer for a file: UTF-8 bytes in base64, wrapped at 60 columns like GitHub does. */
const contents = (text: string): Route => ({
  body: {
    name: 'profile-cards.yml',
    path: '.github/workflows/profile-cards.yml',
    type: 'file',
    encoding: 'base64',
    content: `${Buffer.from(text, 'utf8').toString('base64').replace(/.{60}/g, '$&\n')}\n`,
  },
});

const native = workflowYaml(DEFAULT_SETUP);
const strip = workflowYaml({ ...DEFAULT_SETUP, theme: 'strip', cards: ['strip'] });

describe('fetchWorkflowFile', () => {
  it('reads WORKFLOW_PATH in <user>/<user> through the contents API', async () => {
    const fetch = fakeFetch();
    await fetchWorkflowFile('octo', fetch);
    expect(fetch.calls).toEqual([`https://api.github.com${FILE}`]);
  });

  it('is missing on a 404', async () => {
    expect(await fetchWorkflowFile('octo', fakeFetch())).toEqual({ kind: 'missing' });
  });

  it('decodes the base64 content as UTF-8, non-ASCII included', async () => {
    const text = `# Profile cards — café ✓ 名片\n${native}`;
    expect(await fetchWorkflowFile('octo', fakeFetch(contents(text)))).toEqual({ kind: 'found', content: text });
  });

  it('finds the generated workflow, byte for byte', async () => {
    const file = await fetchWorkflowFile('octo', fakeFetch(contents(native)));
    expect(file).toEqual({ kind: 'found', content: native });
  });

  it('reports the rate limit: a 403 with no requests left, or a 429', async () => {
    const limited: Route = {
      status: 403,
      body: { message: 'API rate limit exceeded for 203.0.113.7.' },
      headers: { 'x-ratelimit-remaining': '0' },
    };
    expect(await fetchWorkflowFile('octo', fakeFetch(limited))).toEqual({ kind: 'rate-limited' });
    expect(await fetchWorkflowFile('octo', fakeFetch({ status: 429 }))).toEqual({ kind: 'rate-limited' });
  });

  it('reports a network error', async () => {
    expect(await fetchWorkflowFile('octo', fakeFetch('network-error'))).toEqual({ kind: 'network-error' });
  });

  it('reports any other status as an HTTP error', async () => {
    expect(await fetchWorkflowFile('octo', fakeFetch({ status: 500 }))).toEqual({ kind: 'http-error', status: 500 });
    expect(await fetchWorkflowFile('octo', fakeFetch({ status: 403, body: { message: 'Forbidden' } }))).toEqual({
      kind: 'http-error',
      status: 403,
    });
  });

  it('reports a body without base64 content (a directory, a file too large to inline, garbage) as an HTTP error', async () => {
    const bad = { kind: 'http-error', status: 200 };
    expect(await fetchWorkflowFile('octo', fakeFetch({ body: [{ name: 'x.yml' }] }))).toEqual(bad);
    expect(await fetchWorkflowFile('octo', fakeFetch({ body: { encoding: 'none', content: '' } }))).toEqual(bad);
    expect(await fetchWorkflowFile('octo', fakeFetch({ body: { encoding: 'base64', content: '!!!' } }))).toEqual(bad);
  });
});

describe('compareWorkflow', () => {
  it('is same for the generated workflow itself', () => {
    expect(compareWorkflow(native, native)).toBe('same');
  });

  it('is same when only line endings differ (CRLF, CR)', () => {
    expect(compareWorkflow(native.replace(/\n/g, '\r\n'), native)).toBe('same');
    expect(compareWorkflow(native, native.replace(/\n/g, '\r'))).toBe('same');
  });

  it('is same with or without the trailing newline', () => {
    expect(native.endsWith('\n')).toBe(true);
    expect(compareWorkflow(native.trimEnd(), native)).toBe('same');
    expect(compareWorkflow(`${native}\n\n`, native)).toBe('same');
    expect(compareWorkflow(`${native.replace(/\n/g, '\r\n')}\r\n`, native.trimEnd())).toBe('same');
  });

  it('is same when lines carry trailing spaces or tabs', () => {
    expect(compareWorkflow(native.replace(/\n/g, '  \n').replace(/name: Profile cards/, '$&\t'), native)).toBe('same');
  });

  it('is different for another theme or set of cards', () => {
    expect(compareWorkflow(native, strip)).toBe('different');
    const overviewOnly = workflowYaml({ ...DEFAULT_SETUP, cards: ['overview'] });
    expect(compareWorkflow(native, overviewOnly)).toBe('different');
  });

  it('is different when indentation changes, since YAML reads it', () => {
    expect(compareWorkflow(native.replace('    runs-on', '  runs-on'), native)).toBe('different');
  });
});

describe('workflowView', () => {
  const found = (content: string): WorkflowFile => ({ kind: 'found', content });
  const view = (file: WorkflowFile | undefined, reading: boolean, yaml = native, hasTarget = true) =>
    workflowView({ file, reading, hasTarget, yaml });

  it('is checking while the first read is in flight, so Add is not offered yet', () => {
    expect(view(undefined, true)).toBe('checking');
  });

  it('keeps the cached answer while a new read runs: no flicker back to checking', () => {
    expect(view(found(native), true)).toBe('same');
    expect(view(found(strip), true)).toBe('different');
    expect(view({ kind: 'missing' }, true)).toBe('missing');
    expect(view({ kind: 'rate-limited' }, true)).toBe('trouble');
  });

  it('is missing once the read settles on a 404', () => {
    expect(view({ kind: 'missing' }, false)).toBe('missing');
  });

  it('compares a found file with the YAML the page generates now', () => {
    expect(view(found(native), false)).toBe('same');
    expect(view(found(native.replace(/\n/g, '\r\n')), false)).toBe('same');
    expect(view(found(native), false, strip)).toBe('different');
    expect(view(found(strip), false, strip)).toBe('same');
  });

  it('is trouble when GitHub gave no answer, for the file or for the repository', () => {
    expect(view({ kind: 'rate-limited' }, false)).toBe('trouble');
    expect(view({ kind: 'network-error' }, false)).toBe('trouble');
    expect(view({ kind: 'http-error', status: 500 }, false)).toBe('trouble');
  });

  it('is missing with a target but nothing known and nothing in flight', () => {
    expect(view(undefined, false)).toBe('missing');
  });

  it('is missing without a target: the links are off, and the step reads as before', () => {
    expect(view(undefined, false, native, false)).toBe('missing');
    expect(view(undefined, true, native, false)).toBe('missing');
    expect(view({ kind: 'rate-limited' }, false, native, false)).toBe('missing');
  });
});
