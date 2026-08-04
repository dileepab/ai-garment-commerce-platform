'use client';

import React, { useId, useState } from 'react';
import type { ViewAngle } from '@/lib/creative-generator';
import { resizeImageFile } from '@/lib/image-resize';
import { uploadCreativeReference, type ReferenceImageInput } from './actions';

export const REFERENCE_ANGLES: { id: ViewAngle; label: string; hint: string }[] = [
  { id: 'front', label: 'Front', hint: 'Required — the main garment photo.' },
  { id: 'side', label: 'Side', hint: 'Prevents invented side slits and seams.' },
  { id: 'back', label: 'Back', hint: 'Without it the back is guessed.' },
  { id: 'closeup', label: 'Detail', hint: 'Fabric, print, buttons, stitching.' },
];

// One photo per angle. Undefined means that angle was never photographed, so
// the image model has to invent it.
export type ReferenceSet = Partial<Record<ViewAngle, string>>;

export function referenceSetToInputs(references: ReferenceSet): ReferenceImageInput[] {
  return REFERENCE_ANGLES
    .filter(angle => references[angle.id]?.trim())
    .map(angle => ({ url: references[angle.id]!.trim(), angle: angle.id }));
}

export function hasAnyReference(references: ReferenceSet): boolean {
  return referenceSetToInputs(references).length > 0;
}

// An angle is grounded when it was photographed. A close-up is a crop of the
// front surface, so a front photo grounds it too — matching resolveReferences
// in creative-generator.
export function isAngleGrounded(references: ReferenceSet, angle: ViewAngle): boolean {
  if (references[angle]?.trim()) return true;
  return angle === 'closeup' && Boolean(references.front?.trim());
}

export function inferredAngles(references: ReferenceSet, requested: ViewAngle[]): ViewAngle[] {
  return requested.filter(angle => !isAngleGrounded(references, angle));
}

interface ReferenceImagePickerProps {
  references: ReferenceSet;
  onChange: (next: ReferenceSet) => void;
  disabled?: boolean;
  // Angles queued for generation — those without a photo are flagged.
  requestedAngles?: ViewAngle[];
  // Angles supplied by the linked product, shown as read-only provenance.
  lockedAngles?: ViewAngle[];
}

export default function ReferenceImagePicker({
  references,
  onChange,
  disabled = false,
  requestedAngles = [],
  lockedAngles = [],
}: ReferenceImagePickerProps) {
  const inputIdBase = useId();
  const [uploadingAngle, setUploadingAngle] = useState<ViewAngle | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFilePick(angle: ViewAngle, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-picking the same file
    if (!file) return;

    setUploadError(null);
    setUploadingAngle(angle);
    try {
      const resized = await resizeImageFile(file, { maxEdge: 2048, quality: 0.85 });
      const formData = new FormData();
      formData.append('file', resized);
      const res = await uploadCreativeReference(formData);
      if (res.success && res.url) {
        onChange({ ...references, [angle]: res.url });
      } else {
        setUploadError(res.error ?? 'Upload failed.');
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploadingAngle(null);
    }
  }

  function handleClear(angle: ViewAngle) {
    const next = { ...references };
    delete next[angle];
    onChange(next);
  }

  const missing = inferredAngles(references, requestedAngles);

  return (
    <div>
      <div className="grid-4-mobile2" style={{ gap: 8 }}>
        {REFERENCE_ANGLES.map(angle => {
          const url = references[angle.id];
          const isUploading = uploadingAngle === angle.id;
          const isLocked = lockedAngles.includes(angle.id);
          const isRequested = requestedAngles.includes(angle.id);
          const willBeInferred = isRequested && !isAngleGrounded(references, angle.id);
          const inputId = `${inputIdBase}-${angle.id}`;

          return (
            <div
              key={angle.id}
              style={{
                border: willBeInferred
                  ? '1px dashed var(--color-warning, #b45309)'
                  : url
                    ? '1px solid var(--color-accent)'
                    : '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                background: 'var(--color-bg)',
              }}
            >
              <div style={{ position: 'relative', width: '100%', aspectRatio: '4/5', background: 'var(--color-surface-muted)' }}>
                {url ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={`${angle.label} reference`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                    {!isLocked && (
                      <button
                        type="button"
                        onClick={() => !disabled && handleClear(angle.id)}
                        disabled={disabled}
                        aria-label={`Remove ${angle.label} reference`}
                        style={{
                          position: 'absolute', top: 4, right: 4,
                          width: 22, height: 22, lineHeight: '20px',
                          borderRadius: '50%', border: 'none',
                          background: 'rgba(0,0,0,0.6)', color: 'white',
                          fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer',
                        }}
                      >
                        ×
                      </button>
                    )}
                  </>
                ) : (
                  <label
                    htmlFor={disabled ? undefined : inputId}
                    style={{
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      width: '100%', height: '100%', gap: 4, padding: 6,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      color: 'var(--color-fg-3)', fontSize: 10, textAlign: 'center',
                    }}
                  >
                    <span style={{ fontSize: 18, lineHeight: 1 }}>{isUploading ? '…' : '+'}</span>
                    <span>{isUploading ? 'Uploading' : 'Upload'}</span>
                  </label>
                )}
              </div>

              <input
                id={inputId}
                type="file"
                accept="image/*"
                onChange={(e) => handleFilePick(angle.id, e)}
                disabled={disabled || isUploading}
                style={{ display: 'none' }}
              />

              <div style={{ padding: '5px 6px', background: 'var(--color-surface)' }}>
                <div style={{
                  fontSize: 11, fontWeight: 700,
                  color: url ? 'var(--color-accent)' : 'var(--color-fg-2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4,
                }}>
                  <span>{angle.label}</span>
                  {url && !isLocked && (
                    <label
                      htmlFor={disabled ? undefined : inputId}
                      style={{
                        fontSize: 9, fontWeight: 600, color: 'var(--color-fg-3)',
                        cursor: disabled ? 'not-allowed' : 'pointer', textDecoration: 'underline',
                      }}
                    >
                      Replace
                    </label>
                  )}
                  {isLocked && (
                    <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--color-fg-3)' }}>Product</span>
                  )}
                </div>
                <div style={{ fontSize: 9, lineHeight: 1.35, color: 'var(--color-fg-3)', marginTop: 2 }}>
                  {willBeInferred ? 'No photo — this angle will be guessed.' : angle.hint}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {uploadError && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-danger, #dc2626)' }}>
          {uploadError}
        </div>
      )}

      {missing.length > 0 && (
        <div style={{
          marginTop: 8, padding: '7px 9px', fontSize: 11, lineHeight: 1.5,
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-warning-subtle, rgba(180,83,9,0.08))',
          color: 'var(--color-warning, #b45309)',
        }}>
          No reference photo for <strong>{missing.join(', ')}</strong>. The model will invent{' '}
          {missing.length > 1 ? 'those views' : 'that view'}, which is where wrong seams, cuffs,
          and hems come from. Upload the matching {missing.length > 1 ? 'photos' : 'photo'} for
          an exact match.
        </div>
      )}
    </div>
  );
}
