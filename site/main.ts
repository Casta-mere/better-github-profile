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
import {
  checkSetup,
  lookupProfileRepo,
  proxied,
  whenTypingStops,
  type CheckResult,
  type Fetch,
  type RepoLookup,
  type Trouble,
} from './check';
import { readLanding, signInUrl, withoutLanding, type AuthOutcome } from './landing';
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
/** Tooltip of a repo link that waits for the lookup (or for the repository to exist). */
const NO_REPO_HINT = 'Turns on once your profile repository is found';

/** What the user status line says after `?auth=…`, until the user types. */
const AUTH_NOTICES: Record<AuthOutcome, string> = {
  cancelled: 'Sign-in cancelled. Type your username instead.',
  failed: 'Sign-in didn’t work. Type your username, or try signing in again.',
  unavailable: 'Sign-in isn’t available right now. Type your username instead.',
};

const userBox = el('#start');
const startLabel = el('#start-label');
const usernameInput = el<HTMLInputElement>('#username');
const userStatus = el('#user-status');
const linksHint = el('#links-hint');
const checkButton = el<HTMLButtonElement>('#check-setup');
const checkResult = el('#check-result');

/** Through the usage Worker's GitHub proxy, else direct. `fetch` is read per call, not captured. */
const api: Fetch = proxied((url, init) => fetch(url, init));

/** The trimmed input; links need it to pass `isGitHubUsername`. */
let username = '';
/** The lookup for `username`: null while there is none (yet) to make. */
let lookup: RepoLookup | 'pending' | null = null;
/** Settled lookups (found or missing) per lowercased username; troubles are retried. */
const lookups = new Map<string, RepoLookup>();
/** Lookups in flight per lowercased username, so a name is never asked for twice at once. */
const inFlight = new Map<string, Promise<RepoLookup>>();
/** The name is looked up on Enter, on leaving the field, or after a pause: never per keystroke. */
const typingPause = whenTypingStops(() => void lookUp());
/** Why sign-in came back without a login (`?auth=…`): shown in the status line until the user types. */
let authNotice: string | null = null;

/**
 * `<owner>/<owner>` and the branch the repo links use, once the lookup has an answer: the
 * repository as found, or, when GitHub couldn't be asked (rate limit, network, HTTP error),
 * the typed name on branch `main`. Null, so the links stay off, without a valid username,
 * while the name is typed or looked up, and when the repository doesn't exist.
 */
function repoTarget(): { owner: string; branch: string } | null {
  if (!isGitHubUsername(username) || lookup === null || lookup === 'pending') return null;
  if (lookup.kind === 'found') return lookup;
  if (lookup.kind === 'missing') return null;
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
  if (t.kind === 'rate-limited') return 'GitHub’s hourly limit was reached; try again later.';
  if (t.kind === 'network-error') return 'Couldn’t reach GitHub. Check your connection and try again.';
  return `GitHub answered HTTP ${t.status}. Try again later.`;
}

function renderRepoLinks(): void {
  const target = repoTarget();
  const valid = isGitHubUsername(username);
  const links = target ? profileRepoLinks(target.owner, target.branch) : null;
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-repo-link]')) {
    const key = a.dataset.repoLink as Exclude<keyof ProfileRepoLinks, 'repo' | 'newRepo'>;
    const href = links === null ? null : key === 'workflowNew' ? links.workflowNew(workflowYaml(setup)) : links[key];
    if (href === null) {
      a.removeAttribute('href');
      a.setAttribute('aria-disabled', 'true');
      a.title = valid ? NO_REPO_HINT : NO_USER_HINT;
    } else {
      a.href = href;
      a.removeAttribute('aria-disabled');
      a.removeAttribute('title');
    }
  }
  for (const name of document.querySelectorAll('[data-repo-name]')) {
    name.textContent = target ? `${target.owner}/${target.owner}` : 'your profile repository';
  }
  linksHint.hidden = target !== null;
  // The check looks the repository up itself (and says when it is missing): any valid name will do.
  checkButton.disabled = !valid || checkButton.dataset.busy === 'true';
  checkButton.title = valid ? '' : NO_USER_HINT;
}

