const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== '#') return ENTITIES[e] ?? m;
    return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  });

/**
 * The visible text of an SVG: the content of every `<text>` element in document order,
 * `<tspan>` contents joined, XML-unescaped, whitespace collapsed as SVG renders it.
 * Content assertions go through this, never a raw `svg.toContain('21')`, which can
 * match a coordinate.
 */
export function texts(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) =>
    unescapeXml(m[1].replace(/<[^>]*>/g, ''))
      .replace(/\s+/g, ' ')
      .trim(),
  );
}
