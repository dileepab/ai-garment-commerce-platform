'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { BRAND_QUERY_PARAM } from '@/lib/brand-context';

const STORAGE_KEY = 'garmentos.selectedBrand';

type BrandSwitcherProps = {
  availableBrands: string[];
  selectedBrand: string | null;
  allowAllBrands: boolean;
};

type BrandOption = { label: string; value: string | null };

export default function BrandSwitcher({
  availableBrands,
  selectedBrand,
  allowAllBrands,
}: BrandSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Ensure the active brand is always shown even if the available list is still
  // loading (owner/admin lists arrive asynchronously from /api/brands).
  const brands = useMemo(() => {
    const set = new Set(availableBrands);
    if (selectedBrand) set.add(selectedBrand);
    return Array.from(set);
  }, [availableBrands, selectedBrand]);

  const options = useMemo<BrandOption[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = (label: string) => !q || label.toLowerCase().includes(q);
    const list: BrandOption[] = [];
    if (allowAllBrands && matches('All Brands')) {
      list.push({ label: 'All Brands', value: null });
    }
    for (const brand of brands) {
      if (matches(brand)) list.push({ label: brand, value: brand });
    }
    return list;
  }, [brands, query, allowAllBrands]);

  const currentLabel = selectedBrand ?? 'All Brands';

  function applyBrand(value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(BRAND_QUERY_PARAM, value);
      try {
        window.localStorage.setItem(STORAGE_KEY, value);
      } catch {
        /* localStorage unavailable — URL still carries the selection */
      }
    } else {
      params.delete(BRAND_QUERY_PARAM);
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    setOpen(false);
    setQuery('');
  }

  // Restore the last selected brand on a fresh load (no `?brand=` in the URL),
  // but only once and only when it is still a brand the user may access.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    if (selectedBrand) {
      restoredRef.current = true;
      return;
    }
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (stored && availableBrands.includes(stored)) {
      restoredRef.current = true;
      const params = new URLSearchParams(searchParams.toString());
      params.set(BRAND_QUERY_PARAM, stored);
      router.replace(`${pathname}?${params.toString()}`);
    }
  }, [selectedBrand, availableBrands, pathname, searchParams, router]);

  // Close on outside click / Escape; focus the search box when opening.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.clearTimeout(focusTimer);
    };
  }, [open]);

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((h) => Math.min(h + 1, options.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[highlight];
      if (option) applyBrand(option.value);
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', padding: '0 8px 12px' }}>
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          setHighlight(0);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={currentLabel}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          border: '1px solid rgba(255,255,255,0.1)',
          background: open ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
          color: '#fff',
          borderRadius: 7,
          padding: '7px 9px',
          fontSize: 12.5,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'background 150ms',
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            background: selectedBrand ? '#C4622D' : 'rgba(255,255,255,0.18)',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            flex: 1,
            textAlign: 'left',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {currentLabel}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            opacity: 0.55,
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 150ms',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Select brand"
          style={{
            position: 'absolute',
            top: 'calc(100% - 4px)',
            left: 8,
            right: 8,
            background: '#211E16',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 9,
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
            padding: 6,
            zIndex: 300,
          }}
        >
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder="Search brands..."
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: 'rgba(0,0,0,0.25)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              color: '#fff',
              fontSize: 12.5,
              padding: '7px 9px',
              marginBottom: 5,
              outline: 'none',
            }}
          />

          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {options.length === 0 ? (
              <div style={{ padding: '8px 9px', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                No brands found
              </div>
            ) : (
              options.map((option, index) => {
                const isSelected =
                  option.value === selectedBrand ||
                  (option.value === null && selectedBrand === null);
                const isHighlighted = index === highlight;
                return (
                  <button
                    key={option.value ?? '__all__'}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => applyBrand(option.value)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      border: 'none',
                      background: isHighlighted ? 'rgba(196,98,45,0.18)' : 'transparent',
                      color: isSelected ? '#E8926A' : 'rgba(255,255,255,0.82)',
                      borderRadius: 6,
                      padding: '7px 9px',
                      fontSize: 12.5,
                      fontWeight: isSelected ? 600 : 500,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 4,
                        background:
                          option.value === null ? 'rgba(255,255,255,0.18)' : '#C4622D',
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {option.label}
                    </span>
                    {isSelected && (
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                );
              })
            )}
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 4px' }} />

          <Link
            href={
              selectedBrand
                ? `/settings?${BRAND_QUERY_PARAM}=${encodeURIComponent(selectedBrand)}`
                : '/settings'
            }
            onClick={() => setOpen(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 9px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              color: 'rgba(255,255,255,0.55)',
              textDecoration: 'none',
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            Manage brand settings
          </Link>
        </div>
      )}
    </div>
  );
}
