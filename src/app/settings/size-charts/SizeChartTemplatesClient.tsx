'use client';

import { useState, useTransition } from 'react';
import { SizeChartEditor } from '@/components/SizeChartEditor';
import {
  defaultTemplateChart,
  templateLabel,
  type SizeChartData,
} from '@/lib/size-chart-templates';
import type { SizeChartCategory } from '@/lib/size-charts';
import { resetSizeChartTemplateAction, saveSizeChartTemplateAction } from './actions';

export interface TemplateView {
  garmentType: SizeChartCategory;
  chart: SizeChartData;
  saved: boolean;
  updatedAt: string | null;
}

export interface SizeChartTemplatesClientProps {
  brand: string;
  templates: TemplateView[];
  canManage: boolean;
}

/**
 * The numbers every new product of a garment type starts from.
 *
 * Editing one here does not touch products that already exist: their charts
 * were copied at creation and may since have been corrected against a finished
 * sample. This screen sets what the next product inherits.
 */
export function SizeChartTemplatesClient({ brand, templates, canManage }: SizeChartTemplatesClientProps) {
  const [selectedType, setSelectedType] = useState<SizeChartCategory>(templates[0].garmentType);
  const [drafts, setDrafts] = useState<Record<string, SizeChartData>>(() =>
    Object.fromEntries(templates.map((entry) => [entry.garmentType, entry.chart])),
  );
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const current = templates.find((entry) => entry.garmentType === selectedType)!;
  const draft = drafts[selectedType];

  function updateDraft(chart: SizeChartData) {
    setDrafts((previous) => ({ ...previous, [selectedType]: chart }));
    setMessage(null);
  }

  function save() {
    startTransition(async () => {
      const result = await saveSizeChartTemplateAction(brand, draft);
      setMessage(
        result.success
          ? { tone: 'ok', text: `Saved. New ${templateLabel(selectedType)} start from these numbers.` }
          : { tone: 'bad', text: result.error ?? 'Could not save the template.' },
      );
    });
  }

  function resetToDefaults() {
    startTransition(async () => {
      const result = await resetSizeChartTemplateAction(brand, selectedType);
      if (result.success) {
        updateDraft(defaultTemplateChart(selectedType));
        setMessage({ tone: 'ok', text: 'Back to the built-in defaults.' });
      } else {
        setMessage({ tone: 'bad', text: result.error ?? 'Could not reset the template.' });
      }
    });
  }

  const previewUrl = `/api/settings/size-chart-preview?brand=${encodeURIComponent(brand)}&type=${selectedType}`;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {templates.map((entry) => (
          <button
            key={entry.garmentType}
            type="button"
            onClick={() => {
              setSelectedType(entry.garmentType);
              setMessage(null);
            }}
            className={entry.garmentType === selectedType ? 'btn btn-primary' : 'btn btn-secondary'}
            style={{ fontSize: 12 }}
          >
            {templateLabel(entry.garmentType)}
            {entry.saved ? '' : ' ·'}
          </button>
        ))}
      </div>

      <p className="app-muted" style={{ margin: 0, lineHeight: 1.5 }}>
        {current.saved
          ? `${brand}'s own numbers${current.updatedAt ? `, last edited ${current.updatedAt}` : ''}.`
          : 'Still the built-in defaults — marked with a dot above. Save to make them this brand’s own.'}{' '}
        Products already created keep the chart they were saved with.
      </p>

      <SizeChartEditor
        chart={draft}
        template={defaultTemplateChart(selectedType)}
        disabled={!canManage || isPending}
        editableSizes
        previewUrl={previewUrl}
        onChange={updateDraft}
      />

      {message && (
        <p
          className={message.tone === 'ok' ? 'app-chip app-chip-success' : 'app-chip app-chip-danger'}
          style={{ justifySelf: 'start', margin: 0 }}
        >
          {message.text}
        </p>
      )}

      {canManage && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={save} disabled={isPending}>
            {isPending ? 'Saving…' : 'Save template'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={resetToDefaults}
            disabled={isPending || !current.saved}
          >
            Reset to built-in defaults
          </button>
        </div>
      )}
    </div>
  );
}
