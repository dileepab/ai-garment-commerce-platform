'use client';

import React, { useMemo, useState } from 'react';

interface SimulatorMessage {
  id: string;
  role: 'customer' | 'assistant' | 'system';
  text: string;
  language?: string | null;
  orderId?: number | null;
  imageUrls?: string[] | null;
  carouselProducts?: Array<{
    id: number;
    name: string;
    price: number;
    sizes: string;
    colors: string;
    imageUrl?: string;
  }> | null;
}

interface SimulatorResponse {
  success: boolean;
  reply?: string;
  silentReason?: 'support_handoff' | 'human_active' | null;
  error?: string;
  imageUrl?: string | null;
  imageUrls?: string[] | null;
  carouselProducts?: SimulatorMessage['carouselProducts'];
  orderId?: number | null;
  language?: string | null;
}

const SAMPLE_MESSAGES = [
  'Hi, what are the available items?',
  'මොනාවද තියන ඇදුම්',
  'COD thiyanawada?',
  'කුරුණෑගලට එවන්න දවස් කීයක් යයිද?',
  'I received a damaged item. I want a refund.',
  'Where is your shop located?',
  'கொழும்புக்கு வெளியே கிளைகள் உள்ளதா?',
];

export function ChatSimulatorClient({ brands }: { brands: string[] }) {
  const [brand, setBrand] = useState(brands[0] || '');
  const [channel, setChannel] = useState('messenger');
  const [senderId, setSenderId] = useState(() => `sim-${Date.now()}`);
  const [message, setMessage] = useState(SAMPLE_MESSAGES[0]);
  const [messages, setMessages] = useState<SimulatorMessage[]>([]);
  const [isSending, setIsSending] = useState(false);

  const hasTranscript = messages.length > 0;
  const transcriptSummary = useMemo(() => {
    const lastAssistant = [...messages].reverse().find((entry) => entry.role === 'assistant');
    if (!lastAssistant) return 'No bot reply yet';
    return `${lastAssistant.language || 'unknown'}${lastAssistant.orderId ? ` · ORD-${lastAssistant.orderId}` : ''}`;
  }, [messages]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const customerText = message.trim();
    if (!customerText || isSending) return;

    const customerMessage: SimulatorMessage = {
      id: `customer-${Date.now()}`,
      role: 'customer',
      text: customerText,
    };
    setMessages((current) => [...current, customerMessage]);
    setMessage('');
    setIsSending(true);

    try {
      const response = await fetch('/api/ai/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: customerText,
          senderId,
          channel,
          brand: brand || undefined,
        }),
      });
      const payload = (await response.json()) as SimulatorResponse;

      if (!response.ok || !payload.success) {
        setMessages((current) => [
          ...current,
          {
            id: `system-${Date.now()}`,
            role: 'system',
            text: payload.error || 'Simulator request failed.',
          },
        ]);
        return;
      }

      if (!payload.reply && payload.silentReason) {
        const text =
          payload.silentReason === 'human_active'
            ? 'No automated reply was sent because a support agent is active in this thread.'
            : 'No automated reply was sent because this sender is waiting for support handoff. Start a new test thread to test normal bot replies again.';

        setMessages((current) => [
          ...current,
          {
            id: `system-${Date.now()}`,
            role: 'system',
            text,
          },
        ]);
        return;
      }

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          text: payload.reply || '',
          language: payload.language,
          orderId: payload.orderId,
          imageUrls: payload.imageUrls || (payload.imageUrl ? [payload.imageUrl] : null),
          carouselProducts: payload.carouselProducts,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `system-${Date.now()}`,
          role: 'system',
          text: error instanceof Error ? error.message : 'Simulator request failed.',
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  function resetConversation() {
    setSenderId(`sim-${Date.now()}`);
    setMessages([]);
  }

  return (
    <div className="content" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
      <section className="app-panel" style={{ padding: 18, display: 'grid', gap: 14, alignSelf: 'start' }}>
        <div>
          <p className="app-section-label">Scenario</p>
          <h2 style={{ marginTop: 4, fontSize: 18, fontWeight: 800, color: 'var(--color-fg-1)' }}>Bot QA</h2>
          <p className="app-muted" style={{ marginTop: 4 }}>
            Test one conversation thread per sender ID, including language continuity and support handoff behavior.
          </p>
        </div>

        <label style={{ display: 'grid', gap: 6 }}>
          <span className="app-section-label">Brand</span>
          <select className="app-input" value={brand} onChange={(event) => setBrand(event.target.value)}>
            <option value="">Global / no brand</option>
            {brands.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span className="app-section-label">Channel</span>
          <select className="app-input" value={channel} onChange={(event) => setChannel(event.target.value)}>
            <option value="messenger">Messenger</option>
            <option value="instagram">Instagram</option>
            <option value="web">Web</option>
          </select>
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span className="app-section-label">Sender ID</span>
          <input className="app-input" value={senderId} onChange={(event) => setSenderId(event.target.value)} />
        </label>

        <div style={{ display: 'grid', gap: 6 }}>
          <span className="app-section-label">Quick prompts</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {SAMPLE_MESSAGES.map((sample) => (
              <button
                key={sample}
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: '5px 8px' }}
                onClick={() => setMessage(sample)}
              >
                {sample.length > 28 ? `${sample.slice(0, 28)}...` : sample}
              </button>
            ))}
          </div>
        </div>

        <button type="button" className="btn btn-secondary" onClick={resetConversation}>New test thread</button>
      </section>

      <section className="app-panel" style={{ display: 'grid', gridTemplateRows: 'auto minmax(320px, 1fr) auto', minHeight: 620 }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border-subtle)', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <p className="app-section-label">Transcript</p>
            <p className="app-muted" style={{ marginTop: 3 }}>{transcriptSummary}</p>
          </div>
          <span className="app-chip app-chip-neutral">{channel}</span>
        </div>

        <div style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!hasTranscript && (
            <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--color-fg-3)', fontSize: 13 }}>
              Send a customer message to preview the exact bot response.
            </div>
          )}
          {messages.map((entry) => (
            <div
              key={entry.id}
              style={{
                alignSelf: entry.role === 'customer' ? 'flex-end' : 'flex-start',
                maxWidth: '78%',
                display: 'grid',
                gap: 6,
              }}
            >
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  background:
                    entry.role === 'customer'
                      ? 'var(--color-navy)'
                      : entry.role === 'system'
                        ? 'var(--color-error-muted)'
                        : 'var(--color-bg)',
                  color:
                    entry.role === 'customer'
                      ? 'white'
                      : entry.role === 'system'
                        ? 'var(--color-error)'
                        : 'var(--color-fg-1)',
                  whiteSpace: 'pre-wrap',
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                {entry.text}
              </div>
              {entry.carouselProducts && entry.carouselProducts.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                  {entry.carouselProducts.slice(0, 6).map((product) => (
                    <div key={product.id} style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 7, overflow: 'hidden', background: 'var(--color-surface)' }}>
                      {product.imageUrl && (
                        <img src={product.imageUrl} alt={product.name} style={{ width: '100%', aspectRatio: '4 / 5', objectFit: 'cover' }} />
                      )}
                      <div style={{ padding: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 800 }}>{product.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-fg-3)', marginTop: 3 }}>Rs {product.price}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {entry.imageUrls && entry.imageUrls.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {entry.imageUrls.map((url) => (
                    <img key={url} src={url} alt="" style={{ width: 96, aspectRatio: '4 / 5', objectFit: 'cover', borderRadius: 7, border: '1px solid var(--color-border-subtle)' }} />
                  ))}
                </div>
              )}
            </div>
          ))}
          {isSending && <div className="app-muted">Bot is thinking...</div>}
        </div>

        <form onSubmit={sendMessage} style={{ padding: 14, borderTop: '1px solid var(--color-border-subtle)', display: 'grid', gap: 8 }}>
          <textarea
            className="app-textarea"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Type a customer message..."
            rows={3}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" type="submit" disabled={isSending || !message.trim()}>
              {isSending ? 'Sending...' : 'Send test'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
