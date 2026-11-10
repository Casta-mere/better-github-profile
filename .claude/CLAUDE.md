# better-github-profile — AI Knowledge Base

All AI knowledge files are centralized in [`.agent/`](../.agent/) at the project root.

## Ground rules

- Never `git push` without asking the owner first. When a feature is finished, ask
  whether to push it; push only after they say yes, and ask again for every push.
  Task commits on worktree branches are fine; commits to `main` only after the owner
  confirms.
- The renderer is a pure function (snapshot JSON + theme + options → SVG string) with no
  DOM or Node-only dependency: the Action and the selector page run the same code.
- The snapshot JSON may be committed to public repos: never store private repository
  names in it, only aggregate counts.
- Never publish a card built from a failed or implausible fetch; keep the last good
  snapshot and mark the card stale.
- The selector page (`site/`) is bilingual. Every piece of text a visitor reads lives in
  `site/i18n/en.ts` (the source of truth) and `site/i18n/zh-CN.ts`. Any UI change that
  adds or edits text updates **both**, in natural Simplified Chinese. Never hard-code
  text in `index.html` or `main.ts`: markup uses `data-i18n`, and code calls `t()`.
  Keep these in English in both languages: the generated workflow YAML and README
  snippet, file names, `STATS_TOKEN`, and GitHub's own button names (e.g.
  **Run workflow**). `test/site-i18n.test.ts` fails when a key is missing or its
  placeholders differ.
