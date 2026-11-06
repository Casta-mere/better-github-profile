import { renderCards, THEMES } from '../src/render/index';
import { validateSnapshot, type Mode, type Snapshot } from '../src/snapshot/types';
import {
  DEFAULT_SETUP,
  isGitHubUsername,
  outputDirOf,
  profileRepoLinks,
  readmeSnippet,
  TOKEN_HELP,
  tokenUrl,
  WORKFLOW_PATH,
  workflowYaml,
  type ProfileRepoLinks,
  type SetupConfig,
} from '../src/snippets/index';
import { checkSetup, lookupProfileRepo, type CheckResult, type Fetch, type RepoLookup, type Trouble } from './check';
import sample from './sample-snapshot.json';
import { applyControl } from './state';

if (!validateSnapshot(sample)) throw new Error('site/sample-snapshot.json is not a valid snapshot');
const snapshot: Snapshot = sample;

function el<T extends Element = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element ${selector}`);
  return found;
}

const controls = el<HTMLFormElement>('#controls');
const cardList = el('#cards');
const preview = el('#preview');

let setup: SetupConfig = { ...DEFAULT_SETUP, cards: [...DEFAULT_SETUP.cards] };
let mode: Mode = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
let cardListTheme: string | null = null;

/**
 * Each card gets its own shadow root: card SVGs carry `<style>` blocks with global
 * selectors, which inline in the page would style the page and each other.
 */
const CARD_CSS = ':host{display:block;max-width:100%}svg{display:block;max-width:100%;height:auto}';

function renderCardChecks(): void {
  if (cardListTheme !== setup.theme) {
    cardList.replaceChildren(
      ...THEMES[setup.theme].cards.map((card) => {
        const label = document.createElement('label');
        label.className = 'check';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = `card-${card}`;
        input.dataset.control = `card:${card}`;
        input.dataset.card = card;
        const name = document.createElement('span');
        name.textContent = card;
        label.append(input, name);
        return label;
      }),
    );
    cardListTheme = setup.theme;
  }
  const onlyOne = setup.cards.length === 1;
  for (const input of cardList.querySelectorAll<HTMLInputElement>('input[data-card]')) {
    input.checked = setup.cards.includes(input.dataset.card ?? '');
    // The last card can't be unchecked; say so instead of silently re-checking it.
    input.disabled = onlyOne && input.checked;
    input.parentElement!.title = input.disabled ? 'At least one card stays selected' : '';
  }
}

function syncControls(): void {
  // Not only the form: the README format toggle sits in step 4's header.
  for (const input of document.querySelectorAll<HTMLInputElement>('input[data-control]')) {
    const control = input.dataset.control;
    if (control === 'theme') input.checked = input.value === setup.theme;
    else if (control === 'readmeFormat') input.checked = input.value === setup.readmeFormat;
    else if (control === 'includePrivate' || control === 'includeForks' || control === 'telemetry') {
      input.checked = setup[control];
    }
  }
  renderCardChecks();
}

function renderPreview(): void {
  const cards = renderCards(snapshot, { theme: setup.theme, cards: setup.cards }).filter((c) =>
    c.file.endsWith(`-${mode}.svg`),
  );
  preview.dataset.mode = mode;
  preview.classList.toggle('wide', setup.theme === 'strip');
  preview.replaceChildren(
    ...cards.map(({ file, svg }) => {
      const host = document.createElement('div');
      host.className = 'card';
      host.title = file;
      host.attachShadow({ mode: 'open' }).innerHTML = `<style>${CARD_CSS}</style>${svg}`;
      return host;
    }),
  );
}

function renderOutput(): void {
  el('#workflow').textContent = workflowYaml(setup);
  el('#readme').textContent = readmeSnippet(setup);
  el('#readme-note').hidden = setup.readmeFormat !== 'markdown';
  el<HTMLAnchorElement>('#token-link').href = tokenUrl(setup);
  el('#repo-scope').hidden = !setup.includePrivate;
  renderRepoLinks();
}

function render(): void {
  syncControls();
  renderPreview();
  renderOutput();
}

controls.addEventListener('submit', (e) => e.preventDefault());
document.addEventListener('input', (e) => {
  const input = e.target;
  if (!(input instanceof HTMLInputElement) || !input.dataset.control) return;
  setup = applyControl(setup, input.dataset.control, input.type === 'checkbox' ? input.checked : input.value);
  render();
});

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
  radio.checked = radio.value === mode;
  radio.addEventListener('change', () => {
    mode = radio.value === 'dark' ? 'dark' : 'light';
    renderPreview();
  });
}

function flash(button: HTMLButtonElement, text: string): void {
  const original = button.dataset.label ?? button.textContent?.trim() ?? '';
  button.dataset.label = original;
  button.textContent = text;
  button.classList.add('done');
  window.setTimeout(() => {
    button.textContent = original;
    button.classList.remove('done');
  }, 1500);
}

function selectContents(node: Node): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

document.addEventListener('click', async (e) => {
  if (!(e.target instanceof Element)) return;
  const button = e.target.closest<HTMLButtonElement>('button[data-copy-text], button[data-copy-from]');
  if (!button) return;
  const source = button.dataset.copyFrom ? el(`#${button.dataset.copyFrom}`) : null;
  const text = source ? (source.textContent ?? '') : (button.dataset.copyText ?? '');
  try {
    await navigator.clipboard.writeText(text);
    flash(button, 'Copied');
  } catch {
    // No clipboard access (e.g. an insecure origin): select the text so ⌘C / Ctrl+C works.
    if (source) selectContents(source);
    flash(button, source ? 'Selected' : 'Copy failed');
  }
});

