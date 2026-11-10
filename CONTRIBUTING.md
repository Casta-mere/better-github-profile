# Contributing

Thanks for helping. The most welcome contribution is a new theme: [Add a theme](#add-a-theme) walks through one, and [`docs/theme-ideas/`](docs/theme-ideas/) has designs waiting to be built.

## Development

You need Node 24 or later.

```sh
npm ci                # install
npm test              # unit tests (Vitest)
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm run build         # bundle the Action into dist/index.js
npm run site:dev      # the selector page, with live reload
npm run site:build    # build the selector page into site/dist/
```

`dist/index.js` is committed, because the Action runs it directly. After changing anything under `src/`, run `npm run build` and commit `dist/` too: CI fails when `dist/` is out of date.

### The selector page is bilingual

The selector page (`site/`) is in English and Simplified Chinese. Every piece of text a visitor reads lives in [`site/i18n/en.ts`](site/i18n/en.ts), the source of truth, and [`site/i18n/zh-CN.ts`](site/i18n/zh-CN.ts).

- A change that adds or edits UI text updates **both** dictionaries, the Chinese in natural Simplified Chinese.
- Never hard-code text in `site/index.html` or `site/main.ts`: markup uses `data-i18n` (and `data-i18n-attr` for attributes), and code calls `t()`.
- Some things stay in English in both languages: the generated workflow YAML and README snippet, file names, `STATS_TOKEN`, GitHub's own button names (such as **Run workflow**), and theme and card names.
- [`test/site-i18n.test.ts`](test/site-i18n.test.ts) fails when a key is missing in one language or its placeholders differ.

### The Worker

The Worker in [`worker/`](worker/) has its own packages and tests:

```sh
cd worker
npm ci
npm test
npm run typecheck
```

CI tests it, but nothing deploys it automatically: the owner deploys it by hand with `npx wrangler deploy` from `worker/`. Its secrets and its D1 table are set up by hand too, as [`worker/wrangler.toml`](worker/wrangler.toml) describes. Merging to `main` publishes the selector page right away, so a site change that calls a new or changed Worker route needs that Worker deployed **before** it merges.

### Layout

| Path | What it is |
| --- | --- |
| `src/action/` | The Action: reads the inputs, runs the steps, writes and commits the files. |
| `src/collect/` | Fetches the data from GitHub's GraphQL API and builds the snapshot. |
| `src/guard/` | Decides whether a new snapshot is plausible enough to replace the last good one. |
| `src/snapshot/` | The snapshot type, `Snapshot`, and its validation. |
| `src/render/` | Snapshot to SVG: the themes, and the helpers they share. |
| `src/snippets/` | The workflow and README snippets the selector page and the README show. |
| `site/` | The selector page, on GitHub Pages. |
| `worker/` | The Cloudflare Worker: the usage counter, the setup check's GitHub proxy and Sign in with GitHub. |
| `test/` | Tests and fixtures for everything except the Worker. |

## Add a theme

A theme is a folder plus one line in the registry. Typecheck, the tests, the Action's `theme` input and the selector page's previews pick it up from the registry; for now the selector's theme picker needs one more line (see [Preview](#7-preview)).

### 1. The folder

```
src/render/themes/<name>/
  index.ts      the theme: export const <name> = defineTheme('<name>', { ...cards })
  README.md     what it is, its cards, you as the author, and a preview
  mockup.html   optional: the design it was built from
```

The name is one lowercase word (`[a-z][a-z0-9]*`), and card names are lowercase too (`[a-z][a-z0-9-]*`): they become file names, `<theme>-<card>-<mode>.svg`. Both are identifiers, not UI text: they stay in English everywhere, in the `theme` and `cards` inputs, the file names and both languages of the selector page, so they need no translation. [`native`](src/render/themes/native/) and [`strip`](src/render/themes/strip/) are complete examples.

### 2. The registry

Import the theme in [`src/render/themes/index.ts`](src/render/themes/index.ts) and add its name to `registered`, in the order the selector should show it:

```ts
import { native } from './native';
import { strip } from './strip';
import { hello } from './hello';

const registered = { native, strip, hello };
```

`ThemeName` is derived from this object, and the types check that each key is its theme's own name.

### 3. The `Theme` interface

From [`src/render/theme.ts`](src/render/theme.ts):

```ts
interface Theme<Name extends string = string> {
  name: Name;
  cards: string[]; // in display order
  render(card: string, s: Snapshot, o: RenderOptions): string; // one SVG
}

interface RenderOptions {
  mode: 'light' | 'dark';
  staleAsOf?: string; // YYYY-MM-DD: show the stale marker
}
```

You don't implement it by hand: `defineTheme(name, renderers)` builds it from one function per card, `(s: Snapshot, o: RenderOptions) => string`, and the order of `renderers` is the card order. The data is [`Snapshot`](src/snapshot/types.ts): user, repository totals and the top public repositories, contribution totals, weekly contribution totals for the past year (usually 53 weeks, but don't assume a length), and languages by bytes.

