'use client';

import React, { useState } from 'react';
import {
  columnsInGroup,
  unitLabel,
  type MeasurementGroup,
  type SizeChartData,
  type SizeChartUnit,
} from '@/lib/size-chart-templates';
import { sortSizes } from '@/lib/size-order';

/**
 * The grid a size chart is edited in, used both for a product's own chart and
 * for the brand template it is seeded from.
 *
 * It is laid out as the two blocks the customer sees, in the same order, so
 * what is typed here reads the same as what gets sent. A cell that differs from
 * the value it was seeded with is marked — the whole point of the product form
 * is spotting, at a glance, which measurements this piece actually changed.
 */

const BLOCKS: Array<{ group: MeasurementGroup; title: string; hint: string }> = [
  {
    group: 'body',
    title: 'Body measurements',
    hint: 'What the customer measures on themselves to pick a size.',
  },
  {
    group: 'garment',
    title: 'Garment measurements',
    hint: 'The piece itself, measured flat.',
  },
];

const cellInput: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm, 4px)',
  fontFamily: 'var(--font-ui)',
  fontSize: 12,
  background: 'var(--color-bg)',
  color: 'var(--color-fg-1)',
  outline: 'none',
  boxSizing: 'border-box',
  textAlign: 'right',
};

const headerCell: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: 'var(--color-fg-3)',
  paddingBottom: 2,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const noteStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-fg-3)',
  lineHeight: 1.5,
};

const smallButton: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: 11,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm, 4px)',
  background: 'transparent',
  color: 'var(--color-fg-2)',
  cursor: 'pointer',
};

export interface SizeChartEditorProps {
  chart: SizeChartData;
  /** What the chart was seeded from, for marking edits and for resetting. */
  template?: SizeChartData | null;
  disabled?: boolean;
  /** Link to the rendered chart, once there is something to render. */
  previewUrl?: string | null;
  /**
   * Template editing, where the rows are the brand's grading and adding "3XL"
   * is a real thing to want. A product's rows come from its variants instead,
   * so they are not editable here.
   */
  editableSizes?: boolean;
  onChange: (chart: SizeChartData) => void;
  onReset?: () => void;
}

