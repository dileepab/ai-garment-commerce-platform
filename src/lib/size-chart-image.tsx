/**
 * A size chart drawn as a PNG.
 *
 * WhatsApp is where most of these are asked for, and a 6-row table sent as text
 * arrives as a wall of numbers on a phone. So the chart is rendered to an image
 * on demand — same data the storefront shows as a table, same brand palette the
 * hand-drawn PNGs used, but with this product's own measurements and only the
 * sizes it is made in.
 *
 * Laid out in flexbox only: the renderer is satori, which has no table, no
 * grid, and no float.
 */

import { ImageResponse } from 'next/og';
import {
  columnsInGroup,
  groupHasValues,
  unitLabel,
  type MeasurementGroup,
  type SizeChartColumn,
  type SizeChartData,
} from '@/lib/size-chart-templates';
import { brandDisplayName, sizeChartTheme, type SizeChartTheme } from '@/lib/size-chart-theme';

const WIDTH = 1000;
const PAGE_X = 40;
const HEADER_H = 140;
const RULE_H = 5;
const CONTENT_TOP = 30;
const CONTENT_BOTTOM = 28;
const BLOCK_TITLE_H = 42;
const TABLE_HEAD_H = 50;
const ROW_H = 48;
const BLOCK_GAP = 28;
const FOOTER_PAD = 24;
const FOOTER_LINE_H = 23;
const SIZE_COL_W = 132;

interface BlockSpec {
  group: MeasurementGroup;
  title: string;
  hint: string;
}

const BLOCKS: BlockSpec[] = [
  {
    group: 'body',
    title: 'Body measurements',
    hint: 'Measure yourself, then choose the nearest size',
  },
  {
    group: 'garment',
    title: 'Garment measurements',
    hint: 'This piece, measured flat',
  },
];

function visibleBlocks(chart: SizeChartData): BlockSpec[] {
  return BLOCKS.filter(
    (block) => columnsInGroup(chart, block.group).length > 0 && groupHasValues(chart, block.group),
  );
}

/** Roughly how many lines the footer note wraps to at 14px across the page. */
function footerLineCount(note: string): number {
  const perLine = 118;
  return Math.max(1, Math.ceil(note.length / perLine));
}

function chartHeight(chart: SizeChartData, note: string): number {
  const blocks = visibleBlocks(chart);
  const blocksHeight = blocks.reduce(
    (total) => total + BLOCK_TITLE_H + TABLE_HEAD_H + chart.rows.length * ROW_H,
    0,
  );
  const gaps = Math.max(0, blocks.length - 1) * BLOCK_GAP;
  const footer = FOOTER_PAD * 2 + footerLineCount(note) * FOOTER_LINE_H;

  return HEADER_H + RULE_H + CONTENT_TOP + blocksHeight + gaps + CONTENT_BOTTOM + footer;
}

function headerCell(column: SizeChartColumn, unit: string, theme: SizeChartTheme) {
  const showUnit = column.kind === 'measure';
  return (
    <div
      key={column.key}
      style={{
        display: 'flex',
        flex: 1,
        fontSize: 14,
        letterSpacing: '0.11em',
        textTransform: 'uppercase',
        color: theme.accent,
      }}
    >
      {showUnit ? `${column.label} (${unit})` : column.label}
    </div>
  );
}

function chartBlock(chart: SizeChartData, block: BlockSpec, theme: SizeChartTheme) {
  const columns = columnsInGroup(chart, block.group);
  const unit = unitLabel(chart.unit);

  return (
    <div key={block.group} style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', height: BLOCK_TITLE_H }}>
        <div
          style={{
            display: 'flex',
            fontSize: 15,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: theme.bodyFg,
          }}
        >
          {block.title}
        </div>
        <div style={{ display: 'flex', fontSize: 14, color: theme.mutedFg, marginLeft: 14 }}>
          {block.hint}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: TABLE_HEAD_H,
          paddingLeft: 16,
          paddingRight: 16,
          backgroundColor: theme.stripeBg,
          borderBottom: `2px solid ${theme.accent}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            width: SIZE_COL_W,
            fontSize: 14,
            letterSpacing: '0.11em',
            textTransform: 'uppercase',
            color: theme.accent,
          }}
        >
          Size
        </div>
        {columns.map((column) => headerCell(column, unit, theme))}
      </div>

      {chart.rows.map((row, index) => (
        <div
          key={row.size}
          style={{
            display: 'flex',
            alignItems: 'center',
            height: ROW_H,
            paddingLeft: 16,
            paddingRight: 16,
            backgroundColor: index % 2 === 1 ? theme.stripeBg : theme.pageBg,
            borderBottom: `1px solid ${theme.borderColor}`,
          }}
        >
          <div
            style={{
              display: 'flex',
              width: SIZE_COL_W,
              fontSize: 19,
              letterSpacing: '0.04em',
              color: theme.accent,
            }}
          >
            {row.size}
          </div>
          {columns.map((column) => (
            <div
              key={column.key}
              style={{ display: 'flex', flex: 1, fontSize: 18, color: theme.bodyFg }}
            >
              {(row.values[column.key] ?? '').trim() || '—'}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export interface SizeChartImageOptions {
  chart: SizeChartData;
  brand?: string | null;
  /** The product this chart belongs to, or the garment type for a template. */
  subtitle: string;
  /** Merged into the response, so a caller can set its own cache policy. */
  headers?: Record<string, string>;
}

const FALLBACK_NOTE =
  'Measure over light undergarments with the tape snug but not tight. Garment measurements are taken with the piece laid flat.';

export function renderSizeChartImage({ chart, brand, subtitle, headers }: SizeChartImageOptions): ImageResponse {
  const theme = sizeChartTheme(brand);
  const note = chart.footerNote?.trim() || FALLBACK_NOTE;
  const blocks = visibleBlocks(chart);
  const height = chartHeight(chart, note);

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: WIDTH,
          height,
          backgroundColor: theme.pageBg,
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            height: HEADER_H,
            paddingLeft: PAGE_X,
            paddingRight: PAGE_X,
            backgroundColor: theme.headerBg,
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: 40,
              letterSpacing: '0.14em',
              color: theme.headerFg,
            }}
          >
            {brandDisplayName(brand)}
          </div>
          <div style={{ display: 'flex', fontSize: 17, marginTop: 12, letterSpacing: '0.02em', color: theme.headerSubtleFg }}>
            {subtitle}
          </div>
        </div>

        <div style={{ display: 'flex', height: RULE_H, backgroundColor: theme.accent }} />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            paddingTop: CONTENT_TOP,
            paddingBottom: CONTENT_BOTTOM,
            paddingLeft: PAGE_X,
            paddingRight: PAGE_X,
          }}
        >
          {blocks.map((block, index) => (
            <div
              key={block.group}
              style={{ display: 'flex', width: '100%', marginTop: index === 0 ? 0 : BLOCK_GAP }}
            >
              {chartBlock(chart, block, theme)}
            </div>
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            flexGrow: 1,
            alignItems: 'center',
            paddingLeft: PAGE_X,
            paddingRight: PAGE_X,
            backgroundColor: theme.footerBg,
            borderTop: `1px solid ${theme.borderColor}`,
          }}
        >
          <div style={{ display: 'flex', fontSize: 14, lineHeight: 1.6, color: theme.mutedFg }}>
            {note}
          </div>
        </div>
      </div>
    ),
    { width: WIDTH, height, headers },
  );
}
