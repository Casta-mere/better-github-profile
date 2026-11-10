import { format, message, type Key, type ParamArgs } from './index';

/**
 * Puts the current language into the page's static markup:
 *
 * - `data-i18n="key"`: the element's content becomes the message. Its children with
 *   `data-slot="name"` fill the `{name}` placeholders, so they keep their identity (ids,
 *   listeners, hrefs, `hidden`) and stay put while the words around them change. GitHub's
 *   button names are slots without a key: they read the same in every language.
 * - `data-i18n-attr="attr:key attr:key"`: attributes such as `aria-label`, `title` or `href`.
 *
 * Run again on a language switch: nothing else on the page is touched, so the form keeps its state.
 */

/** Each element's slots, taken from the markup the first time it is translated. */
const slotsOf = new WeakMap<Element, Record<string, Element>>();

function slots(node: HTMLElement): Record<string, Element> {
  let found = slotsOf.get(node);
  if (found === undefined) {
    found = {};
    for (const child of node.children) {
      if (child instanceof HTMLElement && child.dataset.slot) found[child.dataset.slot] = child;
    }
    slotsOf.set(node, found);
  }
  return found;
}

/** Translates `node` itself, when it carries `data-i18n` or `data-i18n-attr`. */
export function translateElement(node: HTMLElement): void {
  const key = node.dataset.i18n;
  if (key) node.replaceChildren(...format<Element>(message(key as Key), slots(node)));
  for (const pair of (node.dataset.i18nAttr ?? '').split(/\s+/)) {
    const at = pair.indexOf(':');
    if (at > 0) node.setAttribute(pair.slice(0, at), message(pair.slice(at + 1) as Key));
  }
}

/** Translates every marked element in `root` (the whole page by default). */
export function translatePage(root: ParentNode = document): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n], [data-i18n-attr]')) translateElement(node);
}

/** Like `t`, but a placeholder may take an element: the text and nodes to append, in order. */
export function nodes<K extends Key>(key: K, ...[params]: ParamArgs<K, Node | string | number>): (Node | string)[] {
  return format<Node>(message(key), params ?? {});
}
