'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  {
    href: '/',
    label: 'Dashboard',
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
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.57a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.57a2 2 0 00-1.34-2.23z"/>
      </svg>
    ),
  },
  {
    href: '/orders',
    label: 'Orders',
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
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
      </svg>
    ),
  },
  {
    href: '/production',
    label: 'Production',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
        <path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/>
      </svg>
    ),
  },
  {
    href: '/operators',
    label: 'Operators',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        background: '#18160F',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 10px',
        minHeight: '100vh',
        position: 'sticky',
        top: 0,
        zIndex: 200,
      }}
    >
      {/* Logo */}
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
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1 }}>
        {NAV_ITEMS.map((item) => {
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
      <div style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: 8, borderRadius: 7,
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: '#C4622D', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
        }}>
          GA
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.8)', lineHeight: 1.3 }}>
            GarmentOS
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
            Admin
          </div>
        </div>
      </div>
    </aside>
  );
}
