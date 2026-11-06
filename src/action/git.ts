import { getExecOutput } from '@actions/exec';

// This runs inside the user's own workflow, in their checkout: committing and pushing the
// cards there is what the Action is for.

type GitResult = { exitCode: number; stdout: string; stderr: string };
type Git = (args: string[]) => Promise<GitResult>;

const realGit: Git = (args) => getExecOutput('git', args, { ignoreReturnCode: true });

/** Per command, so the user's own git config in the checkout is left alone. */
const AS_BOT = [
  '-c',
  'user.name=github-actions[bot]',
  '-c',
  'user.email=41898282+github-actions[bot]@users.noreply.github.com',
];

const MESSAGE = 'Update profile cards';

/** The remote branch moved since checkout (`! [rejected] … (fetch first)`). */
const BRANCH_MOVED = /\[rejected\]|non-fast-forward|fetch first/;

/** The error for a failed git command, with a hint when it looks like missing permissions. */
function gitError(args: string[], r: GitResult): Error {
  const command = args.slice(args[0] === AS_BOT[0] ? AS_BOT.length : 0).join(' ');
  const output = r.stderr.trim() || r.stdout.trim();
  const hint = /\b403\b|denied|permission/i.test(output) ? ' (the job needs `permissions: contents: write`)' : '';
  return new Error(`git ${command} failed: ${output}${hint}`);
}

async function must(git: Git, args: string[]): Promise<GitResult> {
  const r = await git(args);
  if (r.exitCode !== 0) throw gitError(args, r);
  return r;
}

/**
 * Commits the changed paths as github-actions[bot] and pushes. When the push is rejected
 * because the branch moved during the run, rebases onto it and pushes once more before
 * failing. Returns false when git sees nothing to commit.
 */
export async function commitIfChanged(changed: string[], git: Git = realGit): Promise<boolean> {
  if (changed.length === 0) return false;
  await must(git, ['add', '--', ...changed]);
  const staged = await git(['diff', '--cached', '--quiet', '--', ...changed]);
  if (staged.exitCode === 0) return false;
  await must(git, [...AS_BOT, 'commit', '-m', MESSAGE, '--', ...changed]);

  const push = await git(['push']);
  if (push.exitCode === 0) return true;
  if (!BRANCH_MOVED.test(push.stderr)) throw gitError(['push'], push);
  await must(git, [...AS_BOT, 'pull', '--rebase']);
  await must(git, ['push']);
  return true;
}
