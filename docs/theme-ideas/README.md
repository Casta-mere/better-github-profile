# Theme ideas

Designs from the v1 brainstorm that haven't been built yet, free for anyone to pick up. Each is an HTML mockup: open it in a browser to see it on GitHub's light and dark backgrounds. A theme draws the same design as an SVG string; [CONTRIBUTING.md](../../CONTRIBUTING.md#add-a-theme) shows how.

The mockups use the numbers of the public test fixture, [`test/fixtures/snapshot-casta-mere.json`](../../test/fixtures/snapshot-casta-mere.json), so a theme built from one can be compared with it directly. Where a mockup shows something the snapshot doesn't have, its page says what is invented.

| Idea | Name | Mockup | What it is | Data it needs |
| --- | --- | --- | --- | --- |
| B | Terminal / neofetch | [b-terminal.html](b-terminal.html) | One card styled like a shell running `gh stats`: key/value lines, a 26-week heat strip, languages as text bars. | The current snapshot is enough. |
| C | Bento dashboard | [c-bento.html](c-bento.html) | One wide card of bordered tiles: a big headline number, weekly bars, languages, top repositories. | The current snapshot is enough. |
| D | Frosted glass | [d-frosted-glass.html](d-frosted-glass.html) | Soft color blobs behind a blurred pane, in three columns: who you are, an activity curve, a language ring. | The current snapshot is enough. |
| E | Editorial / typographic | [e-editorial.html](e-editorial.html) | No icons or charts: a newspaper masthead, four big serif numbers and one generated sentence. | The current snapshot is enough. |
| F | "When I code" | [f-when-i-code.html](f-when-i-code.html) | A day-by-day calendar next to an hour-of-day punch card: habits rather than totals. | Commit counts by hour and weekday, and daily cells: **not in the snapshot**. |
| G | Language journey | [g-language-journey.html](g-language-journey.html) | A stream chart of the languages written each year since the account was created. | Language share per year: **not in the snapshot**. |
| H | RPG character sheet | [h-rpg-sheet.html](h-rpg-sheet.html) | You as a game character: a level from contributions, an XP bar, a class, languages as skill pips, badges. | The current snapshot is enough. |
| I | Animated | [i-animated.html](i-animated.html) | Text types itself out, numbers appear, the weekly bars grow in; plays once per view. | The current snapshot is enough. The animation must be CSS or SMIL inside the SVG, with no script. |
| K | Isometric skyline | [k-isometric-skyline.html](k-isometric-skyline.html) | The contribution calendar as a 3D city: each week a row of towers, one per day. | Daily calendar cells: **removed from the v1 schema**, which keeps weekly totals only. |

Ideas A and J were built: they are the [`native`](../../src/render/themes/native/) and [`strip`](../../src/render/themes/strip/) themes, and their mockups live in those folders.

## Ideas that need a schema change

F, G and K need data the snapshot (`src/snapshot/types.ts`) doesn't hold. Each needs a schema change first: new fields, collected in `src/collect/`, with `schemaVersion: 2`. The snapshot is committed to users' public repositories, so any new field must be an aggregate count, never a private repository name. Open an issue to agree on the fields before building the theme.

## Notes for every idea

- The rules in [CONTRIBUTING.md](../../CONTRIBUTING.md#rules-for-a-theme) apply: no external fonts or images, light and dark, `en-US` numbers, escaped text.
- A mockup is a starting point, not a spec: change what doesn't work as an SVG of fixed size.
- Where a mockup invents framing (H's level and class, F's punch card), the theme defines the rule, and its README says how it is computed.
- To take one, first check the open issues, then open one saying which idea you're building, so two people don't build the same theme.
