import { en } from './en';
import { zhCN } from './zh-CN';

/**
 * The selector page's languages: dictionaries, `{name}` placeholders, and which language a
 * visitor starts in. Pure, no DOM: tested in test/site-i18n.test.ts. site/i18n/dom.ts applies
 * the dictionary to index.html.
 */

export const LANGS = ['en', 'zh-CN'] as const;
export type Lang = (typeof LANGS)[number];

type En = typeof en;
export type Key = keyof En;
/** A translation: every key of `en`, so a missing one fails typecheck. */
export type Messages = Record<Key, string>;

export const MESSAGES: Record<Lang, Messages> = { en, 'zh-CN': zhCN };

/** The `{name}` placeholders of a message type: `'Found {repo} on {branch}'` → `'repo' | 'branch'`. */
export type Placeholders<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

/** The values a key's placeholders take, as `t`'s rest argument: none for a message without any. */
export type ParamArgs<K extends Key, V> = [Placeholders<En[K]>] extends [never]
  ? []
  : [params: Record<Placeholders<En[K]>, V>];

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/** A message's placeholder names, in order of appearance. */
export function placeholders(message: string): string[] {
  return [...message.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

/**
 * `message` split into text and the values of its placeholders, in order:
 * `format('Found {repo}.', { repo: node })` → `['Found ', node, '.']`. Numbers become text.
 * Throws on a placeholder without a value, which is a bug, not a visitor's mistake.
 */
export function format<T>(message: string, params: Readonly<Record<string, T | string | number>>): (T | string)[] {
  const out: (T | string)[] = [];
  let at = 0;
  for (const match of message.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (!Object.hasOwn(params, name)) throw new Error(`No value for {${name}} in "${message}"`);
    const value = params[name];
    if (match.index > at) out.push(message.slice(at, match.index));
    out.push(typeof value === 'number' ? String(value) : value);
    at = match.index + match[0].length;
  }
  if (at < message.length) out.push(message.slice(at));
  return out;
}

let current: Lang = 'en';

/** The language `t` (and site/i18n/dom.ts) use. */
export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
}

/** The current language's message for `key`, without filling it in. */
export function message(key: Key): string {
  return MESSAGES[current][key];
}

/** The current language's text for `key`, its placeholders filled in. */
export function t<K extends Key>(key: K, ...[params]: ParamArgs<K, string | number>): string {
  return format(message(key), params ?? {}).join('');
}

/** A language tag or `?lang=` value as a page language: `zh`, `zh-CN`, `zh-TW`… → zh-CN; `en*` → en; else null. */
export function toLang(value: string | null | undefined): Lang | null {
  const tag = value?.trim().toLowerCase() ?? '';
  if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-CN';
  if (tag === 'en' || tag.startsWith('en-')) return 'en';
  return null;
}

export interface LangSources {
  /** The page's query string (`location.search`): `?lang=` wins. */
  search: string;
  /** The language saved when the visitor last switched; null when none. */
  stored: string | null;
  /** `navigator.language`. */
  browser: string | undefined;
}

/**
 * The language a visit starts in: `?lang=`, else the saved choice, else Chinese for a browser
 * set to Chinese, else English. An unknown value is skipped, not an error.
 */
export function detectLang({ search, stored, browser }: LangSources): Lang {
  return toLang(new URLSearchParams(search).get('lang')) ?? toLang(stored) ?? (toLang(browser) === 'zh-CN' ? 'zh-CN' : 'en');
}

/**
 * `search` with `?lang=` set to `lang` when it is already there, so a reload keeps the
 * visitor's switch; otherwise unchanged, since the saved choice covers a reload. Other
 * parameters are kept in order and exactly as written, like `withoutLanding`.
 */
export function withLang(search: string, lang: Lang): string {
  let found = false;
  const pairs = search
    .replace(/^\?/, '')
    .split('&')
    .map((pair) => {
      const [name] = new URLSearchParams(pair).keys();
      if (name !== 'lang') return pair;
      found = true;
      return `lang=${lang}`;
    });
  return found ? `?${pairs.join('&')}` : search;
}