// --- Profile repository: username, lookup, direct links ---

const USERNAME_KEY = 'better-github-profile:username';
const NO_USER_HINT = 'Enter your username to get direct links';
/** A GitHub API lookup waits this long after the last keystroke. */
const LOOKUP_DELAY_MS = 500;

const usernameInput = el<HTMLInputElement>('#username');
const userStatus = el('#user-status');
const checkButton = el<HTMLButtonElement>('#check-setup');
const checkResult = el('#check-result');

const api: Fetch = (url, init) => fetch(url, init);

/** The trimmed input; links need it to pass `isGitHubUsername`. */
let username = '';
/** The lookup for `username`: null while there is none to make. */
let lookup: RepoLookup | 'pending' | null = null;
/** Settled lookups (found or missing) per lowercased username; troubles are retried. */
const lookups = new Map<string, RepoLookup>();
let lookupTimer = 0;

/** `<owner>/<owner>` and the branch the links use; null without a valid username. */
function repoTarget(): { owner: string; branch: string } | null {
  if (!isGitHubUsername(username)) return null;
  if (lookup !== null && lookup !== 'pending' && lookup.kind === 'found') return lookup;
  return { owner: username, branch: 'main' };
}

function link(href: string, label: string | Node): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.append(label);
  return a;
}

function code(text: string): HTMLElement {
  const c = document.createElement('code');
  c.textContent = text;
  return c;
}

/** An inline button that re-runs the profile repository lookup. */
function retryButton(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'link-button';
  b.textContent = label;
  b.addEventListener('click', () => {
    lookups.delete(username.toLowerCase());
    void lookUp();
  });
  return b;
}

function troubleText(t: Trouble): string {
  if (t.kind === 'rate-limited') return 'GitHub’s limit of 60 checks an hour was reached; try again later.';
  if (t.kind === 'network-error') return 'Couldn’t reach GitHub. Check your connection and try again.';
  return `GitHub answered HTTP ${t.status}. Try again later.`;
}

function renderRepoLinks(): void {
  const target = repoTarget();
  const links = target ? profileRepoLinks(target.owner, target.branch) : null;
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-repo-link]')) {
    const key = a.dataset.repoLink as Exclude<keyof ProfileRepoLinks, 'repo' | 'newRepo'>;
    const href = links === null ? null : key === 'workflowNew' ? links.workflowNew(workflowYaml(setup)) : links[key];
    if (href === null) {
      a.removeAttribute('href');
      a.setAttribute('aria-disabled', 'true');
      a.title = NO_USER_HINT;
    } else {
      a.href = href;
      a.removeAttribute('aria-disabled');
      a.removeAttribute('title');
    }
  }
  for (const name of document.querySelectorAll('[data-repo-name]')) {
    name.textContent = target ? `${target.owner}/${target.owner}` : 'your profile repository';
  }
  checkButton.disabled = target === null || checkButton.dataset.busy === 'true';
  checkButton.title = target === null ? NO_USER_HINT : '';
}

