import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEMES } from '../src/render/index';

// src/render and src/snippets also run in the browser selector, so they must stay free of
// Node built-ins, @actions/* and the DOM. ESLint enforces the imports; this pins all four.
const ROOTS = ['src/render', 'src/snippets'];
const BANNED = ["from 'node:", 'from "node:', "import('node:", 'import("node:', '@actions/', 'document.', 'window.'];

const sources = ROOTS.filter((r) => existsSync(r)).flatMap((root) =>
  readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(root, f)),
);

describe('renderer purity', () => {
  it('finds the renderer sources', () => {
    expect(sources.some((f) => f.startsWith('src/render/'))).toBe(true);
  });

  it('covers every registered theme folder', () => {
    for (const name of Object.keys(THEMES)) expect(sources).toContain(join('src/render/themes', name, 'index.ts'));
  });

  it.each(sources)('%s uses no Node, @actions or DOM API', (file) => {
    const code = readFileSync(file, 'utf8');
    for (const banned of BANNED) expect(code, `${file} contains ${banned}`).not.toContain(banned);
  });
});
