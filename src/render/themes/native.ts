import type { Snapshot } from '../../snapshot/types';
import { topLanguages } from '../languages';
import { FONT_STACK, PRIMER, type Palette } from '../primer';
import { escapeXml, fmtInt, fmtPct, languageBar, num, sparkline, staleText, svgDoc, textWidth, truncate } from '../svg';
import { defineTheme, type RenderOptions } from '../theme';

// Layout of option A in card-styles.html: 330px wide, 1px border, 6px radius,
// 18px / 20px padding. Vertical positions follow the mockup's CSS line boxes.
const W = 330;
const PAD_Y = 18;
const X0 = 1 + 20; // content left
const X1 = W - 1 - 20; // content right
const CW = X1 - X0; // content width, 288
const TOP = 1 + PAD_Y; // content top
const TITLE_BASE = TOP + 14; // 15px title in an 18px line box
const BODY_TOP = TOP + 18 + 12; // after the title and its 12px margin

const ROW_H = 23; // 12.5px text, 4px padding above and below
const ICON = 12; // octicon-style 16px glyphs drawn at 12px

const SPARK_H = 34;
const LEGEND_ROW = 14; // 12px text line box
const LEGEND_GAP_Y = 6;
const LEGEND_GAP_X = 12;
const LEGEND_COL = (CW - LEGEND_GAP_X) / 2;

// 16×16 stroked glyphs in the spirit of Octicons.
const ICONS = {
  star: 'M8 1.75l1.93 3.91 4.32.63-3.13 3.05.74 4.3L8 11.61l-3.86 2.03.74-4.3L1.75 6.29l4.32-.63z',
  fork:
    'M6.25 3.25a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 1 1 3.5 0M13.25 3.25a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 1 1 3.5 0' +
    'M9.75 12.75a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 1 1 3.5 0M4.5 5v1a1.5 1.5 0 0 0 1.5 1.5h4a1.5 1.5 0 0 0 1.5-1.5V5M8 7.5V11',
  commit: 'M10.75 8a2.75 2.75 0 1 1-5.5 0 2.75 2.75 0 1 1 5.5 0M1.25 8h4M10.75 8h4',
  clock: 'M14.25 8a6.25 6.25 0 1 1-12.5 0 6.25 6.25 0 1 1 12.5 0M8 4.5V8l2.25 1.5',
  repo: 'M3.25 13.25v-10a1.5 1.5 0 0 1 1.5-1.5h8v10h-8a1.5 1.5 0 0 0 0 3h8',
};

const css = (p: Palette) => [
  `text{font-family:${FONT_STACK}}`,
  `.t{font-size:15px;font-weight:600;fill:${p.acc}}`,
  `.h{font-size:15px;font-weight:600;fill:${p.fg}}`,
  `.l{font-size:12.5px;fill:${p.mut}}`,
  `.v{font-size:12.5px;font-weight:600;fill:${p.fg};font-variant-numeric:tabular-nums}`,
  `.c{font-size:10.5px;fill:${p.mut}}`,
  `.lg{font-size:12px;fill:${p.fg}}`,
  `.m{fill:${p.mut}}`,
  `.ic{fill:none;stroke:${p.mut};stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}`,
  `.wk{fill:${p.g3};opacity:.55}`,
];

/** Wraps a card body in the bordered frame; appends the stale line when needed. */
function card(o: RenderOptions, title: string, bodyBottom: number, body: string[]): string {
  const p = PRIMER[o.mode];
  let bottom = bodyBottom;
  const extra: string[] = [];
  if (o.staleAsOf) {
    extra.push(`<text class="c" x="${X1}" y="${num(bottom + 16)}" text-anchor="end">${escapeXml(staleText(o.staleAsOf))}</text>`);
    bottom += 19;
  }
  const height = bottom + PAD_Y + 1;
  return svgDoc({
    width: W,
    height,
    title,
    css: css(p),
    body: [
      `<rect x="0.5" y="0.5" width="${W - 1}" height="${num(height - 1)}" rx="5.5" fill="${p.card}" stroke="${p.bd}"/>`,
      ...body,
      ...extra,
    ],
  });
}

