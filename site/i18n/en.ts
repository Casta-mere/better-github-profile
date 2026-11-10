import { TOKEN_HELP } from '../../src/snippets/index';

/**
 * The selector page's English text: the source of truth for every language. A `{name}`
 * placeholder is filled in by `t()` (text) or `nodes()` (text and elements). In index.html a
 * placeholder is the element child with `data-slot="name"`, and the element's English text is
 * the page's text before the script runs: test/site-i18n.test.ts keeps the two the same.
 *
 * Stay in English in every language: the workflow YAML, the README snippet, file names,
 * `STATS_TOKEN`, card and theme names, and GitHub's own button names (as slots).
 */
export const en = {
  'lang.aria': 'Language',

  lede: 'Stats cards for your GitHub profile README. A workflow in your profile repo rebuilds them daily and commits the SVG files, so there is nothing to host. Start with your GitHub username, pick a look, then follow the four steps.',

  // Username box
  'start.here': 'Start here',
  'start.done': 'Done',
  'username.label': 'Your GitHub username',
  'signIn.button': 'Sign in with GitHub',
  'signIn.or': 'or type it',
  'auth.cancelled': 'Sign-in cancelled. Type your username instead.',
  'auth.failed': 'Sign-in didn’t work. Type your username, or try signing in again.',
  'auth.unavailable': 'Sign-in isn’t available right now. Type your username instead.',
  'user.noUser': 'Enter your username to get direct links',
  'user.empty': 'Enter your username to get direct links.',
  'user.noRepo': 'Turns on once your profile repository is found',
  'user.waiting': 'Looking up when you stop typing…',
  'user.invalid': 'That isn’t a valid GitHub username. Enter your username to get direct links.',
  'user.lookingUp': 'Looking up {repo}…',
  'user.found': 'Found {repo} (branch {branch}). The links below go straight into it.',
  'user.missing': 'No repository named {repo} yet. {create} (public, named exactly like your username), then {retry}.',
  'user.trouble': 'Couldn’t look up {repo}: {trouble} The links assume the branch {main}. {retry}',
  'repo.create': 'Create it',
  'repo.yours': 'your profile repository',
  'retry.inline': 'look again',
  'retry.button': 'Look again',
  'trouble.rateLimited': 'GitHub’s hourly limit was reached; try again later.',
  'trouble.network': 'Couldn’t reach GitHub. Check your connection and try again.',
  'trouble.http': 'GitHub answered HTTP {status}. Try again later.',

  // Controls
  'controls.theme': 'Theme',
  'controls.cards': 'Cards',
  'controls.lastCard': 'At least one card stays selected',
  'controls.data': 'Data',
  'controls.includePrivate': 'Include private work',
  'controls.includeForks': 'Include forks',
  'controls.excludeRepos': 'Exclude repos',
  'controls.excludeLangs': 'Exclude languages',
  'controls.listNote': 'Comma-separated. The preview uses fixed sample data, so exclusions only change the workflow.',
  'controls.ping': 'Usage ping',
  'controls.pingNote':
    'Sends a hash of your repo ID (pseudonymous, not anonymous), the version and the theme, once per run. Turn off to send nothing.',

  // Preview
  'preview.title': 'Preview',
  'preview.modeAria': 'Preview mode',
  'preview.light': 'Light',
  'preview.dark': 'Dark',

  'linksHint.text':
    '{link} comes first: the links in these steps go straight into your profile repository, so they turn on once it’s found.',
  'linksHint.link': 'Your GitHub username',

  // Buttons shared by the steps
  'copy.button': 'Copy',
  'copy.copied': 'Copied',
  'copy.selected': 'Selected',
  'copy.failed': 'Copy failed',

  // Step 1
  'step1.title': 'Create a token and save it as a secret',
  'step1.help': TOKEN_HELP,
  'step1a.text': '{title} {link}; the scopes it needs are already ticked: {readUser}{repoScope}. Click {generate} and copy the token.',
  'step1a.title': 'Create the token.',
  'step1a.link': 'Open GitHub’s new token page',
  'step1a.repoScope': ', {repo}',
  'step1a.tip':
    'Tip: set {expiration} to {noExpiration}. If the token expires, the cards are kept but marked stale until you add a new one.',
  'step1b.optional': 'optional',
  'step1b.text':
    '{optional} {only}, for example your employer. On {tokens}, open {configureSso} next to the token and {authorize} the organization. Otherwise that organization’s private contributions aren’t counted as yours.',
  'step1b.only': 'Only if you belong to an organization that uses SAML SSO',
  'step1b.docs': 'GitHub Docs: {link}',
  'step1b.docsLink': 'Authorizing a personal access token for use with single sign-on',
  'step1b.docsHref':
    'https://docs.github.com/en/enterprise-cloud@latest/authentication/authenticating-with-single-sign-on/authorizing-a-personal-access-token-for-use-with-single-sign-on',
  'step1c.text': '{title} {link} in your profile repository and fill in:',
  'step1c.title': 'Add the secret.',
  'step1c.link': 'Open New repository secret',
  'step1c.name': 'Name',
  'step1c.value': 'Value',
  'step1c.copyName': 'Copy name',
  'step1c.copyNameAria': 'Copy the secret name STATS_TOKEN',
  'step1c.valueText': 'the token from {step}',

  // Step 2
  'step2.title': 'Add the workflow',
  'step2.add': 'Add workflow to {repo}',
  'step2.update': 'Update workflow',
  'step2.copyAria': 'Copy the workflow',
  'step2.checking': 'Checking whether {repo} already has the workflow…',
  'step2.checkingTitle': 'Checking whether the workflow already exists',
  'step2.missing':
    'The button opens GitHub’s new-file page with the workflow filled in: click {commit}. Or save it yourself as {path}.',
  'step2.different':
    '{repo} already has a different workflow. GitHub can’t fill in an edit: copy the new workflow ({copy}), open {update}, select all in the editor, paste, then {commit}.',
  'step2.same': '✓ Your workflow is already up to date.',
  'step2.view': 'View it',
  'step2.trouble':
    'Couldn’t check whether the workflow already exists: {trouble} If it does, {update} instead (copy, select all in the editor, paste, commit). {retry}',
  'step2.updateIt': 'update it',
  'step2.oldCards': 'On its next run, the workflow deletes your previous theme’s cards from {dir}.',

  // Step 3
  'step3.title': 'Run it and check',
  'step3.text': '{link}: click {run} there, and wait about a minute. Then check the setup.',
  'step3.link': 'Run the workflow',
  'step3.note':
    'The secret itself can’t be checked: GitHub only shows secrets to a logged-in admin, so the check looks at the workflow run instead.',
  'check.button': 'Check setup',
  'check.busy': 'Checking…',
  'check.at': 'Checked {time}',
  'check.step': 'step {step}',
  'check.openRun': 'Open the run',
  'check.repoMissing': 'No repository named {repo} yet. {create} first.',
  'check.noWorkflow': 'Workflow file not found. Do step 2.',
  'check.notRun': 'Not run yet: click {run}.',
  'check.running': 'Running… check again in a minute. {run}',
  'check.secretMissing': 'The run failed: the token secret is missing. Add the {secret} secret ({step}), then run again.',
  'check.tokenRejected':
    'The run failed: GitHub rejected the token. It is invalid or expired, or is missing scopes. Create a new one ({step1a}), save it as {secret} ({step1c}), then run again.',
  'check.failed': 'The run failed.',
  'check.failedWhy': 'The run failed:',
  'check.ended': 'The run ended as “{conclusion}”.',
  'check.noSnapshot': 'The run succeeded, but {file} isn’t in the repository.',
  'check.noSnapshotRun': 'Open the run to see what it did: {run}',
  'check.ready': 'Cards are ready. Paste the README markup (step 4).',
  'check.readyStale': 'Cards are ready, but marked stale: the last run couldn’t fetch fresh data.',
  'check.previewAlt': 'Your card, as committed',

  // Step 4
  'step4.title': 'Paste into {file}',
  'step4.formatAria': 'README format',
  'step4.copyAria': 'Copy the README markup',
  'step4.text':
    'Once the check says the cards are ready, so the images exist: {link}, paste the markup and commit. GitHub can’t fill in an edit, so copy the markup first.',
  'step4.link': 'Edit {file}',
  'step4.replace': 'Changing the theme or cards also changes the file names: replace the README markup too.',
  'step4.deprecated':
    'GitHub has deprecated the {light} / {dark} fragments in favor of {picture}. They still work, but may stop.',

  footer: 'The preview renders a fixed sample snapshot with the same code the Action runs.',
} as const;