function renderUserStatus(): void {
  const repoName = `${username}/${username}`;
  const found = isGitHubUsername(username) && lookup !== null && lookup !== 'pending' && lookup.kind === 'found';
  // The box stops shouting once its job is done.
  userBox.classList.toggle('done', found);
  startLabel.textContent = found ? 'Done' : 'Start here';
  userStatus.dataset.tone = '';
  usernameInput.removeAttribute('aria-invalid');
  if (authNotice !== null) {
    if (username !== '' && !isGitHubUsername(username)) usernameInput.setAttribute('aria-invalid', 'true');
    userStatus.dataset.tone = 'warn';
    userStatus.replaceChildren(authNotice);
  } else if (username === '') {
    userStatus.replaceChildren(`${NO_USER_HINT}.`);
  } else if (typingPause.typing && lookup === null) {
    userStatus.replaceChildren('Looking up when you stop typing…');
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

/** One GitHub lookup of `user`'s profile repository, shared by everyone asking meanwhile. */
function fetchLookup(user: string): Promise<RepoLookup> {
  const key = user.toLowerCase();
  let pending = inFlight.get(key);
  if (pending === undefined) {
    pending = lookupProfileRepo(user, api)
      .then((result) => {
        if (result.kind === 'found' || result.kind === 'missing') lookups.set(key, result);
        return result;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

/** Looks up the current username's profile repository now, from the cache when settled. */
async function lookUp(): Promise<RepoLookup | null> {
  const user = username;
  typingPause.markSettled(user);
  if (!isGitHubUsername(user)) {
    renderUserStatus();
    return null;
  }
  let result = lookups.get(user.toLowerCase());
  if (result === undefined) {
    lookup = 'pending';
    renderUserStatus();
    result = await fetchLookup(user);
  }
  if (username !== user) return null; // a late answer for a name no longer in the box
  lookup = result;
  renderUserStatus();
  renderRepoLinks();
  return result;
}

function clearCheck(): void {
  checkResult.hidden = true;
  checkResult.replaceChildren();
}

/** Takes the box's value; a name looked up before shows its answer at once. */
function setUsername(value: string): void {
  username = value.trim();
  try {
    localStorage.setItem(USERNAME_KEY, username);
  } catch {
    // Storage blocked (private mode, policy): the page still works, it just forgets.
  }
  clearCheck();
  lookup = (isGitHubUsername(username) && lookups.get(username.toLowerCase())) || null;
  renderUserStatus();
  renderRepoLinks();
}

usernameInput.addEventListener('input', () => {
  if (authNotice !== null) {
    authNotice = null; // typing is the answer to "type your username instead"
    renderUserStatus();
  }
  if (usernameInput.value.trim() === username) return; // e.g. a trailing space
  typingPause.typed(usernameInput.value.trim());
  setUsername(usernameInput.value);
});
// `change`: leaving the field (and Enter, in most browsers) after an edit.
usernameInput.addEventListener('change', () => typingPause.commit(username));
usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) typingPause.commit(username);
});

// The hint above step 1 jumps back to the box and puts the cursor in it.
el('#links-hint-link').addEventListener('click', (e) => {
  e.preventDefault();
  userBox.scrollIntoView({ block: 'nearest' });
  usernameInput.focus({ preventScroll: true });
});

el<HTMLAnchorElement>('#sign-in').href = signInUrl(location.href);

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

// The starting username: `?user=` (a shared link, or the end of sign-in), else the saved one.
const landing = readLanding(location.search);
const cleanSearch = withoutLanding(location.search);
if (cleanSearch !== location.search) {
  // Read once: a reload, or a later edit of the box, isn't overridden by a stale URL.
  history.replaceState(history.state, '', `${location.pathname}${cleanSearch}${location.hash}`);
}
if (landing.auth !== null) authNotice = AUTH_NOTICES[landing.auth];

let startUsername = landing.user ?? '';
if (landing.user === null) {
  try {
    startUsername = localStorage.getItem(USERNAME_KEY) ?? '';
  } catch {
    // Storage blocked: start empty.
  }
}
// Even an invalid `?user=` goes in the box: the status line says what is wrong with it.
usernameInput.value = startUsername;

el('#token-help').textContent = TOKEN_HELP;
el('#workflow-path').textContent = WORKFLOW_PATH;
// Saved like a typed name, so the next visit starts from it too.
setUsername(startUsername);
render();
// A name from the URL or from storage is a finished one: look it up now.
if (username !== '') void lookUp();
