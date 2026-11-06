const ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i;
const NAME = /^[A-Za-z_][\w:.-]*/;
const ATTR = /\s+([A-Za-z_][\w:.-]*)\s*=\s*("[^"]*"|'[^']*')/y;

/** Name and attributes of a start tag's inside (`svg width="1"`), or a problem. */
function parseTag(inner: string): { name: string; attrs: Map<string, string> } | string {
  const name = NAME.exec(inner)?.[0];
  if (!name) return `bad tag <${inner}>`;
  const attrs = new Map<string, string>();
  let i = name.length;
  for (;;) {
    ATTR.lastIndex = i;
    const m = ATTR.exec(inner);
    if (!m) break;
    if (attrs.has(m[1])) return `<${name}> repeats the attribute ${m[1]}`;
    attrs.set(m[1], m[2].slice(1, -1));
    i = ATTR.lastIndex;
  }
  if (inner.slice(i).trim() !== '') return `<${name}> has a malformed attribute near "${inner.slice(i).trim()}"`;
  return { name, attrs };
}

/**
 * Why `svg` is not a well-formed, self-contained SVG document; `[]` when it is. Checks
 * what a browser's XML parser rejects (unbalanced tags, a raw `<` or `&`, repeated
 * attributes) and what this project bans: scripts, event handlers, references to
 * anything outside the file (fonts, images, stylesheets), duplicate ids, and `url(#id)`
 * or `href="#id"` pointing at no element.
 */
export function svgProblems(svg: string): string[] {
  const problems: string[] = [];
  const stack: string[] = [];
  const ids = new Set<string>();
  const refs = new Set<string>();
  let roots = 0;

  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([^>]*)>|<([^>]*?)(\/?)>|<|[^<]+/g;
  for (const m of svg.matchAll(token)) {
    const [whole, close, open, selfClose] = m;
    if (whole.startsWith('<!--') || whole.startsWith('<?')) continue;
    if (close !== undefined) {
      const name = close.trim();
      const top = stack.pop();
      if (top !== name) problems.push(`</${name}> closes <${top ?? 'nothing'}>`);
    } else if (open !== undefined) {
      const tag = parseTag(open);
      if (typeof tag === 'string') {
        problems.push(tag);
        continue;
      }
      if (stack.length === 0 && ++roots > 1) problems.push(`a second root element <${tag.name}>`);
      if (tag.name === 'script') problems.push('<script>');
      for (const [attr, value] of tag.attrs) {
        if (value.includes('<')) problems.push(`raw < in ${attr}="${value}"`);
        if (ENTITY.test(value)) problems.push(`raw & in ${attr}="${value}"`);
        if (/^on/i.test(attr)) problems.push(`event handler ${attr}`);
        if (attr === 'id') {
          if (ids.has(value)) problems.push(`duplicate id="${value}"`);
          ids.add(value);
        }
        if (/(^|:)href$/.test(attr)) {
          if (value.startsWith('#')) refs.add(value.slice(1));
          else problems.push(`external reference ${attr}="${value}"`);
        }
      }
      if (!selfClose) stack.push(tag.name);
    } else if (whole === '<') {
      problems.push('raw <');
    } else {
      if (stack.length === 0 && whole.trim() !== '') problems.push(`text outside the root: "${whole.trim()}"`);
      if (ENTITY.test(whole)) problems.push(`raw & in "${whole.trim().slice(0, 40)}"`);
    }
  }
  if (stack.length > 0) problems.push(`unclosed <${stack.join('>, <')}>`);

  for (const m of svg.matchAll(/url\(\s*['"]?([^)'"]*)/g)) {
    if (m[1].startsWith('#')) refs.add(m[1].slice(1));
    else problems.push(`external reference url(${m[1]})`);
  }
  if (/@import|@font-face/.test(svg)) problems.push('@import or @font-face: no external fonts or stylesheets');
  for (const ref of refs) if (!ids.has(ref)) problems.push(`#${ref} refers to no element`);
  return problems;
}
