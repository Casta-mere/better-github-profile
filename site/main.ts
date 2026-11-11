import { renderCards, STAT_KEYS, THEMES, type StatKey } from '../src/render/index';
import { validateSnapshot, type Mode, type Snapshot } from '../src/snapshot/types';
import {
  DEFAULT_SETUP,
  isGitHubUsername,
  outputDirOf,
  profileRepoLinks,
  readmeSnippet,
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
import { nodes, translateElement, translatePage } from './i18n/dom';
import { detectLang, getLang, setLang, t, toLang, withLang, type Key, type Lang } from './i18n/index';
import { readLanding, signInUrl, withoutLanding, type AuthOutcome } from './landing';
import sample from './sample-snapshot.json';
import { applyControl } from './state';
import { fetchWorkflowFile, workflowToRead, workflowView, type WorkflowFile } from './workflow-state';

if (!validateSnapshot(sample)) throw new Error('site/sample-snapshot.json is not a valid snapshot');
const snapshot: Snapshot = sample;

function el<T extends Element = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element ${selector}`);
  return found;
}

const controls = el<HTMLFormElement>('#controls');
const cardList = el('#cards');
const statList = el<HTMLOListElement>('#stats');
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
    input.parentElement!.title = input.disabled ? t('controls.lastCard') : '';
  }
}

/** Each stat's name on the page. Written out, so test/site-i18n.test.ts sees every key in use. */
const STAT_LABELS = {
  stars: 'stat.stars',
  forks: 'stat.forks',
  allTime: 'stat.allTime',
  pastYear: 'stat.pastYear',
  repos: 'stat.repos',
  followers: 'stat.followers',
  commits: 'stat.commits',
  pullRequests: 'stat.pullRequests',
  issues: 'stat.issues',
  reviews: 'stat.reviews',
  private: 'stat.private',
  joined: 'stat.joined',
} as const satisfies Record<StatKey, Key>;

/** The stat picker's rows, made once and moved around: a moved row keeps its focus and drag. */
const statRows = new Map<StatKey, HTMLLIElement>();

function moveButton(k: StatKey, by: -1 | 1): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'move';
  b.dataset.move = String(by);
  b.setAttribute('aria-describedby', `stat-name-${k}`);
  b.textContent = by < 0 ? '↑' : '↓';
  b.addEventListener('click', () => moveStat(k, by));
  return b;
}

function statRow(k: StatKey): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'stat';
  li.dataset.stat = k;
  const grip = document.createElement('span');
  grip.className = 'grip';
  grip.setAttribute('aria-hidden', 'true');
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = `stat-${k}`;
  input.addEventListener('change', () => {
    const stats = input.checked ? [...setup.stats, k] : setup.stats.filter((x) => x !== k);
    setStats(stats);
  });
  const name = document.createElement('span');
  name.id = `stat-name-${k}`;
  label.append(input, name);
  li.append(grip, label, moveButton(k, -1), moveButton(k, 1));
  return li;
}

/** Takes the chosen stats, in card order; the reducer keeps the old list if this one can't be shown. */
function setStats(stats: StatKey[]): void {
  setup = applyControl(setup, 'stats', stats.join(','));
  render();
}

/** Moves a chosen stat one place up or down among the chosen ones, keeping the focus on its arrow. */
function moveStat(k: StatKey, by: -1 | 1): void {
  const i = setup.stats.indexOf(k);
  const j = i + by;
  if (i < 0 || j < 0 || j >= setup.stats.length) return;
  const stats = [...setup.stats];
  [stats[i], stats[j]] = [stats[j]!, stats[i]!];
  setStats(stats);
  const row = statRows.get(k)!;
  const same = row.querySelector<HTMLButtonElement>(`button[data-move="${by}"]`)!;
  const other = row.querySelector<HTMLButtonElement>(`button[data-move="${-by}"]`)!;
  (same.disabled ? other : same).focus();
}

/**
 * The stat picker: chosen stats first, in card order, then the rest in their usual order.
 * The last chosen stat can't be unticked; at the theme's cap the others can't be ticked.
 * Only chosen rows move (by arrow or drag): the others have no place on the card.
 */
function renderStatChecks(): void {
  const order = [...setup.stats, ...STAT_KEYS.filter((k) => !setup.stats.includes(k))];
  const rows = order.map((k) => {
    let row = statRows.get(k);
    if (row === undefined) statRows.set(k, (row = statRow(k)));
    return row;
  });
  // Only when the order changed: moving a row in the DOM would end a drag in progress.
  if (rows.some((row, i) => statList.children[i] !== row)) statList.append(...rows);
  const max = THEMES[setup.theme].maxStats;
  const onlyOne = setup.stats.length === 1;
  const full = setup.stats.length >= max;
  for (const [i, k] of order.entries()) {
    const row = rows[i]!;
    const on = i < setup.stats.length;
    const input = row.querySelector('input')!;
    input.checked = on;
    input.disabled = on ? onlyOne : full;
    row.querySelector('label')!.title = !input.disabled ? '' : on ? t('controls.lastStat') : t('controls.statsCap', { max });
    row.querySelector('label span')!.textContent = t(STAT_LABELS[k]);
    row.classList.toggle('off', !on);
    row.draggable = on && !onlyOne;
    for (const b of row.querySelectorAll<HTMLButtonElement>('button[data-move]')) {
      const up = b.dataset.move === '-1';
      b.disabled = !on || (up ? i === 0 : i === setup.stats.length - 1);
      b.title = t(up ? 'controls.moveUp' : 'controls.moveDown');
      b.setAttribute('aria-label', b.title);
    }
  }
}

// Drag to reorder the chosen stats: the row follows the pointer and the preview redraws on every move.
let dragged: HTMLLIElement | null = null;
statList.addEventListener('dragstart', (e) => {
  if (!(e.target instanceof HTMLLIElement) || !e.target.draggable) return;
  dragged = e.target;
  dragged.classList.add('dragging');
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragged.dataset.stat ?? '');
  }
});
statList.addEventListener('dragover', (e) => {
  if (dragged === null || !(e.target instanceof Element)) return;
  const over = e.target.closest<HTMLLIElement>('li[data-stat]');
  // Chosen rows only: an unticked row has no place on the card to move to.
  if (over === null || over.classList.contains('off')) return;
  e.preventDefault();
  if (over === dragged) return;
  const box = over.getBoundingClientRect();
  const before = e.clientY < box.top + box.height / 2 ? over : over.nextElementSibling;
  if (before === dragged || before === dragged.nextElementSibling) return;
  statList.insertBefore(dragged, before);
  setStats([...statList.querySelectorAll<HTMLLIElement>('li.stat:not(.off)')].map((li) => li.dataset.stat as StatKey));
});
statList.addEventListener('drop', (e) => e.preventDefault());
statList.addEventListener('dragend', () => {
  dragged?.classList.remove('dragging');
  dragged = null;
});

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
  renderStatChecks();
}

function renderPreview(): void {
  const cards = renderCards(snapshot, { theme: setup.theme, cards: setup.cards, stats: setup.stats }).filter((c) =>
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

function flash(button: HTMLButtonElement, key: 'copy.copied' | 'copy.selected' | 'copy.failed'): void {
  button.textContent = t(key);
  button.classList.add('done');
  window.setTimeout(() => {
    translateElement(button); // its label again, in the language of the moment
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
    flash(button, 'copy.copied');
  } catch {
    // No clipboard access (e.g. an insecure origin): select the text so ⌘C / Ctrl+C works.
    if (source) selectContents(source);
    flash(button, source ? 'copy.selected' : 'copy.failed');
  }
});

// --- Profile repository: username, lookup, direct links ---

const USERNAME_KEY = 'better-github-profile:username';

/** What the user status line says after `?auth=…`, until the user types. */
const AUTH_NOTICES = {
  cancelled: 'auth.cancelled',
  failed: 'auth.failed',
  unavailable: 'auth.unavailable',
} as const satisfies Record<AuthOutcome, Key>;

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
let authNotice: AuthOutcome | null = null;

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

function troubleText(trouble: Trouble): string {
  if (trouble.kind === 'rate-limited') return t('trouble.rateLimited');
  if (trouble.kind === 'network-error') return t('trouble.network');
  return t('trouble.http', { status: trouble.status });
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
      // Tooltip of a repo link that waits for a username, or for the lookup (or the repository) to exist.
      a.title = valid ? t('user.noRepo') : t('user.noUser');
    } else {
      a.href = href;
      a.removeAttribute('aria-disabled');
      a.removeAttribute('title');
    }
  }
  for (const name of document.querySelectorAll('[data-repo-name]')) {
    name.textContent = target ? `${target.owner}/${target.owner}` : t('repo.yours');
  }
  linksHint.hidden = target !== null;
  // The check looks the repository up itself (and says when it is missing): any valid name will do.
  checkButton.disabled = !valid || checkButton.dataset.busy === 'true';
  checkButton.title = valid ? '' : t('user.noUser');
  renderWorkflowState();
}

function renderUserStatus(): void {
  const repoName = `${username}/${username}`;
  const found = isGitHubUsername(username) && lookup !== null && lookup !== 'pending' && lookup.kind === 'found';
  // The box stops shouting once its job is done.
  userBox.classList.toggle('done', found);
  startLabel.dataset.i18n = found ? 'start.done' : 'start.here';
  translateElement(startLabel);
  userStatus.dataset.tone = '';
  usernameInput.removeAttribute('aria-invalid');
  if (authNotice !== null) {
    if (username !== '' && !isGitHubUsername(username)) usernameInput.setAttribute('aria-invalid', 'true');
    userStatus.dataset.tone = 'warn';
    userStatus.replaceChildren(t(AUTH_NOTICES[authNotice]));
  } else if (username === '') {
    userStatus.replaceChildren(t('user.empty'));
  } else if (typingPause.typing && lookup === null) {
    userStatus.replaceChildren(t('user.waiting'));
  } else if (!isGitHubUsername(username)) {
    usernameInput.setAttribute('aria-invalid', 'true');
    userStatus.dataset.tone = 'err';
    userStatus.replaceChildren(t('user.invalid'));
  } else if (lookup === null || lookup === 'pending') {
    userStatus.replaceChildren(...nodes('user.lookingUp', { repo: code(repoName) }));
  } else if (lookup.kind === 'found') {
    const name = `${lookup.owner}/${lookup.owner}`;
    userStatus.dataset.tone = 'ok';
    userStatus.replaceChildren(
      ...nodes('user.found', {
        repo: link(profileRepoLinks(lookup.owner, lookup.branch).repo, code(name)),
        branch: code(lookup.branch),
      }),
    );
  } else if (lookup.kind === 'missing') {
    userStatus.dataset.tone = 'warn';
    userStatus.replaceChildren(
      ...nodes('user.missing', {
        repo: code(repoName),
        create: link(profileRepoLinks(username, 'main').newRepo, t('repo.create')),
        retry: retryButton(t('retry.inline')),
      }),
    );
  } else {
    userStatus.dataset.tone = 'warn';
    userStatus.replaceChildren(
      ...nodes('user.trouble', {
        repo: repoName,
        trouble: troubleText(lookup),
        main: code('main'),
        retry: retryButton(t('retry.button')),
      }),
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
        // Even for a name no longer in the box: when it comes back, its workflow is known or being read.
        if (result.kind === 'found') void loadWorkflowFile(result.owner);
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
  if (result.kind === 'found') void loadWorkflowFile(result.owner);
  renderUserStatus();
  renderRepoLinks();
  return result;
}

function clearCheck(): void {
  checkView = null;
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
  if (lookup?.kind === 'found') void loadWorkflowFile(lookup.owner);
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

// --- Step 2: a workflow that already exists ---

/** The workflow file per lowercased owner. Troubles are kept to show, but read again on the next lookup. */
const workflowFiles = new Map<string, WorkflowFile>();
/** Reads in flight per lowercased owner, so a file is never asked for twice at once. */
const workflowReads = new Map<string, Promise<void>>();

/** Reads `<owner>/<owner>`'s workflow file unless it is cached (found or missing); `fresh` reads it anyway. */
function loadWorkflowFile(owner: string, fresh = false): Promise<void> {
  const key = owner.toLowerCase();
  const cached = workflowFiles.get(key)?.kind;
  if (!fresh && (cached === 'found' || cached === 'missing')) return Promise.resolve();
  let pending = workflowReads.get(key);
  if (pending === undefined) {
    pending = fetchWorkflowFile(owner, api)
      // Never expected (troubles come back as values), but `checking` must always end.
      .catch((): WorkflowFile => ({ kind: 'network-error' }))
      .then((file) => {
        workflowFiles.set(key, file);
        renderRepoLinks(); // turns Add back on after `checking`, then renders step 2
      })
      .finally(() => workflowReads.delete(key));
    workflowReads.set(key, pending);
  }
  return pending;
}

/**
 * The workflow file in the repository the links point at: the found repository's owner (null
 * when none is found), what is known about its file (undefined: nothing yet), and whether a
 * read of it is in flight.
 */
function workflowNow(): { owner: string | null; file: WorkflowFile | undefined; reading: boolean } {
  if (lookup === null || lookup === 'pending' || lookup.kind === 'missing') {
    return { owner: null, file: undefined, reading: false };
  }
  // A failed repository lookup leaves the workflow unknown just the same.
  if (lookup.kind !== 'found') return { owner: null, file: lookup, reading: false };
  const key = lookup.owner.toLowerCase();
  return { owner: lookup.owner, file: workflowFiles.get(key), reading: workflowReads.has(key) };
}

/**
 * Step 2 (and step 4's note) for the workflow file, as `workflowView` decides: for a found
 * repository Add stays off until its read settles, however the lookup arrived (typed, cached,
 * late). Starts that read if none is running, so `checking` always ends. Runs after
 * renderRepoLinks has set the links. Compares the cached file with the current YAML, so a
 * config change asks GitHub nothing.
 */
function renderWorkflowState(): void {
  const { owner, file, reading } = workflowNow();
  const toRead = workflowToRead({ owner, file, reading });
  if (toRead !== null) void loadWorkflowFile(toRead);
  const target = repoTarget();
  const view = workflowView({ file, hasTarget: target !== null, yaml: workflowYaml(setup) });
  if (view === 'checking') {
    // Add would hit GitHub's "already exists" if the file is there: wait for the answer.
    const add = el<HTMLAnchorElement>('#workflow-new');
    add.removeAttribute('href');
    add.setAttribute('aria-disabled', 'true');
    add.title = t('step2.checkingTitle');
  }
  if (view === 'trouble' && target !== null && file !== undefined && file.kind !== 'found' && file.kind !== 'missing') {
    // Add stays the button; Update is offered here, so the header keeps two buttons on a phone.
    el('#workflow-trouble').replaceChildren(
      ...nodes('step2.trouble', {
        trouble: troubleText(file),
        update: link(profileRepoLinks(target.owner, target.branch).workflowEdit, t('step2.updateIt')),
        retry: retryButton(t('retry.button')),
      }),
    );
  }
  for (const node of document.querySelectorAll<HTMLElement>('[data-workflow-show]')) {
    node.hidden = !(node.dataset.workflowShow ?? '').split(' ').includes(view);
  }
}

// --- Step 3: check setup ---

type Tone = 'ok' | 'warn' | 'err' | 'info';

/** Draws the last check's result: run again on a language switch. Null while none is shown. */
let checkView: (() => void) | null = null;

/** Shows a check's result, drawn by `draw` now and again in each language switched to. */
function showCheckView(draw: () => void): void {
  checkView = draw;
  draw();
}

/** The check result box: one headline, more lines, then `extra` (a preview) and the time of the check. */
function showCheck(tone: Tone, at: Date, lines: (string | Node)[][], extra: Node[] = []): void {
  const time = document.createElement('span');
  time.className = 'checked-at';
  const clock = at.toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  time.textContent = t('check.at', { time: clock });
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
  a.textContent = t('check.step', { step });
  return a;
}

function strong(text: string): HTMLElement {
  const b = document.createElement('strong');
  b.textContent = text;
  return b;
}

/** A check's verdict for `<owner>/<owner>` in words, as of `at`; `output` is the cards folder it looked in. */
function renderCheck(result: CheckResult, owner: string, branch: string, output: string, at: Date): void {
  const links = profileRepoLinks(owner, branch);
  const runLink = (url: string) => link(url, t('check.openRun'));
  switch (result.kind) {
    case 'no-workflow':
      return showCheck('err', at, [[t('check.noWorkflow')]]);
    case 'not-run':
      return showCheck('info', at, [nodes('check.notRun', { run: link(links.workflowPage, strong('Run workflow')) })]);
    case 'running':
      return showCheck('info', at, [nodes('check.running', { run: runLink(result.runUrl) })]);
    case 'failed': {
      const why =
        result.cause === 'secret-missing'
          ? nodes('check.secretMissing', { secret: code('STATS_TOKEN'), step: stepLink('1c') })
          : result.cause === 'token-rejected'
            ? nodes('check.tokenRejected', { step1a: stepLink('1a'), secret: code('STATS_TOKEN'), step1c: stepLink('1c') })
            : [result.message === null ? t('check.failed') : t('check.failedWhy')];
      const detail = result.cause === 'other' && result.message !== null ? [[result.message]] : [];
      return showCheck('err', at, [why, ...detail, [runLink(result.runUrl)]]);
    }
    case 'ended':
      return showCheck('err', at, [
        [t('check.failedWhy')],
        [t('check.ended', { conclusion: result.conclusion })],
        [runLink(result.runUrl)],
      ]);
    case 'no-snapshot':
      return showCheck('warn', at, [
        nodes('check.noSnapshot', { file: code(`${output}/snapshot.json`) }),
        nodes('check.noSnapshotRun', { run: runLink(result.runUrl) }),
      ]);
    case 'ready': {
      const preview: Node[] = [];
      if (result.previewUrl !== null) {
        const img = document.createElement('img');
        img.className = 'check-preview';
        img.src = result.previewUrl;
        img.alt = t('check.previewAlt');
        preview.push(img);
      }
      // `stale` is the Action's own warning: it stays as the run wrote it.
      const lines: (string | Node)[][] =
        result.stale === null
          ? [[t('check.ready')], [runLink(result.runUrl)]]
          : [[t('check.readyStale')], [result.stale], [runLink(result.runUrl)]];
      return showCheck(result.stale === null ? 'ok' : 'warn', at, lines, preview);
    }
    default:
      return showCheck(result.kind === 'rate-limited' ? 'warn' : 'err', at, [[troubleText(result)]]);
  }
}

/** The check button's label: `check.busy` while a check runs. Kept as its key, so a switch keeps it. */
function setCheckLabel(key: 'check.button' | 'check.busy'): void {
  checkButton.dataset.i18n = key;
  translateElement(checkButton);
}

checkButton.addEventListener('click', async () => {
  const user = username;
  if (!isGitHubUsername(user)) return;
  checkButton.dataset.busy = 'true';
  checkButton.disabled = true;
  setCheckLabel('check.busy');
  try {
    // A missing repository may have been created since: look again rather than trust the cache.
    if (lookup !== null && lookup !== 'pending' && lookup.kind !== 'found') lookups.delete(user.toLowerCase());
    const repo = await lookUp();
    if (repo === null || username !== user) return;
    if (repo.kind === 'missing') {
      const at = new Date();
      showCheckView(() =>
        showCheck('err', at, [
          nodes('check.repoMissing', {
            repo: code(`${user}/${user}`),
            create: link(profileRepoLinks(user, 'main').newRepo, t('repo.create')),
          }),
        ]),
      );
      return;
    }
    if (repo.kind !== 'found') {
      const at = new Date();
      showCheckView(() => showCheck(repo.kind === 'rate-limited' ? 'warn' : 'err', at, [[troubleText(repo)]]));
      return;
    }
    void loadWorkflowFile(repo.owner, true);
    const output = outputDirOf(setup);
    const result = await checkSetup(repo.owner, repo.branch, output, api);
    const at = new Date();
    if (username === user) showCheckView(() => renderCheck(result, repo.owner, repo.branch, output, at));
  } finally {
    delete checkButton.dataset.busy;
    setCheckLabel('check.button');
    renderRepoLinks();
  }
});

// --- Language ---

const LANG_KEY = 'better-github-profile:lang';
const langRadios = document.querySelectorAll<HTMLInputElement>('input[name="lang"]');

/** Puts the page's static text in `lang`. Text built in code follows from its next render. */
function applyLang(lang: Lang): void {
  setLang(lang);
  document.documentElement.lang = lang;
  for (const radio of langRadios) radio.checked = radio.value === lang;
  translatePage();
}

for (const radio of langRadios) {
  radio.addEventListener('change', () => {
    const lang = toLang(radio.value) ?? 'en';
    applyLang(lang);
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // Storage blocked: the switch holds until the page is left.
    }
    const search = withLang(location.search, lang);
    if (search !== location.search) history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);
    // Only words change: the form, the lookup and the check keep their state.
    renderCardChecks();
    renderStatChecks();
    renderUserStatus();
    renderRepoLinks();
    checkView?.();
  });
}

let storedLang: string | null = null;
try {
  storedLang = localStorage.getItem(LANG_KEY);
} catch {
  // Storage blocked: go by `?lang=` and the browser.
}
applyLang(detectLang({ search: location.search, stored: storedLang, browser: navigator.language }));

// The starting username: `?user=` (a shared link, or the end of sign-in), else the saved one.
const landing = readLanding(location.search);
const cleanSearch = withoutLanding(location.search);
if (cleanSearch !== location.search) {
  // Read once: a reload, or a later edit of the box, isn't overridden by a stale URL.
  history.replaceState(history.state, '', `${location.pathname}${cleanSearch}${location.hash}`);
}
if (landing.auth !== null) authNotice = landing.auth;

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

el('#workflow-path').textContent = WORKFLOW_PATH;
// Saved like a typed name, so the next visit starts from it too.
setUsername(startUsername);
render();
// A name from the URL or from storage is a finished one: look it up now.
if (username !== '') void lookUp();
