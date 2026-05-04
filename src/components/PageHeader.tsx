'use client';

import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}

/**
 * Standard Page Header (Topbar) for GarmentOS platform.
 * Ensures visual consistency across all pages.
 */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="topbar">
      <div className="topbar-title-group">
        <h1 className="topbar-title">{title}</h1>
        {subtitle && (
          <div className="topbar-subtitle">
            {subtitle}
          </div>
        )}
      </div>
      {actions && (
        <div className="topbar-actions">
          {actions}
        </div>
      )}
    </header>
  );
}
