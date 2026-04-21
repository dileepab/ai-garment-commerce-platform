import Link from 'next/link';
import prisma from '@/lib/prisma';
import { getOrderStageLabel } from '@/lib/order-status-display';
import {
  buildSupportContactLine,
  getSupportReasonLabel,
  hasDirectSupportContactConfigured,
  type SupportIssueReason,
} from '@/lib/customer-support';

export const dynamic = 'force-dynamic';

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en-LK', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}

function getStatusClass(status: string): string {
  switch (status) {
    case 'resolved':
      return 'app-chip app-chip-accent';
    case 'in_progress':
      return 'app-chip app-chip-warning';
    default:
      return 'app-chip app-chip-danger';
  }
}

export default async function SupportPage() {
  const supportContactConfigured = hasDirectSupportContactConfigured();
  const supportContactLine = buildSupportContactLine();
  const escalations = await prisma.supportEscalation.findMany({
    include: {
      customer: true,
      order: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  return (
    <main className="app-shell">
      <div className="app-container space-y-6">
        <div className="app-header">
          <div>
            <p className="app-kicker">Support Inbox</p>
            <h1 className="app-title">Escalated customer conversations</h1>
            <p className="app-subtitle">
              When the bot detects complaints, unclear requests, or asks for human help, the conversation summary is
              stored here so your team can follow up faster.
            </p>
          </div>
          <Link href="/" className="app-link">
            Back to Dashboard
          </Link>
        </div>

        <section
          className={`rounded-[26px] border px-6 py-5 ${
            supportContactConfigured
              ? 'border-emerald-200 bg-emerald-50/80'
              : 'border-amber-200 bg-amber-50/90'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--foreground-soft)]">
                Customer Handoff Contact
              </p>
              <p className="mt-3 text-base font-semibold text-slate-900">
                {supportContactConfigured
                  ? 'Customers will see this direct contact information during support handoff.'
                  : 'Customers will currently be asked to reply here and wait for a manual follow-up.'}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{supportContactLine}</p>
              {!supportContactConfigured ? (
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  Add `STORE_SUPPORT_PHONE` and/or `STORE_SUPPORT_WHATSAPP` in `.env` to enable direct phone or WhatsApp handoff.
                </p>
              ) : null}
            </div>
            <span className={`app-chip ${supportContactConfigured ? 'app-chip-accent' : 'app-chip-warning'}`}>
              {supportContactConfigured ? 'Configured' : 'Needs Setup'}
            </span>
          </div>
        </section>

        {escalations.length === 0 ? (
          <section className="app-panel px-6 py-12 text-center">
            <h2 className="text-2xl font-semibold text-slate-900">No escalations yet</h2>
            <p className="mt-3 text-sm text-[color:var(--foreground-soft)]">
              Customer handoff requests and complaints will appear here automatically.
            </p>
          </section>
        ) : (
          <section className="grid gap-5 lg:grid-cols-2">
            {escalations.map((escalation) => (
              <article key={escalation.id} className="app-card">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                        Escalation #{escalation.id}
                      </h2>
                      <span className={getStatusClass(escalation.status)}>{escalation.status}</span>
                    </div>
                    <p className="mt-2 text-sm text-[color:var(--foreground-soft)]">
                      Updated {formatDate(escalation.updatedAt)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[color:var(--background-strong)] px-4 py-3 text-right">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                      Reason
                    </p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {getSupportReasonLabel(escalation.reason as SupportIssueReason)}
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--background-strong)] px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                      Customer
                    </p>
                    <p className="mt-2 font-semibold text-slate-900">
                      {escalation.contactName || escalation.customer?.name || 'Unknown customer'}
                    </p>
                    <p className="mt-1 text-sm text-[color:var(--foreground-soft)]">
                      {escalation.contactPhone || escalation.customer?.phone || 'Phone not stored'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--background-strong)] px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                      Related order
                    </p>
                    <p className="mt-2 font-semibold text-slate-900">
                      {escalation.orderId ? `#${escalation.orderId}` : 'Not linked'}
                    </p>
                    <p className="mt-1 text-sm text-[color:var(--foreground-soft)]">
                      {escalation.order ? getOrderStageLabel(escalation.order.orderStatus) : 'No order status'}
                    </p>
                  </div>
                </div>

                <div className="mt-6 rounded-[22px] border border-[color:var(--border)] bg-white/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--foreground-soft)]">
                    Latest customer message
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-800">
                    {escalation.latestCustomerMessage || 'No message stored'}
                  </p>
                </div>

                <div className="mt-6 rounded-[22px] border border-[color:var(--border)] bg-[color:var(--background-strong)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--foreground-soft)]">
                    Summary
                  </p>
                  <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-800">
                    {escalation.summary}
                  </pre>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
