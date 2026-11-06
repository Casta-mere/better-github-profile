import type { Snapshot } from '../../../snapshot/types';
import { topLanguages } from '../../languages';
import { FONT_STACK, PRIMER, type Palette } from '../../primer';
import { escapeXml, fmtInt, languageBar, num, sparkline, staleText, svgDoc, textWidth, truncate } from '../../svg';
import { defineTheme, type RenderOptions } from '../../theme';

// Layout of option J in mockup.html: 820px wide, no card frame. Line 1 is a pill
// of stat sections divided by 1px rules; line 2 is a small sparkline and language bar.
const W = 820;
const SIZE = 12; // font size everywhere
const MARGIN_Y = 8;
const PILL_H = 30;
const PILL_PAD_X = 14;
const LABEL_DX = 1.6; // with the space before it: the mockup's 5px label margin
const LINE2_TOP = MARGIN_Y + PILL_H + 12;
const LINE2_H = 18;
const GAP = 12; // between the items of line 2
const MINI_W = 160; // sparkline and language bar width
const H = LINE2_TOP + LINE2_H + MARGIN_Y;

const css = (p: Palette) => [
  `text{font-family:${FONT_STACK};font-size:${SIZE}px;fill:${p.fg}}`,
  `.n{font-weight:700;font-variant-numeric:tabular-nums}`,
  `.m{fill:${p.mut}}`,
  `.wk{fill:${p.g3};opacity:.6}`,
];

const SPACE = textWidth(' ', SIZE);

/** A pill section: `<number> <label>`, or `★ <number>` when the label comes first. */
function section(x: number, base: number, value: string, label: string, labelFirst = false) {
  const n = escapeXml(value);
  const text = labelFirst
    ? `<text x="${num(x)}" y="${base}">${label} <tspan class="n">${n}</tspan></text>`
    : `<text x="${num(x)}" y="${base}"><tspan class="n">${n}</tspan> <tspan class="m" dx="${LABEL_DX}">${label}</tspan></text>`;
  const width = labelFirst
    ? textWidth(label, SIZE) + SPACE + textWidth(value, SIZE, true)
    : textWidth(value, SIZE, true) + SPACE + LABEL_DX + textWidth(label, SIZE);
  return { text, width };
}

function stripCard(s: Snapshot, o: RenderOptions): string {
  const p = PRIMER[o.mode];
  const body: string[] = [];

  // Line 1: the pill.
  const pillBase = MARGIN_Y + 19.5;
  const stats: [string, string, boolean?][] = [
    [fmtInt(s.contributions.allTime), 'contributions'],
    [fmtInt(s.contributions.pastYear), 'past year'],
    [fmtInt(s.repos.count), 'repos'],
    [fmtInt(s.repos.stars), '★', true],
    [fmtInt(s.user.followers), 'followers'],
  ];
  const texts: string[] = [];
  const rules: number[] = [];
  let x = 1; // inside the pill's left border
  stats.forEach(([value, label, labelFirst], i) => {
    const sec = section(x + PILL_PAD_X, pillBase, value, label, labelFirst);
    texts.push(sec.text);
    x += PILL_PAD_X + sec.width + PILL_PAD_X;
    if (i < stats.length - 1) {
      rules.push(x + 0.5);
      x += 1;
    }
  });
  const pillW = x + 1;
  body.push(
    `<rect x="0.5" y="${MARGIN_Y + 0.5}" width="${num(pillW - 1)}" height="${PILL_H - 1}" rx="${(PILL_H - 1) / 2}" fill="none" stroke="${p.bd}"/>`,
    ...rules.map((rx) => `<path d="M${num(rx)} ${MARGIN_Y + 1}v${PILL_H - 2}" stroke="${p.bd}"/>`),
    ...texts,
  );

  // Line 2: 52 wks ▁▃▅ langs ▬▬▬ HTML · Python · TypeScript ……… stale marker.
  const mid = LINE2_TOP + LINE2_H / 2;
  const base = mid + 4.5;
  let x2 = 0;
  body.push(`<text class="m" x="0" y="${base}">52 wks</text>`);
  x2 += textWidth('52 wks', SIZE) + GAP;
  body.push(...sparkline(s.calendar.weeks, { x: x2, y: LINE2_TOP, width: MINI_W, height: LINE2_H, gap: 1, cls: 'wk' }));
  x2 += MINI_W + GAP;
  body.push(`<text class="m" x="${num(x2)}" y="${base}">langs</text>`);
  x2 += textWidth('langs', SIZE) + GAP;
  body.push(
    ...languageBar(topLanguages(s, 4), {
      id: `bgp-strip-strip-${o.mode}`,
      x: x2,
      y: mid - 3,
      width: MINI_W,
      height: 6,
      gap: 0,
      opacity: 0.75,
      track: p.trk,
    }),
  );
  x2 += MINI_W + GAP;

  // The top 3 names (Other is always 4th, so never among them). When stale, the marker
  // takes the right end and names that would run into it are dropped, the last one cut.
  const marker = o.staleAsOf ? staleText(o.staleAsOf) : '';
  const room = (marker ? W - 1 - textWidth(marker, SIZE) - GAP : W) - x2;
  const names = topLanguages(s, 3)
    .slice(0, 3)
    .map((l) => l.name);
  while (names.length > 1 && textWidth(names.join(' · '), SIZE) > room) names.pop();
  if (names.length > 0)
    body.push(`<text class="m" x="${num(x2)}" y="${base}">${escapeXml(truncate(names.join(' · '), room, SIZE))}</text>`);
  if (marker) body.push(`<text class="m" x="${W - 1}" y="${base}" text-anchor="end">${escapeXml(marker)}</text>`);

  const who = s.user.name?.trim() ? s.user.name : s.user.login;
  return svgDoc({ width: W, height: H, title: `${who}'s GitHub stats`, css: css(p), body });
}

export const strip = defineTheme('strip', { strip: stripCard });
