import { escapeXml } from '../render/index';
import { outputDirOf, selectedCards, type SetupConfig } from './workflow';

const ALT: Record<string, string> = {
  overview: 'GitHub stats',
  languages: 'Top languages',
  strip: 'GitHub stats',
};

/** Image alt text for Markdown: `[`, `]` and `\` would end or bend the `![...]`, so they get a backslash. */
export function escapeMarkdownAlt(alt: string): string {
  return alt.replace(/[[\]\\]/g, '\\$&');
}

/** A Markdown link destination: whitespace, parentheses and angle brackets are percent-encoded. */
function markdownUrl(path: string): string {
  // encodeURIComponent leaves ( and ) as they are.
  return path.replace(/[\s()<>]/g, (ch) => (ch === '(' ? '%28' : ch === ')' ? '%29' : encodeURIComponent(ch)));
}

/**
 * README markup, one block per card in theme order. Paths are `<repoPath>/<outputDir>/<file>`;
 * without `repoPath` they are relative, which works for the profile repo's own README.
 *
 * - `picture` (default): one `<picture>` that shows the dark file when the viewer prefers a
 *   dark color scheme.
 * - `markdown`: a light image then a dark image, which GitHub shows or hides by their
 *   `#gh-light-mode-only` / `#gh-dark-mode-only` fragments.
 */
export function readmeSnippet(c: SetupConfig, repoPath?: string): string {
  const base = [repoPath?.trim().replace(/\/+$/, ''), outputDirOf(c)].filter(Boolean).join('/');
  return selectedCards(c)
    .map((card) => {
      const alt = ALT[card] ?? 'GitHub stats';
      const path = (mode: 'light' | 'dark') => `${base}/${c.theme}-${card}-${mode}.svg`;
      if (c.readmeFormat === 'markdown') {
        const image = (mode: 'light' | 'dark') =>
          `![${escapeMarkdownAlt(alt)}](${markdownUrl(path(mode))}#gh-${mode}-mode-only)`;
        return [image('light'), image('dark')].join('\n');
      }
      return [
        '<picture>',
        `  <source media="(prefers-color-scheme: dark)" srcset="${escapeXml(path('dark'))}">`,
        `  <img alt="${escapeXml(alt)}" src="${escapeXml(path('light'))}">`,
        '</picture>',
      ].join('\n');
    })
    .join('\n')
    .concat('\n');
}