function renderUserStatus(): void {
  const repoName = `${username}/${username}`;
  userStatus.dataset.tone = '';
  usernameInput.removeAttribute('aria-invalid');
  if (username === '') {
    userStatus.replaceChildren(`${NO_USER_HINT}.`);
  } else if (!isGitHubUsername(username)) {
    usernameInput.setAttribute('aria-invalid', 'true');
    userStatus.dataset.tone = 'err';
    userStatus.replaceChildren(`That isn’t a valid GitHub username. ${NO_USER_HINT}.`);
  } else if (lookup === null || lookup === 'pending') {
    userStatus.replaceChildren('Looking up ', code(repoName), '…');
  } else if (lookup.kind === 'found') {
    const name = `${lookup.owner}/${lookup.owner}`;
    userStatus.dataset.tone = 'ok';
    userStatus.replaceChildren(
      'Found ',
      link(profileRepoLinks(lookup.owner, lookup.branch).repo, code(name)),
      ' (branch ',
      code(lookup.branch),
      '). The links below go straight into it.',
    );
  } else if (lookup.kind === 'missing') {
    userStatus.dataset.tone = 'warn';
    userStatus.replaceChildren(
      'No repository named ',
      code(repoName),
      ' yet. ',
      link(profileRepoLinks(username, 'main').newRepo, 'Create it'),
      ' (public, named exactly like your username), then ',
      retryButton('look again'),
      '.',
    );
  } else {
    userStatus.dataset.tone = 'warn';
    userStatus.replaceChildren(
      `Couldn’t look up ${repoName}: ${troubleText(lookup)} The links assume the branch `,
      code('main'),
      '. ',
      retryButton('Look again'),
    );
  }
}

/** Looks up the current username's profile repository now, from the cache when settled. */
async function lookUp(): Promise<RepoLookup | null> {
  window.clearTimeout(lookupTimer);
  const user = username;
  if (!isGitHubUsername(user)) return null;
  const key = user.toLowerCase();
  let result = lookups.get(key);
  if (result === undefined) {
    lookup = 'pending';
    renderUserStatus();
    result = await lookupProfileRepo(user, api);
    if (result.kind === 'found' || result.kind === 'missing') lookups.set(key, result);
  }
  if (username !== user) return null; // typed on meanwhile
  lookup = result;
  renderUserStatus();
  renderRepoLinks();
  return result;
}

function clearCheck(): void {
  checkResult.hidden = true;
  checkResult.replaceChildren();
}

function setUsername(value: string): void {
  username = value.trim();
  try {
    localStorage.setItem(USERNAME_KEY, username);
  } catch {
    // Storage blocked (private mode, policy): the page still works, it just forgets.
  }
  clearCheck();
  window.clearTimeout(lookupTimer);
  const cached = lookups.get(username.toLowerCase());
  lookup = !isGitHubUsername(username) ? null : (cached ?? 'pending');
  if (lookup === 'pending') lookupTimer = window.setTimeout(() => void lookUp(), LOOKUP_DELAY_MS);
  renderUserStatus();
  renderRepoLinks();
}

usernameInput.addEventListener('input', () => setUsername(usernameInput.value));

// --- Step 3: check setup ---

type Tone = 'ok' | 'warn' | 'err' | 'info';

function showCheck(tone: Tone, lines: (string | Node)[][], extra: Node[] = []): void {
  const time = document.createElement('span');
  time.className = 'checked-at';
  time.textContent = `Checked ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  checkResult.dataset.tone = tone;
  checkResult.replaceChildren(
    ...lines.map((parts, i) => {
      const p = document.createElement('p');
      p.append(...parts);
      if (i === 0) p.className = 'check-headline';
      return p;
    }),
    ...extra,
    time,
  );
  checkResult.hidden = false;
}

function stepLink(step: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = `#step-${step}`;
  a.textContent = `step ${step}`;
  return a;
}

