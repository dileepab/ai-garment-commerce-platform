'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError('Invalid email or password.');
      setLoading(false);
    } else {
      router.push('/');
      router.refresh();
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--background)',
        padding: '24px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 400 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 44, height: 44, background: '#C4622D', borderRadius: 11,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.57a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.57a2 2 0 00-1.34-2.23z"/>
            </svg>
          </div>
          <h1 style={{
            fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em',
            color: 'var(--foreground)', lineHeight: 1.2,
          }}>
            Garment<span style={{ color: '#C4622D', fontWeight: 300 }}>OS</span>
          </h1>
          <p style={{ marginTop: 6, fontSize: 13, color: 'var(--foreground-soft)' }}>
            Sign in to your operations dashboard
          </p>
        </div>

        <div className="app-card" style={{ padding: 28 }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

            <div>
              <label
                htmlFor="email"
                style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--foreground)', marginBottom: 6 }}
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="app-input"
                placeholder="admin@example.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--foreground)', marginBottom: 6 }}
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="app-input"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)' }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="app-button-primary"
              style={{ width: '100%', justifyContent: 'center', padding: '10px 16px', fontSize: 14, opacity: loading ? 0.6 : 1 }}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>

          </form>
        </div>

      </div>
    </main>
  );
}