export function SizeChartEditor({
  chart,
  template,
  disabled = false,
  previewUrl,
  editableSizes = false,
  onChange,
  onReset,
}: SizeChartEditorProps) {
  const [sizeDraft, setSizeDraft] = useState('');

  function setCell(size: string, columnKey: string, value: string) {
    onChange({
      ...chart,
      rows: chart.rows.map((row) =>
        row.size === size ? { ...row, values: { ...row.values, [columnKey]: value } } : row,
      ),
    });
  }

  function addSize() {
    const size = sizeDraft.trim();
    setSizeDraft('');
    if (!size) return;
    if (chart.rows.some((row) => row.size.toUpperCase() === size.toUpperCase())) return;

    const rows = [
      ...chart.rows,
      { size, values: Object.fromEntries(chart.columns.map((column) => [column.key, ''])) },
    ];
    const order = sortSizes(rows.map((row) => row.size));

    onChange({
      ...chart,
      rows: order
        .map((entry) => rows.find((row) => row.size === entry))
        .filter((row): row is (typeof rows)[number] => Boolean(row)),
    });
  }

  function removeSize(size: string) {
    onChange({ ...chart, rows: chart.rows.filter((row) => row.size !== size) });
  }

  function templateValue(size: string, columnKey: string): string {
    const row = template?.rows.find((entry) => entry.size === size);
    return (row?.values[columnKey] ?? '').trim();
  }

  const unit = unitLabel(chart.unit);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        <div
          style={{
            display: 'flex',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm, 4px)',
            overflow: 'hidden',
          }}
        >
          {(['in', 'cm'] as SizeChartUnit[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChange({ ...chart, unit: option })}
              disabled={disabled}
              style={{
                padding: '5px 12px',
                fontSize: 11,
                fontWeight: 700,
                border: 'none',
                cursor: disabled ? 'default' : 'pointer',
                background: chart.unit === option ? 'var(--color-fg-1)' : 'transparent',
                color: chart.unit === option ? 'var(--color-bg)' : 'var(--color-fg-3)',
              }}
            >
              {option}
            </button>
          ))}
        </div>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            disabled={disabled || !template}
            style={{ ...smallButton, cursor: disabled || !template ? 'default' : 'pointer' }}
          >
            Reset
          </button>
        )}
      </div>

      {BLOCKS.map((block) => {
        const columns = columnsInGroup(chart, block.group);
        if (columns.length === 0) return null;

        return (
          <div key={block.group} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-fg-1)' }}>{block.title}</div>
              <div style={noteStyle}>{block.hint}</div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <div
                style={{
                  minWidth: 96 + columns.length * 92 + (editableSizes ? 34 : 0),
                  display: 'grid',
                  gridTemplateColumns: `72px repeat(${columns.length}, minmax(84px, 1fr))${editableSizes ? ' 28px' : ''}`,
                  gap: 6,
                  alignItems: 'end',
                }}
              >
                <div style={headerCell}>Size</div>
                {columns.map((column) => (
                  <div key={column.key} style={headerCell} title={column.label}>
                    {column.kind === 'measure' ? `${column.label} (${unit})` : column.label}
                  </div>
                ))}
                {editableSizes && <div style={headerCell} />}

                {chart.rows.map((row) => (
                  <React.Fragment key={row.size}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: 'var(--color-fg-1)',
                        alignSelf: 'center',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {row.size}
                    </div>
                    {columns.map((column) => {
                      const value = row.values[column.key] ?? '';
                      const seeded = templateValue(row.size, column.key);
                      const edited = seeded !== '' && value.trim() !== seeded;

                      return (
                        <input
                          key={column.key}
                          style={{
                            ...cellInput,
                            borderColor: edited ? 'var(--color-accent, #8A6A3B)' : 'var(--color-border)',
                            fontWeight: edited ? 700 : 400,
                          }}
                          value={value}
                          inputMode={column.kind === 'measure' ? 'decimal' : 'text'}
                          placeholder={seeded || '—'}
                          onChange={(event) => setCell(row.size, column.key, event.target.value)}
                          disabled={disabled}
                          aria-label={`${row.size} ${column.label}`}
                        />
                      );
                    })}
                    {editableSizes && (
                      <button
                        type="button"
                        onClick={() => removeSize(row.size)}
                        disabled={disabled}
                        aria-label={`Remove ${row.size}`}
                        title={`Remove ${row.size}`}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--color-fg-3)',
                          cursor: disabled ? 'default' : 'pointer',
                          fontSize: 14,
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        );
      })}

      {editableSizes && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            style={{ ...cellInput, textAlign: 'left', width: 120 }}
            value={sizeDraft}
            onChange={(event) => setSizeDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addSize();
              }
            }}
            placeholder="Add a size…"
            disabled={disabled}
            aria-label="Add a size to the grading"
          />
          <button type="button" onClick={addSize} disabled={disabled} style={smallButton}>
            Add
          </button>
        </div>
      )}

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-fg-1)', marginBottom: 4 }}>
          How to measure
        </div>
        <textarea
          style={{ ...cellInput, textAlign: 'left', minHeight: 56, resize: 'vertical' }}
          value={chart.footerNote ?? ''}
          onChange={(event) => onChange({ ...chart, footerNote: event.target.value || null })}
          disabled={disabled}
          placeholder="Shown under the chart on the storefront and in chat."
        />
      </div>

      {previewUrl && (
        <a
          href={previewUrl}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 11, color: 'var(--color-fg-2)', textDecoration: 'underline' }}
        >
          Open the chart customers are sent ↗
        </a>
      )}
    </div>
  );
}