function overview(s: Snapshot, o: RenderOptions): string {
  const suffix = "'s GitHub Statistics";
  const name = s.user.name?.trim() ? s.user.name : s.user.login;
  const title = truncate(name, CW - textWidth(suffix, 15, true), 15, true) + suffix;

  const rows: [keyof typeof ICONS, string, number][] = [
    ['star', 'Stars', s.repos.stars],
    ['fork', 'Forks', s.repos.forks],
    ['commit', 'All-time contributions', s.contributions.allTime],
    ['clock', 'Contributions (past year)', s.contributions.pastYear],
    ['repo', 'Repositories', s.repos.count],
  ];
  const body = [`<text class="t" x="${X0}" y="${TITLE_BASE}">${escapeXml(title)}</text>`];
  rows.forEach(([icon, label, value], i) => {
    const top = BODY_TOP + i * ROW_H;
    const iconY = top + (ROW_H - ICON) / 2;
    body.push(
      `<path class="ic" transform="translate(${X0} ${num(iconY)}) scale(${ICON / 16})" d="${ICONS[icon]}"/>`,
      `<text class="l" x="${X0 + ICON + 6}" y="${top + 16}">${label}</text>`,
      `<text class="v" x="${X1}" y="${top + 16}" text-anchor="end">${fmtInt(value)}</text>`,
    );
  });

  const sparkTop = BODY_TOP + rows.length * ROW_H + 12;
  body.push(...sparkline(s.calendar.weeks, { x: X0, y: sparkTop, width: CW, height: SPARK_H, gap: 1.5, rx: 1, cls: 'wk' }));
  const capTop = sparkTop + SPARK_H + 4;
  body.push(`<text class="c" x="${X0 + CW / 2}" y="${capTop + 10}" text-anchor="middle">last 52 weeks</text>`);

  return card(o, title, capTop + 13, body);
}

function languages(s: Snapshot, o: RenderOptions): string {
  const p = PRIMER[o.mode];
  const slices = topLanguages(s, 5);
  const barTop = BODY_TOP; // the bar's 4px top margin collapses into the title's 12px
  const body = [
    `<text class="h" x="${X0}" y="${TITLE_BASE}">Languages</text>`,
    ...languageBar(slices, {
      id: `bgp-native-languages-${o.mode}`,
      x: X0,
      y: barTop,
      width: CW,
      height: 8,
      gap: 2,
      opacity: 0.75,
      track: p.trk,
    }),
  ];

  const legendTop = barTop + 8 + 12;
  slices.forEach((l, i) => {
    const x = X0 + (i % 2) * (LEGEND_COL + LEGEND_GAP_X);
    const base = legendTop + Math.floor(i / 2) * (LEGEND_ROW + LEGEND_GAP_Y) + 11;
    const pct = fmtPct(l.pct);
    const label = truncate(l.name, LEGEND_COL - 14 - textWidth(` ${pct}`, 12) - 1, 12);
    body.push(
      `<circle cx="${num(x + 4)}" cy="${num(base - 4)}" r="4" fill="${escapeXml(l.color)}" opacity="0.8"/>`,
      `<text class="lg" x="${num(x + 14)}" y="${num(base)}">${escapeXml(label)} <tspan class="m" dx="1">${pct}</tspan></text>`,
    );
  });
  if (slices.length === 0) body.push(`<text class="c" x="${X0}" y="${legendTop + 11}">No language data yet</text>`);

  const rows = Math.max(1, Math.ceil(slices.length / 2));
  return card(o, 'Languages', legendTop + rows * LEGEND_ROW + (rows - 1) * LEGEND_GAP_Y, body);
}

export const native = defineTheme('native', { overview, languages });
