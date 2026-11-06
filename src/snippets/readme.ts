import { escapeXml } from '../render/index';
import { outputDirOf, selectedCards, type SetupConfig } from './workflow';

const ALT: Record<string, string> = {
  overview: 'GitHub stats',
  languages: 'Top languages',
  strip: 'GitHub stats',
};

/**
 * README markup: one `<picture>` per card, in theme order, showing the dark file when the
 * viewer prefers a dark color scheme. Paths are `<repoPath>/<outputDir>/<file>`; without
 * `repoPath` they are relative, which works for the profile repo's own README.
 */
export function readmeSnippet(c: SetupConfig, repoPath?: string): string {
  const base = [repoPath?.trim().replace(/\/+$/, ''), outputDirOf(c)].filter(Boolean).join('/');
  return selectedCards(c)
    .map((card) => {
      const file = (mode: string) => escapeXml(`${base}/${c.theme}-${card}-${mode}.svg`);
      return [
        '<picture>',
        `  <source media="(prefers-color-scheme: dark)" srcset="${file('dark')}">`,
        `  <img alt="${escapeXml(ALT[card] ?? 'GitHub stats')}" src="${file('light')}">`,
        '</picture>',
      ].join('\n');
    })
    .join('\n')
    .concat('\n');
}
