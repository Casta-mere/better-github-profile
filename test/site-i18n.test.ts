import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { en } from '../site/i18n/en';
import {
  detectLang,
  format,
  getLang,
  LANGS,
  MESSAGES,
  placeholders,
  setLang,
  t,
  toLang,
  withLang,
  type Key,
} from '../site/i18n/index';
import { zhCN } from '../site/i18n/zh-CN';
import { applyControl } from '../site/state';
import { DEFAULT_SETUP } from '../src/snippets/index';

const KEYS = Object.keys(en) as Key[];
const sorted = (xs: string[]) => [...xs].sort();

describe('dictionaries', () => {
  it('zh-CN has every en key, and no other', () => {
    expect(sorted(Object.keys(zhCN))).toEqual(sorted(KEYS));
  });

  it.each(LANGS)('%s has no empty message', (lang) => {
    for (const key of KEYS) expect(MESSAGES[lang][key].trim(), key).not.toBe('');
  });

  it('placeholders match between languages', () => {
    for (const key of KEYS) expect(sorted(placeholders(zhCN[key])), key).toEqual(sorted(placeholders(en[key])));
  });

  it('a placeholder appears at most once per message, since an element can only be in one place', () => {
    for (const lang of LANGS) {
      for (const key of KEYS) {
        const names = placeholders(MESSAGES[lang][key]);
        expect(new Set(names).size, `${lang} ${key}`).toBe(names.length);
      }
    }
  });

  it('links GitHub Docs in Chinese for zh-CN: the same page', () => {
    const enUrl = new URL(en['step1b.docsHref']);
    const zhUrl = new URL(zhCN['step1b.docsHref']);
    expect(enUrl.origin).toBe('https://docs.github.com');
    expect(zhUrl.origin).toBe('https://docs.github.com');
    expect(enUrl.pathname.startsWith('/en/')).toBe(true);
    expect(zhUrl.pathname).toBe(enUrl.pathname.replace(/^\/en\//, '/zh/'));
  });

  it('keeps STATS_TOKEN and the scopes as they are spelled in Chinese text', () => {
    for (const word of ['STATS_TOKEN', 'read:user', 'repo']) expect(zhCN['step1.help']).toContain(word);
  });
});

describe('format', () => {
  it('splits a message into text and values, in order', () => {
    const node = { node: true };
    expect(format('a {x} b {y}.', { x: 1, y: node })).toEqual(['a ', '1', ' b ', node, '.']);
  });

  it('adds no empty text around placeholders', () => {
    expect(format('{a}{b}', { a: 'A', b: 'B' })).toEqual(['A', 'B']);
    expect(format('plain', {})).toEqual(['plain']);
  });

  it('throws on a placeholder without a value', () => {
    expect(() => format('Found {repo}', {})).toThrow(/\{repo\}/);
  });

  it('reads placeholder names in order', () => {
    expect(placeholders('{step1a} then {secret} ({step1c})')).toEqual(['step1a', 'secret', 'step1c']);
    expect(placeholders('none')).toEqual([]);
  });
});

describe('t', () => {
  afterEach(() => setLang('en'));

  it('fills in parameters in the current language', () => {
    expect(t('trouble.http', { status: 502 })).toBe('GitHub answered HTTP 502. Try again later.');
    setLang('zh-CN');
    expect(getLang()).toBe('zh-CN');
    expect(t('trouble.http', { status: 502 })).toBe('GitHub 返回了 HTTP 502，请稍后再试。');
    expect(t('check.at', { time: '14:03:22' })).toBe('检查于 14:03:22');
  });

  it('takes no parameters for a message without placeholders', () => {
    expect(t('copy.button')).toBe('Copy');
    setLang('zh-CN');
    expect(t('copy.button')).toBe('复制');
  });

  it('a missing parameter fails typecheck, and throws', () => {
    // @ts-expect-error: 'trouble.http' needs {status}
    expect(() => t('trouble.http')).toThrow(/\{status\}/);
    // @ts-expect-error: and only {status}
    expect(t('trouble.http', { status: 500, extra: 'x' })).toContain('500');
  });
});

describe('detectLang', () => {
  const zhBrowser = { search: '', stored: null, browser: 'zh-CN' };

  it('?lang= comes first', () => {
    expect(detectLang({ search: '?lang=zh-CN', stored: 'en', browser: 'en-US' })).toBe('zh-CN');
    expect(detectLang({ search: '?user=octocat&lang=en', stored: 'zh-CN', browser: 'zh-CN' })).toBe('en');
    expect(detectLang({ search: '?lang=zh', stored: null, browser: 'en-US' })).toBe('zh-CN');
  });

  it('then the saved choice', () => {
    expect(detectLang({ search: '', stored: 'zh-CN', browser: 'en-US' })).toBe('zh-CN');
    expect(detectLang({ ...zhBrowser, stored: 'en' })).toBe('en');
  });

  it('then the browser: zh* is Chinese', () => {
    expect(detectLang(zhBrowser)).toBe('zh-CN');
    for (const browser of ['zh', 'zh-TW', 'zh-Hans-SG', 'ZH-cn']) expect(detectLang({ ...zhBrowser, browser })).toBe('zh-CN');
  });

  it('otherwise English', () => {
    for (const browser of ['en-GB', 'fr-FR', 'ja', '', undefined]) {
      expect(detectLang({ search: '', stored: null, browser })).toBe('en');
    }
  });

  it('skips an unknown ?lang= or saved value', () => {
    expect(detectLang({ search: '?lang=fr', stored: 'zh-CN', browser: 'en-US' })).toBe('zh-CN');
    expect(detectLang({ search: '?lang=', stored: 'klingon', browser: 'zh-TW' })).toBe('zh-CN');
  });

  it('toLang reads language tags, not lookalikes', () => {
    expect(toLang('zh-CN')).toBe('zh-CN');
    expect(toLang(' EN ')).toBe('en');
    expect(toLang('english')).toBeNull();
    expect(toLang('zhx')).toBeNull();
    expect(toLang(null)).toBeNull();
  });
});

describe('withLang', () => {
  it('updates ?lang= when the URL has it, keeping the rest as written', () => {
    expect(withLang('?lang=en&x=a%20b', 'zh-CN')).toBe('?lang=zh-CN&x=a%20b');
    expect(withLang('?x=1&lang=zh-CN', 'en')).toBe('?x=1&lang=en');
  });

  it('leaves a URL without ?lang= alone: the saved choice covers a reload', () => {
    expect(withLang('', 'zh-CN')).toBe('');
    expect(withLang('?x=1', 'zh-CN')).toBe('?x=1');
  });
});

describe('exclude lists typed with a Chinese input method', () => {
  it('a full-width comma separates entries too', () => {
    expect(applyControl(DEFAULT_SETUP, 'excludeRepos', 'dotfiles，old-site, x').excludeRepos).toEqual(['dotfiles', 'old-site', 'x']);
  });
});

// --- index.html: keys, slots and the English the page shows before the script runs ---

interface HtmlElement {
  tag: string;
  attrs: Map<string, string>;
  children: (HtmlElement | string)[];
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const TOKEN =
  /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-z][\w-]*)\s*>|<([a-z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|[^<]+/gi;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"' };

function decode(text: string): string {
  return text.replace(/&(\w+);/g, (entity, name: string) => {
    if (!Object.hasOwn(ENTITIES, name)) throw new Error(`Write ${entity} as the character itself in index.html`);
    return ENTITIES[name]!;
  });
}

/** Enough of an HTML parser for index.html: elements, attributes and text. Throws on a mismatched close. */
function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { tag: '#root', attrs: new Map(), children: [] };
  const stack = [root];
  for (const [whole, close, open, attrs, selfClose] of html.matchAll(TOKEN)) {
    const parent = stack.at(-1)!;
    if (close) {
      const closed = stack.pop();
      if (closed?.tag !== close.toLowerCase()) throw new Error(`</${close}> closes <${closed?.tag}>`);
    } else if (open) {
      const node: HtmlElement = { tag: open.toLowerCase(), attrs: new Map(), children: [] };
      for (const [, name, a, b, c] of (attrs ?? '').matchAll(ATTR)) node.attrs.set(name!, decode(a ?? b ?? c ?? ''));
      parent.children.push(node);
      if (!selfClose && !VOID.has(node.tag)) stack.push(node);
    } else if (!whole.startsWith('<')) {
      parent.children.push(decode(whole));
    }
  }
  if (stack.length !== 1) throw new Error(`<${stack.at(-1)!.tag}> is never closed`);
  return root;
}

function* elements(node: HtmlElement): Generator<HtmlElement> {
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    yield child;
    yield* elements(child);
  }
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const isKey = (key: string): key is Key => Object.hasOwn(en, key);

const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const page = [...elements(parseHtml(html))];
const translated = page.filter((node) => node.attrs.has('data-i18n'));

describe('index.html', () => {
  it('marks text for translation', () => {
    expect(translated.length).toBeGreaterThan(50);
  });

  it('uses only keys that exist', () => {
    for (const node of translated) expect(isKey(node.attrs.get('data-i18n')!), node.attrs.get('data-i18n')).toBe(true);
  });

  it('a translated element holds only text and slots: anything else would be lost on a switch', () => {
    for (const node of translated) {
      for (const child of node.children) {
        if (typeof child !== 'string') expect(child.attrs.get('data-slot'), `<${child.tag}> in ${node.attrs.get('data-i18n')}`).toBeTruthy();
      }
    }
  });

  it('every slot is a placeholder of its message, and every placeholder has a slot', () => {
    for (const node of translated) {
      const key = node.attrs.get('data-i18n') as Key;
      const slots = node.children.flatMap((c) => (typeof c === 'string' ? [] : [c.attrs.get('data-slot')!]));
      expect(sorted(slots), key).toEqual(sorted(placeholders(en[key])));
    }
  });

  it('every slot sits in a translated element', () => {
    const slotted = new Set(translated.flatMap((node) => node.children.filter((c) => typeof c !== 'string')));
    for (const node of page) if (node.attrs.has('data-slot')) expect(slotted.has(node), node.attrs.get('data-slot')).toBe(true);
  });

  it('its English, shown before the script runs, is en.ts', () => {
    for (const node of translated) {
      const key = node.attrs.get('data-i18n') as Key;
      const text = node.children.map((c) => (typeof c === 'string' ? c : `{${c.attrs.get('data-slot')}}`)).join('');
      expect(squash(text), key).toBe(squash(en[key]));
    }
  });

  it('translated attributes use existing keys, and their English is en.ts', () => {
    const marked = page.filter((node) => node.attrs.has('data-i18n-attr'));
    expect(marked.length).toBeGreaterThan(5);
    for (const node of marked) {
      for (const pair of node.attrs.get('data-i18n-attr')!.split(/\s+/)) {
        const [attr, key] = pair.split(':') as [string, string];
        expect(isKey(key), pair).toBe(true);
        expect(node.attrs.get(attr), pair).toBe(en[key as Key]);
      }
    }
  });

  it('every en key is used by index.html or main.ts', () => {
    const main = readFileSync(new URL('../site/main.ts', import.meta.url), 'utf8');
    const used = new Set(translated.map((node) => node.attrs.get('data-i18n')!));
    for (const node of page) for (const pair of (node.attrs.get('data-i18n-attr') ?? '').split(/\s+/)) used.add(pair.split(':')[1] ?? '');
    for (const key of KEYS) expect(used.has(key) || main.includes(`'${key}'`), key).toBe(true);
  });
});