function strong(text: string): HTMLElement {
  const b = document.createElement('strong');
  b.textContent = text;
  return b;
}

function renderCheck(result: CheckResult, owner: string, branch: string): void {
  const links = profileRepoLinks(owner, branch);
  const runLink = (url: string) => link(url, 'Open the run');
  const output = outputDirOf(setup);
  switch (result.kind) {
    case 'no-workflow':
      return showCheck('err', [['Workflow file not found. Do step 2.']]);
    case 'not-run':
      return showCheck('info', [['Not run yet: click ', link(links.workflowPage, strong('Run workflow')), '.']]);
    case 'running':
      return showCheck('info', [['Running… check again in a minute. ', runLink(result.runUrl)]]);
    case 'failed': {
      const why =
        result.cause === 'secret-missing'
          ? ['The run failed: the token secret is missing. Add the ', code('STATS_TOKEN'), ' secret (', stepLink('1c'), '), then run again.']
          : result.cause === 'token-rejected'
            ? [
                'The run failed: GitHub rejected the token. It is invalid or expired, or is missing scopes. Create a new one (',
                stepLink('1a'),
                '), save it as ',
                code('STATS_TOKEN'),
                ' (',
                stepLink('1c'),
                '), then run again.',
              ]
            : [result.message === null ? 'The run failed.' : 'The run failed:'];
      const detail = result.cause === 'other' && result.message !== null ? [[result.message]] : [];
      return showCheck('err', [why, ...detail, [runLink(result.runUrl)]]);
    }
    case 'no-snapshot':
      return showCheck('warn', [
        ['The run succeeded, but ', code(`${output}/snapshot.json`), ' isn’t in the repository.'],
        ['Open the run to see what it did: ', runLink(result.runUrl)],
      ]);
    case 'ready': {
      const preview: Node[] = [];
      if (result.previewUrl !== null) {
        const img = document.createElement('img');
        img.className = 'check-preview';
        img.src = result.previewUrl;
        img.alt = 'Your card, as committed';
        preview.push(img);
      }
      const lines: (string | Node)[][] =
        result.stale === null
          ? [['Cards are ready. Paste the README markup (step 4).'], [runLink(result.runUrl)]]
          : [
              ['Cards are ready, but marked stale: the last run couldn’t fetch fresh data.'],
              [result.stale],
              [runLink(result.runUrl)],
            ];
      return showCheck(result.stale === null ? 'ok' : 'warn', lines, preview);
    }
    default:
      return showCheck(result.kind === 'rate-limited' ? 'warn' : 'err', [[troubleText(result)]]);
  }
}

checkButton.addEventListener('click', async () => {
  const user = username;
  if (!isGitHubUsername(user)) return;
  checkButton.dataset.busy = 'true';
  checkButton.disabled = true;
  checkButton.textContent = 'Checking…';
  try {
    // A missing repository may have been created since: look again rather than trust the cache.
    if (lookup !== null && lookup !== 'pending' && lookup.kind !== 'found') lookups.delete(user.toLowerCase());
    const repo = await lookUp();
    if (repo === null || username !== user) return;
    if (repo.kind === 'missing') {
      showCheck('err', [
        ['No repository named ', code(`${user}/${user}`), ' yet. ', link(profileRepoLinks(user, 'main').newRepo, 'Create it'), ' first.'],
      ]);
      return;
    }
    if (repo.kind !== 'found') {
      showCheck(repo.kind === 'rate-limited' ? 'warn' : 'err', [[troubleText(repo)]]);
      return;
    }
    const result = await checkSetup(repo.owner, repo.branch, outputDirOf(setup), api);
    if (username === user) renderCheck(result, repo.owner, repo.branch);
  } finally {
    delete checkButton.dataset.busy;
    checkButton.textContent = 'Check setup';
    renderRepoLinks();
  }
});

let savedUsername = '';
try {
  savedUsername = localStorage.getItem(USERNAME_KEY) ?? '';
} catch {
  // Storage blocked: start empty.
}
usernameInput.value = savedUsername;

el('#token-help').textContent = TOKEN_HELP;
el('#workflow-path').textContent = WORKFLOW_PATH;
setUsername(savedUsername);
render();
