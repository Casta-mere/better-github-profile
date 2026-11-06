import { describe, expect, it } from 'vitest';
import { THEMES } from '../src/render/index';
import { readmeSnippet } from '../src/snippets/readme';
import { DEFAULT_SETUP, TOKEN_HELP, WORKFLOW_PATH, workflowYaml, type SetupConfig } from '../src/snippets/workflow';

const setup = (over: Partial<SetupConfig>): SetupConfig => ({ ...DEFAULT_SETUP, ...over });

describe('DEFAULT_SETUP', () => {
  it('is native, all cards, private on, forks off, nothing excluded, cards/, telemetry on', () => {
    expect(DEFAULT_SETUP).toEqual({
      theme: 'native',
      cards: THEMES.native.cards,
      includePrivate: true,
      includeForks: false,
      excludeRepos: [],
      excludeLangs: [],
      outputDir: 'cards',
      telemetry: true,
    });
  });
});

describe('workflowYaml', () => {
  it('default workflow is minimal', () => {
    const y = workflowYaml(DEFAULT_SETUP);
    expect(y).toContain('uses: casta-mere/better-github-profile@v1');
    expect(y).toContain('token: ${{ secrets.STATS_TOKEN }}');
    expect(y).toContain("cron: '17 3 * * *'");
    expect(y).toContain('workflow_dispatch:');
    expect(y).toContain('contents: write');
    expect(y).toContain('uses: actions/checkout@v7');
    expect(y).toContain('concurrency:');
    expect(y).not.toMatch(/include_private|include_forks|exclude_|output_dir|^\s+cards:|telemetry/m); // defaults omitted (job id must not be `cards`)
  });

  it('has job `update` with contents: write, and a non-cancelling concurrency group', () => {
    const y = workflowYaml(DEFAULT_SETUP);
    expect(y).toMatch(/^jobs:\n {2}update:\n/m);
    expect(y).toMatch(/^ {4}permissions:\n {6}contents: write$/m);
    expect(y).toMatch(/^concurrency:\n {2}group: profile-cards\n {2}cancel-in-progress: false$/m);
    expect(y.indexOf('actions/checkout@v7')).toBeLessThan(y.indexOf('casta-mere/better-github-profile@v1'));
    expect(y.endsWith('\n')).toBe(true);
    expect(y).not.toContain('\t');
  });

  it('non-defaults are emitted', () => {
    const y = workflowYaml(
      setup({
        theme: 'strip',
        cards: ['strip'],
        includePrivate: false,
        includeForks: true,
        excludeRepos: ['a', 'b'],
        excludeLangs: ['TeX', 'C#'],
        outputDir: 'assets/stats',
        telemetry: false,
      }),
    );
    expect(y).toContain('theme: strip');
    expect(y).toContain('include_private: false');
    expect(y).toContain('include_forks: true');
    expect(y).toContain('exclude_repos: a,b');
    expect(y).toContain('exclude_langs: TeX,C#');
    expect(y).toContain('output_dir: assets/stats');
    expect(y).toContain('telemetry: false');
    expect(y).not.toMatch(/^\s+cards:/m); // ['strip'] is every strip card
  });

  it('emits cards only when they are a subset of the theme', () => {
    expect(workflowYaml(setup({ cards: ['overview'] }))).toMatch(/^ {10}cards: overview$/m);
    expect(workflowYaml(setup({ cards: ['languages', 'overview'] }))).not.toMatch(/^\s+cards:/m);
  });

  it('quotes values YAML would misread', () => {
    const y = workflowYaml(setup({ excludeLangs: ['*weird', 'a: b'] }));
    expect(y).toContain("exclude_langs: '*weird,a: b'");
    expect(workflowYaml(setup({ excludeRepos: ["it's"] }))).toContain("exclude_repos: 'it''s'");
  });

  it('names the file users save it as', () => expect(WORKFLOW_PATH).toBe('.github/workflows/profile-cards.yml'));
});

describe('readmeSnippet', () => {
  it('readme uses <picture> per card', () => {
    const r = readmeSnippet(DEFAULT_SETUP);
    expect(r).toContain('<source media="(prefers-color-scheme: dark)" srcset="cards/native-overview-dark.svg">');
    expect(r).toContain('<img alt="GitHub stats" src="cards/native-overview-light.svg">');
    expect((r.match(/<picture>/g) ?? []).length).toBe(2);
  });

  it('follows the theme card order and the chosen cards', () => {
    const both = readmeSnippet(setup({ cards: ['languages', 'overview'] }));
    expect(both.indexOf('native-overview-light.svg')).toBeLessThan(both.indexOf('native-languages-light.svg'));
    const one = readmeSnippet(setup({ cards: ['languages'] }));
    expect((one.match(/<picture>/g) ?? []).length).toBe(1);
    expect(one).toContain('src="cards/native-languages-light.svg"');
    expect(readmeSnippet(setup({ theme: 'strip', cards: ['strip'] }))).toContain('srcset="cards/strip-strip-dark.svg"');
  });

  it('prefixes outputDir and repoPath', () => {
    const r = readmeSnippet(setup({ outputDir: 'assets/stats/' }), 'https://example.test/u/u/main/');
    expect(r).toContain('srcset="https://example.test/u/u/main/assets/stats/native-overview-dark.svg"');
    expect(r).toContain('src="https://example.test/u/u/main/assets/stats/native-languages-light.svg"');
  });
});

it('TOKEN_HELP names the scopes', () => {
  expect(TOKEN_HELP).toContain('read:user');
  expect(TOKEN_HELP).toContain('repo');
  expect(TOKEN_HELP).toContain('STATS_TOKEN');
});
