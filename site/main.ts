import { renderCards, THEMES } from '../src/render/index';
import { validateSnapshot, type Mode, type Snapshot } from '../src/snapshot/types';
import { DEFAULT_SETUP, readmeSnippet, TOKEN_HELP, WORKFLOW_PATH, workflowYaml, type SetupConfig } from '../src/snippets/index';
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
  // Not only the form: the README format toggle sits in step 3's header.
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

el('#token-help').textContent = TOKEN_HELP;
el('#workflow-path').textContent = WORKFLOW_PATH;
render();
