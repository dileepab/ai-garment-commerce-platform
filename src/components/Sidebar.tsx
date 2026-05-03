'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  can,
  describeScope,
  getUserScopeFromSessionUser,
  ROLE_LABELS,
  type Permission,
} from '@/lib/access-control';

const NAV_ITEMS: {
  href: string;
  label: string;
  permission: Permission;
  icon: ReactNode;
}[] = [
  {
    href: '/',
    label: 'Dashboard',
    permission: 'dashboard:view',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
      </svg>
    ),
  },
  {
    href: '/products',
    label: 'Products',
    permission: 'products:view',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.57a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.57a2 2 0 00-1.34-2.23z"/>
      </svg>
    ),
  },
  {
    href: '/orders',
    label: 'Orders',
    permission: 'orders:view',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
        <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
      </svg>
    ),
  },
  {
    href: '/support',
    label: 'Support Inbox',
    permission: 'support:view',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
      </svg>
    ),
  },
  {
    href: '/returns',
    label: 'Returns',
    permission: 'returns:view',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
      </svg>
    ),
  },
  {
    href: '/production',
    label: 'Production',
    permission: 'production:view',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
        <path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/>
      </svg>
    ),
  },
  {
    href: '/analytics',
    label: 'Analytics',
    permission: 'analytics:view',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10"/>
        <line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6" y1="20" x2="6" y2="14"/>
        <line x1="3" y1="20" x2="21" y2="20"/>
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    permission: 'settings:view',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 005 15.08a1.65 1.65 0 00-1.51-1H3.4a2 2 0 010-4h.09A1.65 1.65 0 005 8.57a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009.32 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 8.6a1.65 1.65 0 001.51 1h.09a2 2 0 010 4h-.09A1.65 1.65 0 0019.4 15z"/>
      </svg>
    ),
  },
  {
    href: '/operators',
    label: 'Operators',
    permission: 'operators:view',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
    ),
  },
];

export default function Sidebar({ isOpen, onClose }: { isOpen?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const scope = session?.user ? getUserScopeFromSessionUser(session.user) : null;
  const visibleItems = scope
    ? NAV_ITEMS.filter((item) => can(scope.role, item.permission))
    : NAV_ITEMS;
  const displayName = session?.user?.name || session?.user?.email || 'GarmentOS';
  const initials = displayName
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'GA';

  const handleSignOut = () => {
    void signOut({ callbackUrl: '/login' });
  };

  return (
    <aside
      className={`sidebar-nav${isOpen ? ' open' : ''}`}
      style={{
        width: 220,
        flexShrink: 0,
        background: '#18160F',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 10px',
        minHeight: '100vh',
        zIndex: 200,
      }}
    >
      {/* Logo + mobile close button */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '4px 8px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.09)',
        marginBottom: 10,
      }}>
        <div style={{
          width: 28, height: 28, background: '#C4622D',
          borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.57a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.57a2 2 0 00-1.34-2.23z"/>
          </svg>
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', letterSpacing: '-0.02em' }}>
          Garment<span style={{ color: '#C4622D', fontWeight: 300 }}>OS</span>
        </div>
        <button className="sidebar-close-btn" onClick={onClose} aria-label="Close navigation">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1 }}>
        {visibleItems.map((item) => {
          const isActive = item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '8px 8px', borderRadius: 6,
                fontSize: 13, fontWeight: 500,
                color: isActive ? '#E8926A' : 'rgba(255,255,255,0.5)',
                background: isActive ? 'rgba(196,98,45,0.16)' : 'transparent',
                marginBottom: 1,
                textDecoration: 'none',
                transition: 'background 150ms, color 150ms',
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Divider */}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '10px 0' }} />

      {/* User section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 9,
          padding: 8, borderRadius: 7,
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: '#C4622D', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
          }}>
            {initials}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.8)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayName}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {scope ? `${ROLE_LABELS[scope.role]} · ${describeScope(scope)}` : 'Signed in'}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            width: '100%',
            border: '1px solid rgba(255,255,255,0.09)',
            background: 'rgba(255,255,255,0.04)',
            color: 'rgba(255,255,255,0.62)',
            borderRadius: 6,
            padding: '7px 8px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sign out
        </button>
      </div>
    </aside>
  );
}
