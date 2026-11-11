import { describe, expect, it } from 'vitest';
import { THEMES } from '../src/render/index';
import { isGitHubUsername, profileRepoLinks, rawFileUrl, tokenUrl } from '../src/snippets/links';
import { escapeMarkdownAlt, readmeSnippet } from '../src/snippets/readme';
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
      readmeFormat: 'picture',
      stats: THEMES.native.defaultStats,
    });
  });

  it('stats are the native default', () => {
    expect(DEFAULT_SETUP.stats).toEqual([...THEMES.native.defaultStats]);
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

  it('ignores readmeFormat, which is not an Action input', () => {
    for (const c of [DEFAULT_SETUP, setup({ theme: 'strip', includeForks: true, outputDir: 'assets' })]) {
      expect(workflowYaml({ ...c, readmeFormat: 'markdown' })).toBe(workflowYaml({ ...c, readmeFormat: 'picture' }));
    }
  });

  it('leaves stats out when they are the theme default', () => {
    expect(workflowYaml(DEFAULT_SETUP)).not.toMatch(/^\s+stats:/m);
    const strip = setup({ theme: 'strip', cards: ['strip'], stats: [...THEMES.strip.defaultStats] });
    expect(workflowYaml(strip)).not.toMatch(/^\s+stats:/m);
  });

  it('emits stats, in order, after cards when they differ from the theme default', () => {
    expect(workflowYaml(setup({ stats: ['followers', 'stars'] }))).toMatch(/^ {10}stats: followers,stars$/m);
    const y = workflowYaml(setup({ cards: ['overview'], stats: ['stars'] }));
    expect(y).toMatch(/^ {10}cards: overview\n {10}stats: stars$/m);
    // Same keys, another order: still a change.
    expect(workflowYaml(setup({ stats: ['forks', 'stars', 'allTime', 'pastYear', 'repos'] }))).toMatch(/^ {10}stats: forks,stars,/m);
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

describe('readmeSnippet, markdown format', () => {
  const md = (over: Partial<SetupConfig> = {}, repoPath?: string) =>
    readmeSnippet(setup({ readmeFormat: 'markdown', ...over }), repoPath);
  /** The snippet's lines, without the empty string after its trailing newline. */
  const lines = (r: string) => {
    expect(r.endsWith('\n')).toBe(true);
    return r.slice(0, -1).split('\n');
  };

  it('default setup gives exactly 4 lines and no <picture>', () => {
    const r = md();
    expect(lines(r)).toEqual([
      '![GitHub stats](cards/native-overview-light.svg#gh-light-mode-only)',
      '![GitHub stats](cards/native-overview-dark.svg#gh-dark-mode-only)',
      '![Top languages](cards/native-languages-light.svg#gh-light-mode-only)',
      '![Top languages](cards/native-languages-dark.svg#gh-dark-mode-only)',
    ]);
    expect(r).not.toContain('<picture>');
  });

  it('puts the light line, ending #gh-light-mode-only), before the dark line, ending #gh-dark-mode-only)', () => {
    const [light, dark] = lines(md({ cards: ['languages'] }));
    expect(light).toMatch(/-light\.svg#gh-light-mode-only\)$/);
    expect(dark).toMatch(/-dark\.svg#gh-dark-mode-only\)$/);
  });

  it('prefixes outputDir and repoPath', () => {
    const [light, dark] = lines(md({ outputDir: 'assets/stats/' }, 'https://example.test/u/u/main/'));
    expect(light).toBe('![GitHub stats](https://example.test/u/u/main/assets/stats/native-overview-light.svg#gh-light-mode-only)');
    expect(dark).toBe('![GitHub stats](https://example.test/u/u/main/assets/stats/native-overview-dark.svg#gh-dark-mode-only)');
  });

  it('strip theme gives 2 lines', () => {
    expect(lines(md({ theme: 'strip', cards: ['strip'] }))).toEqual([
      '![GitHub stats](cards/strip-strip-light.svg#gh-light-mode-only)',
      '![GitHub stats](cards/strip-strip-dark.svg#gh-dark-mode-only)',
    ]);
  });

  it('percent-encodes characters that would end the link destination', () => {
    expect(lines(md({ outputDir: 'my cards (v2)', cards: ['overview'] }))[0]).toBe(
      '![GitHub stats](my%20cards%20%28v2%29/native-overview-light.svg#gh-light-mode-only)',
    );
  });

  it('leaves the <picture> output unchanged', () => {
    const picture = readmeSnippet(DEFAULT_SETUP);
    expect(readmeSnippet(setup({ readmeFormat: 'picture' }))).toBe(picture);
    expect(picture.startsWith('<picture>\n')).toBe(true);
    expect(picture.endsWith('</picture>\n')).toBe(true);
  });
});

describe('escapeMarkdownAlt', () => {
  it('backslash-escapes ], [ and \\', () => {
    expect(escapeMarkdownAlt('a]b')).toBe('a\\]b');
    expect(escapeMarkdownAlt('[x] \\ y')).toBe('\\[x\\] \\\\ y');
  });

  it('leaves other text alone', () => expect(escapeMarkdownAlt('GitHub stats (2026)')).toBe('GitHub stats (2026)'));
});

it('TOKEN_HELP names the scopes', () => {
  expect(TOKEN_HELP).toContain('read:user');
  expect(TOKEN_HELP).toContain('repo');
  expect(TOKEN_HELP).toContain('STATS_TOKEN');
});

describe('isGitHubUsername', () => {
  it('accepts letters, digits and single inner hyphens, up to 39 characters', () => {
    for (const u of ['Casta-mere', 'a', 'octo-cat-42', '0x', 'a'.repeat(39)]) expect(isGitHubUsername(u), u).toBe(true);
  });

  it('rejects empty, leading/trailing/double hyphens, other characters and 40+ characters', () => {
    for (const u of ['', '-a', 'a-', 'a--b', 'a_b', 'a.b', 'a b', 'ä', 'a/b', 'a'.repeat(40)]) {
      expect(isGitHubUsername(u), u).toBe(false);
    }
  });
});

describe('tokenUrl', () => {
  it('asks for read:user and repo when private work is included', () => {
    expect(tokenUrl(DEFAULT_SETUP)).toBe(
      'https://github.com/settings/tokens/new?scopes=read:user,repo&description=better-github-profile',
    );
  });

  it('asks for read:user only when private work is left out', () => {
    expect(tokenUrl(setup({ includePrivate: false }))).toBe(
      'https://github.com/settings/tokens/new?scopes=read:user&description=better-github-profile',
    );
  });
});

describe('profileRepoLinks', () => {
  const links = profileRepoLinks('Casta-mere', 'main');

  it('points into <user>/<user>', () => {
    expect(links.repo).toBe('https://github.com/Casta-mere/Casta-mere');
    expect(links.secretNew).toBe('https://github.com/Casta-mere/Casta-mere/settings/secrets/actions/new');
    expect(links.workflowPage).toBe('https://github.com/Casta-mere/Casta-mere/actions/workflows/profile-cards.yml');
    expect(links.readmeEdit).toBe('https://github.com/Casta-mere/Casta-mere/edit/main/README.md');
    expect(links.newRepo).toBe('https://github.com/new?name=Casta-mere');
  });

  it('opens a new-file page at WORKFLOW_PATH on the branch, prefilled with the workflow', () => {
    const yaml = workflowYaml(DEFAULT_SETUP);
    const url = new URL(links.workflowNew(yaml));
    expect(`${url.origin}${url.pathname}`).toBe('https://github.com/Casta-mere/Casta-mere/new/main');
    expect(url.searchParams.get('filename')).toBe(WORKFLOW_PATH);
    expect(url.searchParams.get('value')).toBe(yaml);
    expect(links.workflowNew(yaml)).toContain(`&value=${encodeURIComponent(yaml)}`);
  });

  it('opens the editor of the existing workflow at WORKFLOW_PATH on the branch', () => {
    expect(links.workflowEdit).toBe(
      'https://github.com/Casta-mere/Casta-mere/edit/main/.github/workflows/profile-cards.yml',
    );
    expect(links.workflowEdit.endsWith(`/edit/main/${WORKFLOW_PATH}`)).toBe(true);
  });

  it('uses the given branch and keeps a slash in it as a path separator', () => {
    const l = profileRepoLinks('octo', 'release/v 2');
    expect(l.readmeEdit).toBe('https://github.com/octo/octo/edit/release/v%202/README.md');
    expect(l.workflowEdit).toBe('https://github.com/octo/octo/edit/release/v%202/.github/workflows/profile-cards.yml');
    expect(l.workflowNew('x')).toMatch(/^https:\/\/github\.com\/octo\/octo\/new\/release\/v%202\?filename=/);
  });

  it('rejects a username GitHub would not allow', () => {
    expect(() => profileRepoLinks('a/b', 'main')).toThrow(/username/);
  });
});

describe('rawFileUrl', () => {
  it('points at raw.githubusercontent.com on the branch', () => {
    expect(rawFileUrl('Casta-mere', 'main', 'cards/native-overview-light.svg')).toBe(
      'https://raw.githubusercontent.com/Casta-mere/Casta-mere/main/cards/native-overview-light.svg',
    );
  });

  it('percent-encodes each path segment', () => {
    expect(rawFileUrl('octo', 'dev/x', 'my cards/a#b.svg')).toBe(
      'https://raw.githubusercontent.com/octo/octo/dev/x/my%20cards/a%23b.svg',
    );
  });
});
