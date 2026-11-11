import type { LanguageSlice } from './languages';

/** Escapes text and attribute values. `'` is left alone: no attribute here uses single quotes. */
export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** `2383` → `2,383`. */
export function fmtInt(n: number): string {
  return INT.format(n);
}

const UNITS = [
  { size: 1e3, suffix: 'k' },
  { size: 1e6, suffix: 'M' },
  { size: 1e9, suffix: 'B' },
] as const;

/**
 * A card number: below 1000 as is (`999`), otherwise in k / M / B with at most one
 * decimal, rounded half up, `.0` dropped: `2383` → `2.4k`, `12000` → `12k`,
 * `1250000` → `1.3M`. A value that rounds up to 1000 of a unit moves to the next one
 * (`999950` → `1M`).
 */
export function fmtCompact(n: number): string {
  if (n < 1000) return fmtInt(n);
  let i = n < 1e6 ? 0 : n < 1e9 ? 1 : 2;
  // Tenths of the unit, in integer arithmetic so halves round up exactly.
  let tenths = Math.floor((n * 10 + UNITS[i].size / 2) / UNITS[i].size);
  if (tenths >= 10000 && i < UNITS.length - 1) {
    i += 1;
    tenths = Math.floor((n * 10 + UNITS[i].size / 2) / UNITS[i].size);
  }
  const whole = Math.floor(tenths / 10);
  const frac = tenths % 10;
  return `${whole}${frac ? `.${frac}` : ''}${UNITS[i].suffix}`;
}

/** `42.2` → `42.2%`, always one decimal. */
export function fmtPct(p: number): string {
  return `${p.toFixed(1)}%`;
}

/** A coordinate as compact SVG text: at most 2 decimals, never `-0`. */
export function num(x: number): string {
  const r = Math.round(x * 100) / 100;
  return String(r === 0 ? 0 : r);
}

// Advance widths of ASCII 32..126 in Helvetica/Arial, per 1000 units of em. SVG can't
// measure text, so layouts that place things after a piece of text estimate its width.
// prettier-ignore
const ASCII_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // space../
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, // 0..9
  278, 278, 584, 584, 584, 556, 1015, // :..@
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, // A..M
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, // N..Z
  278, 278, 278, 469, 556, 333, // [..`
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, // a..m
  556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, // n..z
  334, 260, 334, 584, // {..~
];

/**
 * Estimated rendered width of `s` in px. Calibrated in Chrome on macOS against the
 * mockups: the system font's digits and lowercase match Helvetica within 1%. Bold letters
 * are wider, bold digits are not. A 2% margin keeps estimated layouts from overlapping.
 */
export function textWidth(s: string, size: number, bold = false): number {
  let em = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    let w: number;
    if (c >= 32 && c <= 126) w = ASCII_WIDTHS[c - 32] / 1000;
    else if (ch === '·') w = 0.278;
    else if (c < 0x2000) w = 0.6; // accented Latin, Greek, Cyrillic
    else w = 1; // symbols such as ★ (from a fallback font), CJK
    em += bold && /\p{L}/u.test(ch) ? w * 1.08 : w;
  }
  return em * size * 1.02;
}

/** Cuts `s` and appends `…` so that it fits in `max` px. */
export function truncate(s: string, max: number, size: number, bold = false): string {
  if (textWidth(s, size, bold) <= max) return s;
  const chars = [...s];
  while (chars.length > 0 && textWidth(`${chars.join('')}…`, size, bold) > max) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

/** The SVG document: fixed size, an accessible `<title>`, one `<style>` with no media query. */
export function svgDoc(o: { width: number; height: number; title: string; css: string[]; body: string[] }): string {
  const w = num(o.width);
  const h = num(o.height);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">`,
    `<title>${escapeXml(o.title)}</title>`,
    `<style>`,
    ...o.css,
    `</style>`,
    ...o.body,
    `</svg>`,
    '',
  ].join('\n');
}

/**
 * One bar per entry in `weeks`, bottom-aligned, height proportional to the week's total
 * and at least 1px, so an all-zero calendar still draws a flat line.
 */
export function sparkline(
  weeks: number[],
  box: { x: number; y: number; width: number; height: number; gap: number; rx?: number; cls: string },
): string[] {
  const n = weeks.length;
  if (n === 0) return [];
  const max = Math.max(0, ...weeks);
  const bw = Math.max(0, (box.width - box.gap * (n - 1)) / n);
  const rx = box.rx ? ` rx="${num(box.rx)}"` : '';
  return weeks.map((w, i) => {
    const h = Math.max(1, max > 0 ? (Math.max(0, w) / max) * box.height : 0);
    const x = box.x + i * (bw + box.gap);
    const y = box.y + box.height - h;
    return `<rect class="${box.cls}" x="${num(x)}" y="${num(y)}" width="${num(bw)}" height="${num(h)}"${rx}/>`;
  });
}

/**
 * Segmented language bar with rounded ends. Segments are `gap` px apart; widths share
 * what is left after the gaps, clamped to ≥ 0. Slices at 0.0% get no segment and no gap.
 * With no slices it draws just the empty track.
 */
export function languageBar(
  slices: LanguageSlice[],
  box: { id: string; x: number; y: number; width: number; height: number; gap: number; opacity: number; track: string },
): string[] {
  const r = box.height / 2;
  const frame = `x="${num(box.x)}" y="${num(box.y)}" width="${num(box.width)}" height="${num(box.height)}" rx="${num(r)}"`;
  const shown = slices.filter((l) => l.pct > 0);
  const sum = shown.reduce((a, l) => a + l.pct, 0);
  if (shown.length === 0 || sum <= 0) return [`<rect ${frame} fill="${box.track}"/>`];
  const avail = Math.max(0, box.width - box.gap * (shown.length - 1));
  let x = box.x;
  const segs = shown.map((l) => {
    const w = Math.max(0, (l.pct / sum) * avail);
    const rect = `<rect x="${num(x)}" y="${num(box.y)}" width="${num(w)}" height="${num(box.height)}" fill="${escapeXml(l.color)}"/>`;
    x += w + box.gap;
    return rect;
  });
  return [
    `<clipPath id="${box.id}"><rect ${frame}/></clipPath>`,
    `<g clip-path="url(#${box.id})" opacity="${box.opacity}">`,
    ...segs,
    `</g>`,
  ];
}

/** The muted `stale · data as of <date>` marker text. */
export function staleText(date: string): string {
  return `stale · data as of ${date}`;
}
