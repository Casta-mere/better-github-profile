import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TELEMETRY_URL } from '../src/action/telemetry';
import { THEMES } from '../src/render/index';
import { DEFAULT_SETUP, readmeSnippet, TOKEN_HELP, WORKFLOW_PATH, workflowYaml } from '../src/snippets/index';

const root = new URL('../', import.meta.url);
const readme = readFileSync(new URL('README.md', root), 'utf8');
const actionYml = readFileSync(new URL('action.yml', root), 'utf8');

/** `inputs:` of action.yml as [name, default]; `undefined` when an input has no default. */
function actionInputs(yml: string): [string, string | undefined][] {
  const block = yml.split(/^inputs:\n/m)[1]?.split(/^\S/m)[0] ?? '';
  return block
    .split(/^ {2}(?=\S)/m)
    .filter((entry) => entry.trim() !== '')
    .map((entry) => {
      const name = entry.slice(0, entry.indexOf(':'));
      const raw = /^ {4}default: *(.*)$/m.exec(entry)?.[1];
      return [name, raw === undefined ? undefined : raw.trim().replace(/^'(.*)'$/, '$1')];
    });
}

/** Rows of the README table whose first cell is an input name in backticks: [name, default cell]. */
function readmeInputs(md: string): [string, string][] {
  return [...md.matchAll(/^\| `([a-z_]+)` \| ([^|]*) \|/gm)].map((m) => [m[1], m[2].trim()]);
}

/** How the README shows a default: `value`, *required*, or — for an empty default. */
const shown = (def: string | undefined) => (def === undefined ? '*required*' : def === '' ? '—' : `\`${def}\``);

describe('README', () => {
  it('repeats the quick start verbatim', () => {
    expect(readme).toContain(TOKEN_HELP);
    expect(readme).toContain(WORKFLOW_PATH);
    expect(readme).toContain(workflowYaml(DEFAULT_SETUP));
    expect(readme).toContain(readmeSnippet(DEFAULT_SETUP));
  });

  it('inputs table has every action.yml input, in order, with the same default', () => {
    const inputs = actionInputs(actionYml);
    expect(inputs.map(([name]) => name)).toEqual([
      'token',
      'theme',
      'cards',
      'exclude_repos',
      'exclude_langs',
      'include_forks',
      'include_private',
      'output_dir',
      'telemetry',
    ]);
    expect(readmeInputs(readme)).toEqual(inputs.map(([name, def]) => [name, shown(def)]));
  });

  it('preview images exist', () => {
    const srcs = [...readme.matchAll(/(?:src|srcset)="([^"]+)"/g)].map((m) => m[1]);
    const local = srcs.filter((s) => !/^https?:/.test(s) && !s.startsWith(`${DEFAULT_SETUP.outputDir}/`));
    expect(local).toEqual(expect.arrayContaining(['docs/logo.svg', 'test/__snapshots__/strip/strip-strip-dark.svg']));
    for (const path of local) expect(existsSync(new URL(path, root)), path).toBe(true);
  });

  it('previews every registered theme, light and dark', () => {
    for (const [name, theme] of Object.entries(THEMES)) {
      const previewed = theme.cards.filter(
        (card) =>
          readme.includes(`srcset="test/__snapshots__/${name}/${name}-${card}-dark.svg"`) &&
          readme.includes(`src="test/__snapshots__/${name}/${name}-${card}-light.svg"`),
      );
      expect(previewed.length, `README previews no card of theme ${name}`).toBeGreaterThan(0);
    }
  });

  it('calls the ping id pseudonymous, never anonymous or one-way on its own', () => {
    expect(readme).toContain('pseudonymous');
    expect(readme.replace(/pseudonymous, not anonymous/g, '')).not.toMatch(/anonymous|one-way/i);
  });

  it('shows the used-by badge from the same Worker the ping goes to (a placeholder while TELEMETRY_URL is empty)', () => {
    if (TELEMETRY_URL === '') {
      expect(readme).toContain('<!-- used-by badge: added after the Worker is deployed -->');
      return;
    }
    const badge = `${new URL(TELEMETRY_URL).origin}/badge`;
    expect(readme).toContain(`https://img.shields.io/endpoint?url=${encodeURIComponent(badge)}`);
  });
});
