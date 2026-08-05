'use client';

import React, { useEffect, useState } from 'react';

// Generated creatives are reviewed at thumbnail size, which is too small to
// judge the details that matter — stitching, print placement, hem lines. This
// overlays the full image so it can be checked against the source photo.
interface ImageLightboxProps {
  src: string;
  alt: string;
  caption?: string;
  onClose: () => void;
}

export default function ImageLightbox({ src, alt, caption, onClose }: ImageLightboxProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // The wizard modal behind this scrolls otherwise, losing the user's place.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3000,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        cursor: 'zoom-out',
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        style={{
          position: 'absolute', top: 16, right: 20,
          width: 34, height: 34, borderRadius: '50%',
          border: 'none', background: 'rgba(255,255,255,0.15)',
          color: 'white', fontSize: 20, lineHeight: '32px',
          cursor: 'pointer',
        }}
      >
        ×
      </button>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '100%',
          maxHeight: caption ? 'calc(100vh - 110px)' : 'calc(100vh - 60px)',
          objectFit: 'contain',
          borderRadius: 6,
          cursor: 'default',
        }}
      />

      {caption && (
        <div style={{
          marginTop: 12, color: 'rgba(255,255,255,0.85)',
          fontSize: 12, fontWeight: 600, letterSpacing: '0.02em',
          textTransform: 'capitalize', textAlign: 'center',
        }}>
          {caption}
        </div>
      )}
    </div>
  );
}

// Overlay control. Stops propagation so opening the preview never also triggers
// the surrounding tile's click (selection, reuse, open-detail, …).
export function ZoomButton({
  onClick,
  size = 26,
}: {
  onClick: () => void;
  size?: number;
}) {
  const icon = Math.round(size * 0.5);
  return (
    <button
      type="button"
      aria-label="View larger"
      title="View larger"
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClick(); }}
      style={{
        position: 'absolute', top: 5, right: 5,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, borderRadius: 6, padding: 0,
        border: 'none', background: 'rgba(0,0,0,0.55)', color: 'white',
        cursor: 'zoom-in', zIndex: 2,
      }}
    >
      <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    </button>
  );
}

// Drop-in replacement for an <img> that needs a full-size preview. Owns its own
// lightbox state so callers do not each have to track it.
export function ZoomableImage({
  src,
  alt,
  caption,
  style,
  buttonSize,
  className,
}: {
  src: string;
  alt: string;
  caption?: string;
  style?: React.CSSProperties;
  buttonSize?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!src) return null;

  return (
    <div style={{ position: 'relative', lineHeight: 0 }} className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} style={style} />
      <ZoomButton size={buttonSize} onClick={() => setOpen(true)} />
      {open && (
        <ImageLightbox
          src={src}
          alt={alt}
          caption={caption ?? alt}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
