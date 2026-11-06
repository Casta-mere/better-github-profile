import { THEMES } from '../render/index';
import type { ThemeName } from '../snapshot/types';

/** What the selector page lets users choose; turned into the workflow and README markup. */
export interface SetupConfig {
  theme: ThemeName;
  cards: string[];
  includePrivate: boolean;
  includeForks: boolean;
  excludeRepos: string[];
  excludeLangs: string[];
  outputDir: string;
  telemetry: boolean;
}

/** The Action's own defaults: a workflow generated from this has no optional inputs. */
export const DEFAULT_SETUP: SetupConfig = {
  theme: 'native',
  cards: [...THEMES.native.cards],
  includePrivate: true,
  includeForks: false,
  excludeRepos: [],
  excludeLangs: [],
  outputDir: 'cards',
  telemetry: true,
};

/** Where users save the generated workflow. */
export const WORKFLOW_PATH = '.github/workflows/profile-cards.yml';

export const TOKEN_HELP =
  'Create a classic personal access token with the read:user scope (add the repo scope to include private work) and save it in your profile repository as the Actions secret STATS_TOKEN.';

/** The chosen cards that exist in the chosen theme, in theme order; none chosen = all. */
export function selectedCards(c: SetupConfig): string[] {
  const all = THEMES[c.theme].cards;
  const chosen = all.filter((card) => c.cards.includes(card));
  return chosen.length > 0 ? chosen : [...all];
}

/** `outputDir` without surrounding whitespace or trailing slashes; empty = the default. */
export function outputDirOf(c: SetupConfig): string {
  return c.outputDir.trim().replace(/\/+$/, '') || DEFAULT_SETUP.outputDir;
}

const cleanList = (xs: string[]) => xs.map((x) => x.trim()).filter((x) => x.length > 0);

const PLAIN = /^[A-Za-z0-9_./][A-Za-z0-9_./+#, -]*$/;
const NOT_A_STRING = /^(?:true|false|yes|no|on|off|y|n|null|~|[-+]?[\d.][\d._]*)$/i;

/** A YAML scalar: plain when that reads back as the same string, else single-quoted. */
function yamlValue(v: string): string {
  if (PLAIN.test(v) && !/ #|\s$/.test(v) && !NOT_A_STRING.test(v)) return v;
  return `'${v.replace(/'/g, "''")}'`;
}

/** The workflow file. Inputs equal to the Action's defaults are left out. */
export function workflowYaml(c: SetupConfig): string {
  // Values are YAML already: booleans and theme names as-is, free text through yamlValue.
  const inputs: [string, string][] = [];
  if (c.theme !== DEFAULT_SETUP.theme) inputs.push(['theme', c.theme]);
  const cards = selectedCards(c);
  if (cards.length < THEMES[c.theme].cards.length) inputs.push(['cards', yamlValue(cards.join(','))]);
  if (!c.includePrivate) inputs.push(['include_private', 'false']);
  if (c.includeForks) inputs.push(['include_forks', 'true']);
  const repos = cleanList(c.excludeRepos);
  if (repos.length > 0) inputs.push(['exclude_repos', yamlValue(repos.join(','))]);
  const langs = cleanList(c.excludeLangs);
  if (langs.length > 0) inputs.push(['exclude_langs', yamlValue(langs.join(','))]);
  const dir = outputDirOf(c);
  if (dir !== DEFAULT_SETUP.outputDir) inputs.push(['output_dir', yamlValue(dir)]);
  if (!c.telemetry) inputs.push(['telemetry', 'false']);

  return [
    'name: Profile cards',
    '',
    'on:',
    '  schedule:',
    "    - cron: '17 3 * * *' # daily, 03:17 UTC",
    '  workflow_dispatch:',
    '',
    '# A manual run and a scheduled run never push at the same time.',
    'concurrency:',
    '  group: profile-cards',
    '  cancel-in-progress: false',
    '',
    'jobs:',
    '  update:',
    '    runs-on: ubuntu-latest',
    '    permissions:',
    '      contents: write',
    '    steps:',
    '      - uses: actions/checkout@v7',
    '      - uses: casta-mere/better-github-profile@v1',
    '        with:',
    '          token: ${{ secrets.STATS_TOKEN }}',
    ...inputs.map(([k, v]) => `          ${k}: ${v}`),
    '',
  ].join('\n');
}