A minimal theme, `src/render/themes/hello/index.ts`:

```ts
import type { Snapshot } from '../../../snapshot/types';
import { FONT_STACK, PRIMER } from '../../primer';
import { escapeXml, fmtInt, staleText, svgDoc } from '../../svg';
import { defineTheme, type RenderOptions } from '../../theme';

const W = 400;
const H = 60;

function badge(s: Snapshot, o: RenderOptions): string {
  const p = PRIMER[o.mode];
  const who = s.user.name?.trim() ? s.user.name : s.user.login;
  const body = [
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" fill="${p.card}" stroke="${p.bd}"/>`,
    `<text x="16" y="26">${escapeXml(who)}</text>`,
    `<text class="m" x="16" y="46">${fmtInt(s.contributions.allTime)} contributions</text>`,
  ];
  if (o.staleAsOf) body.push(`<text class="m" x="${W - 16}" y="46" text-anchor="end">${escapeXml(staleText(o.staleAsOf))}</text>`);
  return svgDoc({
    width: W,
    height: H,
    title: `${who}'s GitHub stats`,
    css: [`text{font-family:${FONT_STACK};font-size:13px;fill:${p.fg}}`, `.m{fill:${p.mut}}`],
    body,
  });
}

export const hello = defineTheme('hello', { badge });
```

### 4. Colors and helpers

- [`src/render/primer.ts`](src/render/primer.ts):
  - `PRIMER[mode]`: GitHub's Primer colors for light and dark. `fg` text, `mut` muted text, `bd` borders, `card` background, `acc` accent, `trk` empty track, `g1`–`g4` contribution greens, `gold`.
  - `FONT_STACK`: GitHub's system font stack.
  - `OTHER_COLOR`: the gray for "Other" and for languages without a color.
- [`src/render/svg.ts`](src/render/svg.ts):
  - `svgDoc`: the SVG document, with a fixed size, an accessible `<title>` and one `<style>`.
  - `escapeXml`: for every piece of text and every attribute value that comes from data.
  - `fmtInt` gives `2,383`, and `fmtPct` gives `42.2%`.
  - `num`: a coordinate as compact text (at most 2 decimals, never `-0`).
  - `textWidth` and `truncate`: SVG can't measure text, so these estimate widths for layouts that place things after text or have limited room.
  - `sparkline`: one bar per week.
  - `languageBar`: a segmented, rounded language bar.
  - `staleText`: the stale marker's text.
- [`src/render/languages.ts`](src/render/languages.ts): `topLanguages(s, n)` gives the top `n` languages plus "Other", in percent, rounded to one decimal. It returns `[]` when there are no bytes, so you never divide by zero.

### 5. Rules for a theme

The tests in [`test/render-themes.test.ts`](test/render-themes.test.ts) check most of these for every registered theme, every card, both modes and both fixtures.

- **Pure.** A card is a function of the snapshot and the options only: the same input gives the same SVG. No `node:*`, no `@actions/*`, no DOM (`document`, `window`), no `Date.now()` or `Math.random()`, and no writes to the snapshot. The renderer also runs in the browser on the selector page. ESLint and `test/render-purity.test.ts` check the imports.
- **Self-contained.** No external fonts, images or stylesheets: no `@import` or `@font-face`, and `href` and `url()` only point at `#id`s in the same SVG. Use `FONT_STACK` or another system font stack. No `<script>` and no event handlers: GitHub shows cards as images, which never run scripts. An animated theme uses CSS or SMIL.
- **Light and dark.** Every card is rendered once per mode. Take the colors from `PRIMER[o.mode]` (or your own pair of palettes), and don't use a `prefers-color-scheme` media query: the README's `<picture>` picks the file.
- **`en-US` numbers.** Use `fmtInt` and `fmtPct`, never `toLocaleString()` without a locale.
- **Escape all text.** Every name from the snapshot (user name, repository and language names) goes through `escapeXml`. `svgDoc` escapes the title. The tests render names containing `& < > "`.
- **Both fixtures render cleanly.** The full fixture ([`test/fixtures/snapshot-casta-mere.json`](test/fixtures/snapshot-casta-mere.json)) and the empty one, a new account with no repositories, no languages and all-zero weeks, must both give an SVG with no `NaN`, `Infinity`, `d=""` or negative size.
- **The stale marker.** When `o.staleAsOf` is set, every card shows `staleText(o.staleAsOf)`, and only then.
- **Unique ids.** Prefix ids with `bgp-<theme>-<card>-<mode>`, as the built-in themes do.
- **Public data only.** Use the snapshot as it is. It never holds private repository names, and a theme must not need them. A design that needs new data (see [the ideas that need a schema change](docs/theme-ideas/README.md#ideas-that-need-a-schema-change)) starts with an issue about the snapshot.

### 6. Tests and snapshots

```sh
npm test               # the generic tests run for your theme as soon as it is registered
npx vitest run -u      # rewrite the file snapshots after an intended change
```

- The first `npm test` writes your cards, rendered from the full fixture, to `test/__snapshots__/<name>/<name>-<card>-<mode>.svg`. Open them in a browser, check them, and commit them. Later runs fail when the output changes; after an intended change, rewrite them with `-u` and review the diff.
- For your layout's specifics (which number goes next to which label, what gets truncated), add `test/render-<name>.test.ts`, like [`test/render-native.test.ts`](test/render-native.test.ts). Assert on visible text with `texts()` from [`test/svg-text.ts`](test/svg-text.ts), not on raw SVG, where `21` can match a coordinate. `svgProblems()` from [`test/svg-check.ts`](test/svg-check.ts) lists what makes an SVG malformed or not self-contained.

### 7. Preview

```sh
npm run site:dev
```

The selector page renders the chosen theme's cards live from the registry, with the sample data in `site/sample-snapshot.json`, and reloads as you save. Its card checkboxes come from the registry too. The theme picker is still a hand-written list, though: add a radio button next to the others in the Theme group of [`site/index.html`](site/index.html):

```html
<label><input type="radio" name="theme" value="hello" data-control="theme" /><span>hello</span></label>
```

Its label is the theme's name, which stays in English in both languages, so it has no `data-i18n` and needs no dictionary entry. Any other text you add to the page about your theme, such as a description, goes in both `site/i18n/en.ts` and `site/i18n/zh-CN.ts` (see [The selector page is bilingual](#the-selector-page-is-bilingual)). A theme with wide cards, like `strip`, also needs the `wide` preview layout, which `site/main.ts` turns on for `strip` only.

The file snapshots under `test/__snapshots__/<name>/` are the exact output, at real size.

### 8. Docs and `dist/`

- Your theme's `README.md`: what it is, its cards, you as the author, and a `<picture>` preview of its file snapshots for light and dark.
- The [README](README.md#themes): add the theme with a preview of at least one card. `test/readme.test.ts` checks that every registered theme has one.
- The README's Inputs table and the `theme` input's description in `action.yml` name the themes: add yours.
- `npm run build`, then commit `dist/`.

### Checklist

- [ ] `src/render/themes/<name>/index.ts` and `README.md`, and the registry line
- [ ] A radio button for the theme in `site/index.html`
- [ ] `npm test`, `npm run lint`, `npm run typecheck` pass
- [ ] The file snapshots in `test/__snapshots__/<name>/` are committed and look right in light and dark
- [ ] The README previews the theme
- [ ] `npm run build` is run and `dist/` is committed
