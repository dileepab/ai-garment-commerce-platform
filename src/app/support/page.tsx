import Link from 'next/link';
import prisma from '@/lib/prisma';
import { normalizeConversationState } from '@/lib/conversation-state';
import { getOrderStageLabel } from '@/lib/order-status-display';
import {
  buildSupportContactLine,
  getSupportReasonLabel,
  hasDirectSupportContactConfigured,
  type SupportIssueReason,
} from '@/lib/customer-support';
import { getRuntimeWarnings } from '@/lib/runtime-config';
import {
  addSupportNoteAction,
  sendSupportReplyAction,
  updateEscalationWorkflowAction,
} from '@/app/support/actions';

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

function getConversationModeClass(mode: string): string {
  switch (mode) {
    case 'human_active':
      return 'app-chip app-chip-accent';
    case 'handoff_requested':
      return 'app-chip app-chip-warning';
    case 'resolved':
      return 'app-chip app-chip-neutral';
    default:
      return 'app-chip app-chip-danger';
  }
}

function formatTranscriptKey(senderId: string, channel: string): string {
  return `${channel}:${senderId}`;
}

function formatEscalationStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

function getOrderUnits(order?: {
  orderItems?: Array<{ quantity: number }>;
} | null): number {
  return order?.orderItems?.reduce((sum, item) => sum + item.quantity, 0) || 0;
}

