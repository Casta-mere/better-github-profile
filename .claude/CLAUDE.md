# better-github-profile — AI Knowledge Base

All AI knowledge files are centralized in [`.agent/`](../.agent/) at the project root.

## Ground rules

- Never `git push` from an agent session. Task commits on worktree branches are fine;
  commits to `main` only after the owner confirms.
- The renderer is a pure function (snapshot JSON + theme + options → SVG string) with no
  DOM or Node-only dependency: the Action and the selector page run the same code.
- The snapshot JSON may be committed to public repos: never store private repository
  names in it, only aggregate counts.
- Never publish a card built from a failed or implausible fetch; keep the last good
  snapshot and mark the card stale.
