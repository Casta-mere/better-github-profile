import { WORKFLOW_PATH, type SetupConfig } from './workflow';

/** GitHub's username rule: letters, digits and single inner hyphens, at most 39 characters. */
const USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export function isGitHubUsername(s: string): boolean {
  return USERNAME.test(s);
}

/** A branch or file path in a URL: each segment percent-encoded, the slashes kept. */
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/** GitHub's new classic token page with the scopes the chosen setup needs already ticked. */
export function tokenUrl(c: SetupConfig): string {
  const scopes = c.includePrivate ? 'read:user,repo' : 'read:user';
  return `https://github.com/settings/tokens/new?scopes=${scopes}&description=better-github-profile`;
}

/** Links into the profile repository `<user>/<user>`. */
export interface ProfileRepoLinks {
  repo: string;
  /** The "New repository secret" form. */
  secretNew: string;
  /** GitHub's new-file page at WORKFLOW_PATH, prefilled with `yaml`. */
  workflowNew(yaml: string): string;
  /** The workflow's runs, with the "Run workflow" button. */
  workflowPage: string;
  /** The README editor; GitHub can't prefill an edit. */
  readmeEdit: string;
  /** The "Create a new repository" form with the name filled in. */
  newRepo: string;
}

/** Throws when `user` isn't a valid GitHub username, so no link ever leaves github.com/<user>/<user>. */
export function profileRepoLinks(user: string, branch: string): ProfileRepoLinks {
  if (!isGitHubUsername(user)) throw new Error(`"${user}" is not a valid GitHub username`);
  const repo = `https://github.com/${user}/${user}`;
  const ref = encodePath(branch);
  const workflowFile = WORKFLOW_PATH.slice(WORKFLOW_PATH.lastIndexOf('/') + 1);
  return {
    repo,
    secretNew: `${repo}/settings/secrets/actions/new`,
    workflowNew: (yaml) => `${repo}/new/${ref}?filename=${WORKFLOW_PATH}&value=${encodeURIComponent(yaml)}`,
    workflowPage: `${repo}/actions/workflows/${workflowFile}`,
    readmeEdit: `${repo}/edit/${ref}/README.md`,
    newRepo: `https://github.com/new?name=${user}`,
  };
}

/** A file of `<user>/<user>` as served by raw.githubusercontent.com. */
export function rawFileUrl(user: string, branch: string, path: string): string {
  return `https://raw.githubusercontent.com/${user}/${user}/${encodePath(branch)}/${encodePath(path)}`;
}