export default async function SupportPage() {
  const supportContactConfigured = hasDirectSupportContactConfigured();
  const supportContactLine = buildSupportContactLine();
  const runtimeWarnings = getRuntimeWarnings();
  const escalations = await prisma.supportEscalation.findMany({
    include: {
      customer: true,
      order: {
        include: {
          orderItems: {
            include: {
              product: true,
            },
          },
        },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });
  const senderFilters = escalations.map((escalation) => ({
    senderId: escalation.senderId,
    channel: escalation.channel,
  }));
  const conversationStates = senderFilters.length
    ? await prisma.conversationState.findMany({
        where: {
          OR: senderFilters,
        },
        select: {
          senderId: true,
          channel: true,
          stateJson: true,
        },
      })
    : [];
  const relatedMessages = senderFilters.length
    ? await prisma.chatMessage.findMany({
        where: {
          OR: senderFilters,
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          senderId: true,
          channel: true,
          role: true,
          message: true,
          createdAt: true,
        },
      })
    : [];
  const transcriptByConversation = new Map<string, typeof relatedMessages>();

  for (const message of relatedMessages) {
    const key = formatTranscriptKey(message.senderId, message.channel);
    const existing = transcriptByConversation.get(key) || [];

    if (existing.length < 8) {
      existing.push(message);
      transcriptByConversation.set(key, existing);
    }
  }

  const conversationStateByConversation = new Map(
    conversationStates.map((record) => [
      formatTranscriptKey(record.senderId, record.channel),
      normalizeConversationState(JSON.parse(record.stateJson)),
    ])
  );

  const openEscalations = escalations.filter((escalation) => escalation.status !== 'resolved');
  const linkedOrders = escalations.filter((escalation) => escalation.orderId).length;

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

        <section className="grid gap-4 md:grid-cols-3">
          <div className="app-metric">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--foreground-soft)]">
              Open cases
            </p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{openEscalations.length}</p>
            <p className="mt-2 text-sm text-[color:var(--foreground-soft)]">
              Conversations still waiting for a real follow-up.
            </p>
          </div>
          <div className="app-metric">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--foreground-soft)]">
              Linked orders
            </p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{linkedOrders}</p>
            <p className="mt-2 text-sm text-[color:var(--foreground-soft)]">
              Escalations already tied to a specific order ID.
            </p>
          </div>
          <div className="app-metric">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--foreground-soft)]">
              Runtime readiness
            </p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{runtimeWarnings.length}</p>
            <p className="mt-2 text-sm text-[color:var(--foreground-soft)]">
              Config note(s) detected across Messenger, AI, or support handoff.
            </p>
          </div>
        </section>

        {runtimeWarnings.length > 0 ? (
          <section className="rounded-[26px] border border-amber-200 bg-amber-50/90 px-6 py-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--warning)]">
              Runtime Notes
            </p>
            <div className="mt-4 space-y-3">
              {runtimeWarnings.map((warning) => (
                <div key={warning.key} className="rounded-2xl border border-amber-200 bg-white/80 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">{warning.key}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-700">{warning.message}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {escalations.length === 0 ? (
          <section className="app-panel px-6 py-12 text-center">
            <h2 className="text-2xl font-semibold text-slate-900">No escalations yet</h2>
            <p className="mt-3 text-sm text-[color:var(--foreground-soft)]">
              Customer handoff requests and complaints will appear here automatically.
            </p>
          </section>
        ) : (
          <section className="grid gap-5 lg:grid-cols-2">
            {escalations.map((escalation) => {
              const transcriptKey = formatTranscriptKey(escalation.senderId, escalation.channel);
              const transcript = [...(transcriptByConversation.get(transcriptKey) || [])].reverse();
              const linkedOrder = escalation.order;

              return (
                <article key={escalation.id} className="app-card overflow-hidden">
                  <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                    <div>
                      <p className="app-section-label">Escalation Case</p>
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                          Escalation #{escalation.id}
                        </h2>
                        <span className={getStatusClass(escalation.status)}>
                          {formatEscalationStatusLabel(escalation.status)}
                        </span>
                        <span className="app-chip app-chip-neutral">{escalation.channel}</span>
                        <span
                          className={getConversationModeClass(
                            conversationStateByConversation.get(transcriptKey)?.supportMode || 'bot_active'
                          )}
                        >
                          {conversationStateByConversation.get(transcriptKey)?.supportMode || 'bot_active'}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-[color:var(--foreground-soft)]">
                        Updated {formatDate(escalation.updatedAt)}
                      </p>
                      <p className="mt-3 text-sm leading-6 text-slate-700">
                        Reason: {getSupportReasonLabel(escalation.reason as SupportIssueReason)}
                      </p>
                    </div>
                    <div className="app-warning-block w-full sm:min-w-[230px] sm:w-auto">
                      <p className="app-section-label">Current Workflow</p>
                      <p className="mt-3 text-lg font-semibold text-slate-900">
                        {conversationStateByConversation.get(transcriptKey)?.supportMode || 'bot_active'}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-700">
                        {escalation.status === 'resolved'
                          ? 'Bot can resume normal conversation on the next message.'
                          : escalation.status === 'in_progress'
                            ? 'A human is expected to continue the conversation.'
                            : 'Customer is waiting for the support team to respond.'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <div className="app-stat-strip">
                      <p className="app-section-label">
                        Customer
                      </p>
                      <p className="mt-3 font-semibold text-slate-900">
                        {escalation.contactName || escalation.customer?.name || 'Unknown customer'}
                      </p>
                      <p className="mt-1 text-sm text-[color:var(--foreground-soft)]">
                        {escalation.contactPhone || escalation.customer?.phone || 'Phone not stored'}
                      </p>
                    </div>
                    <div className="app-stat-strip">
                      <p className="app-section-label">
                        Related order
                      </p>
                      <p className="mt-3 font-semibold text-slate-900">
                        {escalation.orderId ? `#${escalation.orderId}` : 'Not linked'}
                      </p>
                      <p className="mt-1 text-sm text-[color:var(--foreground-soft)]">
                        {escalation.order ? getOrderStageLabel(escalation.order.orderStatus) : 'No order status'}
                      </p>
                      {escalation.orderId ? (
                        <Link href={`/orders#order-${escalation.orderId}`} className="mt-3 inline-flex text-sm font-medium text-[color:var(--accent-strong)]">
                          Open order card
                        </Link>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-6 grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                    <div className="space-y-4">
                      <div className="app-subpanel">
                        <p className="app-section-label">Latest Customer Message</p>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-800">
                          {escalation.latestCustomerMessage || 'No message stored'}
                        </p>
                      </div>

                      <div className="app-subpanel">
                        <p className="app-section-label">Case Summary</p>
                        <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-800">
                          {escalation.summary}
                        </pre>
                      </div>

                      {linkedOrder ? (
                        <div className="app-subpanel">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="app-section-label">Linked Order Snapshot</p>
                            <span className="app-chip app-chip-warning">
                              {getOrderUnits(linkedOrder)} item(s)
                            </span>
                          </div>
                          <div className="mt-4 app-list">
                            {linkedOrder.orderItems.map((item) => (
                              <div key={item.id} className="app-item-card">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <p className="font-semibold text-slate-900">{item.product.name}</p>
                                    <div className="mt-2 app-badge-stack">
                                      <span className="app-chip app-chip-warning">Qty {item.quantity}</span>
                                      {item.size ? (
                                        <span className="app-chip app-chip-neutral">Size: {item.size}</span>
                                      ) : null}
                                      {item.color ? (
                                        <span className="app-chip app-chip-neutral">Color: {item.color}</span>
                                      ) : null}
                                    </div>
                                  </div>
                                  <p className="text-sm font-semibold text-slate-700">
                                    {getOrderStageLabel(linkedOrder.orderStatus)}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-4">
                      <div className="app-transcript">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <p className="app-section-label">Recent Conversation</p>
                          <span className="app-chip app-chip-neutral">{transcript.length} messages</span>
                        </div>
                        {transcript.length === 0 ? (
                          <p className="mt-3 text-sm text-[color:var(--foreground-soft)]">No transcript stored yet.</p>
                        ) : (
                          <div className="mt-4 max-h-[18rem] space-y-3 overflow-y-auto pr-1 sm:max-h-[26rem]">
                            {transcript.map((message) => (
                              <div
                                key={`${message.createdAt.toISOString()}-${message.role}`}
                                className={`app-transcript-bubble ${
                                  message.role === 'assistant'
                                    ? 'app-transcript-assistant'
                                    : message.role === 'operator'
                                      ? 'app-transcript-operator'
                                      : message.role === 'support_note'
                                        ? 'app-transcript-note'
                                        : 'app-transcript-user'
                                }`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--foreground-soft)]">
                                    {message.role === 'assistant'
                                      ? 'Bot'
                                      : message.role === 'operator'
                                        ? 'Support'
                                        : message.role === 'support_note'
                                          ? 'Internal Note'
                                          : 'Customer'}
                                  </p>
                                  <p className="text-[11px] font-medium text-[color:var(--foreground-soft)]">
                                    {formatDate(message.createdAt)}
                                  </p>
                                </div>
                                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-900">{message.message}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="grid gap-4 xl:grid-cols-2">
                        <form action={sendSupportReplyAction} className="app-soft-panel">
                          <input type="hidden" name="escalationId" value={escalation.id} />
                          <p className="app-section-label">Send Customer Reply</p>
                          <p className="mt-3 text-sm leading-6 text-slate-700">
                            Sends a manual reply to the customer and switches the conversation to human-active mode.
                          </p>
                          <textarea
                            name="reply"
                            rows={4}
                            placeholder="Type the manual support reply to send to the customer."
                            className="app-textarea mt-4"
                          />
                          <button type="submit" className="mt-4 w-full sm:w-auto app-button-primary">
                            Send reply and take over
                          </button>
                        </form>

                        <form action={addSupportNoteAction} className="app-soft-panel">
                      <input type="hidden" name="escalationId" value={escalation.id} />
                          <p className="app-section-label">Internal Note</p>
                          <p className="mt-3 text-sm leading-6 text-slate-700">
                            Stores context for the team without sending anything back to the customer.
                          </p>
                          <textarea
                            name="note"
                            rows={4}
                            placeholder="Add an internal note for the support team. This is not sent to the customer."
                            className="app-textarea mt-4"
                          />
                          <button type="submit" className="mt-4 w-full sm:w-auto app-button-secondary">
                            Save internal note
                          </button>
                        </form>
                      </div>

                      <div className="app-subpanel">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="app-section-label">Workflow Controls</p>
                          <span className="app-chip app-chip-neutral">
                            {formatEscalationStatusLabel(escalation.status)}
                          </span>
                        </div>
                        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                          <form action={updateEscalationWorkflowAction}>
                            <input type="hidden" name="escalationId" value={escalation.id} />
                            <input type="hidden" name="nextStatus" value="open" />
                            <button type="submit" className="w-full sm:w-auto app-button-secondary">
                              Mark waiting
                            </button>
                          </form>
                          <form action={updateEscalationWorkflowAction}>
                            <input type="hidden" name="escalationId" value={escalation.id} />
                            <input type="hidden" name="nextStatus" value="in_progress" />
                            <button type="submit" className="w-full sm:w-auto app-button-secondary">
                              Mark human active
                            </button>
                          </form>
                          <form action={updateEscalationWorkflowAction}>
                            <input type="hidden" name="escalationId" value={escalation.id} />
                            <input type="hidden" name="nextStatus" value="resolved" />
                            <button type="submit" className="w-full sm:w-auto app-button-primary">
                              Resolve and resume bot
                            </button>
                          </form>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </main>
  );
}
