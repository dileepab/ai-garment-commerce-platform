'use client';

import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showSidebar = pathname !== '/login';
  const lockViewport = pathname.startsWith('/support');

  if (!showSidebar) {
    return <>{children}</>;
  }

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        height: lockViewport ? '100vh' : undefined,
        overflow: lockViewport ? 'hidden' : undefined,
      }}
    >
      <Sidebar />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflowX: 'hidden',
          overflowY: lockViewport ? 'hidden' : undefined,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {children}
      </div>
    </div>
  );
}
