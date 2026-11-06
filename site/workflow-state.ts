import { WORKFLOW_PATH } from '../src/snippets/index';
import { badBody, fields, get, guard, type Fetch, type Trouble } from './check';

/**
 * Step 2's view of the workflow file already in the profile repository: missing, or found with
 * its text. Pure apart from the injected `fetch`, like `site/check.ts`, whose error handling it
 * shares. The page compares the found text with the generated YAML to choose between Add,
 * Update and "already up to date".
 */

export type WorkflowFile = { kind: 'missing' } | { kind: 'found'; content: string } | Trouble;

/** GitHub's base64 (wrapped at 60 columns) as UTF-8 text; plain `atob` would garble non-ASCII. */
function decodeBase64Utf8(base64: string): string {
  let binary: string;
  try {
    binary = atob(base64.replace(/\s+/g, ''));
  } catch {
    throw badBody();
  }
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** WORKFLOW_PATH in `<user>/<user>`, through the contents API. One request. */
export function fetchWorkflowFile(user: string, fetch: Fetch): Promise<WorkflowFile> {
  return guard(async (): Promise<WorkflowFile> => {
    const file = await get(fetch, `/repos/${user}/${user}/contents/${WORKFLOW_PATH}`);
    if (file === null) return { kind: 'missing' };
    const { content, encoding } = fields(file);
    if (typeof content !== 'string' || encoding !== 'base64') throw badBody();
    return { kind: 'found', content: decodeBase64Utf8(content) };
  });
}

/** Line endings as `\n`, without trailing whitespace on each line or at the end. */
const normalize = (yaml: string) =>
  yaml
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd();

/** Whether the committed workflow already says what the generated one says, ignoring editor noise. */
export function compareWorkflow(current: string, generated: string): 'same' | 'different' {
  return normalize(current) === normalize(generated) ? 'same' : 'different';
}
