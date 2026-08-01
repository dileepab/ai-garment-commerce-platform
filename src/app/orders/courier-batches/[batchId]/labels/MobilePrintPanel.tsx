'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { WaybillLabelData } from '@/lib/waybill-label';
import {
  DEFAULT_WAYBILL_DPI,
  WAYBILL_DPI_OPTIONS,
  renderWaybillPng,
  waybillFileName,
} from './waybill-image';

type Busy = { done: number; total: number; action: 'save' | 'share' } | null;

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function pause(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function MobilePrintPanel({
  batchId,
  labels,
}: {
  batchId: number;
  labels: WaybillLabelData[];
}) {
  const [selected, setSelected] = useState<number[]>(() => labels.map((label) => label.shipmentId));
  const [dpi, setDpi] = useState<number>(DEFAULT_WAYBILL_DPI);
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canShareFiles, setCanShareFiles] = useState(false);
  // Rendered PNGs keyed by `shipmentId:dpi`. Keeping them means a repeat tap is
  // instant, which matters on iOS where navigator.share() is refused once the
  // tap's user activation has expired.
  const rendered = useRef(new Map<string, File>());

  useEffect(() => {
    try {
      const probe = new File([new Uint8Array([0])], 'waybill.png', { type: 'image/png' });
      const supported =
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [probe] });
      setCanShareFiles(supported);
    } catch {
      setCanShareFiles(false);
    }
  }, []);

  const selectedLabels = useMemo(
    () => labels.filter((label) => selected.includes(label.shipmentId)),
    [labels, selected],
  );

  const toggle = (shipmentId: number) => {
    setSelected((current) =>
      current.includes(shipmentId)
        ? current.filter((id) => id !== shipmentId)
        : [...current, shipmentId],
    );
  };

  const renderAll = async (targets: WaybillLabelData[], action: 'save' | 'share') => {
    const files: File[] = [];

    for (const [index, label] of targets.entries()) {
      const key = `${label.shipmentId}:${dpi}`;
      const cached = rendered.current.get(key);
      if (cached) {
        files.push(cached);
        continue;
      }

      setBusy({ done: index, total: targets.length, action });
      const blob = await renderWaybillPng(label, dpi);
      const file = new File([blob], waybillFileName(label), { type: 'image/png' });
      rendered.current.set(key, file);
      files.push(file);
      // Yield to the browser so the progress counter can paint between labels.
      await pause(0);
    }

    return files;
  };

  const runSave = async (targets: WaybillLabelData[]) => {
    if (targets.length === 0) return;
    setError(null);
    setMessage(null);

    try {
      const files = await renderAll(targets, 'save');
      for (const [index, file] of files.entries()) {
        triggerDownload(file, file.name);
        // Browsers drop rapid-fire downloads; space them out.
        if (index < files.length - 1) await pause(350);
      }
      setMessage(
        files.length === 1
          ? `Saved ${files[0].name}. Open MarkLife → print from photos.`
          : `Saved ${files.length} waybill images. Open MarkLife → print from photos.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not build the waybill images.');
    } finally {
      setBusy(null);
    }
  };

  const runShare = async (targets: WaybillLabelData[]) => {
    if (targets.length === 0) return;
    setError(null);
    setMessage(null);

    try {
      const files = await renderAll(targets, 'share');
      if (typeof navigator.canShare !== 'function' || !navigator.canShare({ files })) {
        setBusy(null);
        await runSave(targets);
        return;
      }
      await navigator.share({
        files,
        title: `RoyalExpress batch #${batchId}`,
      });
      setMessage('Sent to the share sheet. Pick MarkLife, or save to Photos and print from the app.');
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        setMessage(null);
      } else if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
        // iOS refuses share() once the tap that started the render has expired.
        // The images are cached now, so a second tap opens the sheet instantly.
        setMessage('Images are ready — tap the same button again to open the share sheet.');
      } else {
        setError(cause instanceof Error ? cause.message : 'Could not share the waybill images.');
      }
    } finally {
      setBusy(null);
    }
  };

  const isBusy = busy !== null;
  const progressText = busy ? `Rendering ${busy.done + 1} of ${busy.total}…` : null;

  return (
    <section className="mobile-print" aria-labelledby="mobile-print-title">
      <header className="mobile-print-head">
        <div>
          <h2 id="mobile-print-title">Print from phone (MarkLife)</h2>
          <p>
            Saves each waybill as a 4×6in PNG at {dpi} dpi. Open the MarkLife app, choose image /
            album printing, and pick the saved file.
          </p>
        </div>
        <label className="dpi-picker">
          <span>Printer dpi</span>
          <select value={dpi} onChange={(event) => setDpi(Number(event.target.value))} disabled={isBusy}>
            {WAYBILL_DPI_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option} dpi
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="mobile-print-actions">
        {canShareFiles && (
          <button
            type="button"
            className="primary"
            onClick={() => runShare(selectedLabels)}
            disabled={isBusy || selectedLabels.length === 0}
          >
            Send {selectedLabels.length} to MarkLife
          </button>
        )}
        <button
          type="button"
          className={canShareFiles ? undefined : 'primary'}
          onClick={() => runSave(selectedLabels)}
          disabled={isBusy || selectedLabels.length === 0}
        >
          Save {selectedLabels.length} image{selectedLabels.length === 1 ? '' : 's'}
        </button>
        <button
          type="button"
          onClick={() => setSelected(labels.map((label) => label.shipmentId))}
          disabled={isBusy || selected.length === labels.length}
        >
          Select all
        </button>
        <button type="button" onClick={() => setSelected([])} disabled={isBusy || selected.length === 0}>
          Clear
        </button>
      </div>

      {progressText && <p className="mobile-print-status">{progressText}</p>}
      {message && !progressText && <p className="mobile-print-status success">{message}</p>}
      {error && <p className="mobile-print-status error">{error}</p>}

      <ul className="mobile-print-list">
        {labels.map((label) => (
          <li key={label.shipmentId}>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(label.shipmentId)}
                onChange={() => toggle(label.shipmentId)}
                disabled={isBusy}
              />
              <span className="waybill-id">{label.waybillId}</span>
              <span className="recipient">{label.recipientName}</span>
            </label>
            <div className="row-actions">
              {canShareFiles && (
                <button type="button" onClick={() => runShare([label])} disabled={isBusy}>
                  Send
                </button>
              )}
              <button type="button" onClick={() => runSave([label])} disabled={isBusy}>
                Save
              </button>
            </div>
          </li>
        ))}
      </ul>

      <style>{`
        .mobile-print {
          border: 1px solid #d1d5db;
          border-radius: 8px;
          margin-bottom: 16px;
          padding: 12px;
        }
        .mobile-print-head {
          align-items: flex-start;
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          justify-content: space-between;
        }
        .mobile-print h2 { font-size: 14px; font-weight: 700; margin: 0; }
        .mobile-print p { color: #6b7280; font-size: 12px; line-height: 1.4; margin: 4px 0 0; max-width: 52ch; }
        .dpi-picker { align-items: center; display: flex; font-size: 12px; gap: 6px; }
        .dpi-picker select {
          background: #fff;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 12px;
          padding: 6px 8px;
        }
        .mobile-print-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 12px;
        }
        .mobile-print button {
          background: #fff;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          color: #111827;
          cursor: pointer;
          font-size: 12px;
          min-height: 38px;
          padding: 8px 12px;
        }
        .mobile-print button.primary { background: #111827; border-color: #111827; color: #fff; }
        .mobile-print button:disabled { cursor: not-allowed; opacity: 0.5; }
        .mobile-print-status { font-size: 12px; margin: 10px 0 0; }
        .mobile-print-status.success { color: #166534; }
        .mobile-print-status.error { color: #b91c1c; }
        .mobile-print-list { display: grid; gap: 6px; list-style: none; margin: 12px 0 0; padding: 0; }
        .mobile-print-list li {
          align-items: center;
          border-top: 1px solid #eceef1;
          display: flex;
          gap: 8px;
          justify-content: space-between;
          padding-top: 6px;
        }
        .mobile-print-list label {
          align-items: center;
          cursor: pointer;
          display: flex;
          flex: 1;
          gap: 8px;
          min-width: 0;
        }
        .mobile-print-list input { height: 18px; width: 18px; }
        .waybill-id { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
        .recipient {
          color: #6b7280;
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .row-actions { display: flex; gap: 6px; }
        @media print {
          .mobile-print { display: none !important; }
        }
      `}</style>
    </section>
  );
}
