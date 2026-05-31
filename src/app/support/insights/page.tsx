import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import {
  describeScope,
  getBrandScopedWhere,
  getBrandScopeValues,
} from '@/lib/access-control';
import { requirePagePermission } from '@/lib/authz';
import {
  buildBotInsightsReport,
  type BotInsightChatMessage,
  type BotInsightDiagnostic,
  type BotInsightEscalation,
  type BotInsightOrder,
  type BotInsightWebhookFailure,
} from '@/lib/bot-insights';
import { getScopedConversationSenderIds } from '@/lib/conversation-scope';
import prisma from '@/lib/prisma';
import { BotInsightsClient } from './BotInsightsClient';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<{ range?: string }>;

const RANGE_PRESETS = [7, 30, 90] as const;

function resolveRange(value?: string): number {
  const parsed = Number.parseInt(value || '', 10);
  return RANGE_PRESETS.includes(parsed as (typeof RANGE_PRESETS)[number]) ? parsed : 30;
}

function buildScopedSenderWhere(scopedSenderIds: string[] | null) {
  if (!scopedSenderIds) return {};
  return { senderId: { in: scopedSenderIds } };
}

function buildBrandOrSenderWhere(brandScope: string[] | null, scopedSenderIds: string[] | null) {
  if (!brandScope) return {};

  return {
    OR: [
      { brand: { in: brandScope } },
      ...(scopedSenderIds ? [{ senderId: { in: scopedSenderIds } }] : []),
    ],
  };
}

export default async function BotInsightsPage({ searchParams }: { searchParams: SearchParams }) {
  const scope = await requirePagePermission('support:view');
  const { range } = await searchParams;
  const windowDays = resolveRange(range);
  const now = new Date();
  const since = new Date(now.getTime() - windowDays * 86400000);
  const brandScope = getBrandScopeValues(scope);
  const scopedSenderIds = await getScopedConversationSenderIds(scope);
  const scopedSenderWhere = buildScopedSenderWhere(scopedSenderIds);
  const brandWhere = getBrandScopedWhere(scope);
  const brandOrSenderWhere = buildBrandOrSenderWhere(brandScope, scopedSenderIds);
  const dateWhere = {
    gte: since,
    lte: now,
  };

  const [
    messages,
    escalations,
    webhookFailures,
    orders,
    diagnostics,
  ] = await Promise.all([
    prisma.chatMessage.findMany({
      where: {
        createdAt: dateWhere,
        ...scopedSenderWhere,
      },
      orderBy: { id: 'asc' },
      take: 5000,
    }),
    prisma.supportEscalation.findMany({
      where: {
        ...brandWhere,
        OR: [
          { createdAt: dateWhere },
          { updatedAt: dateWhere },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
      select: {
        id: true,
        senderId: true,
        channel: true,
        brand: true,
        reason: true,
        status: true,
        latestCustomerMessage: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
      },
    }),
    prisma.webhookEventLog.findMany({
      where: {
        status: 'failed',
        receivedAt: dateWhere,
        ...brandOrSenderWhere,
      },
      orderBy: { receivedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        senderId: true,
        channel: true,
        brand: true,
        eventType: true,
        error: true,
        receivedAt: true,
      },
    }),
    prisma.order.findMany({
      where: {
        ...brandWhere,
        createdAt: dateWhere,
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: {
        id: true,
        brand: true,
        orderStatus: true,
        createdAt: true,
        customer: {
          select: {
            externalId: true,
            channel: true,
          },
        },
      },
    }),
    prisma.botMessageDiagnostic.findMany({
      where: {
        createdAt: dateWhere,
        ...brandOrSenderWhere,
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: {
        id: true,
        senderId: true,
        channel: true,
        brand: true,
        detectedLanguage: true,
        replyLanguage: true,
        aiAction: true,
        effectiveAction: true,
        aiConfidence: true,
        assistantReplyKind: true,
        supportMode: true,
        pendingStep: true,
        hasReply: true,
        hasMedia: true,
        orderId: true,
        issueFlags: true,
        createdAt: true,
      },
    }),
  ]);

  const senderIds = Array.from(new Set([
    ...messages.map((message) => message.senderId),
    ...escalations.map((escalation) => escalation.senderId),
    ...webhookFailures.map((failure) => failure.senderId).filter((senderId): senderId is string => Boolean(senderId)),
    ...orders.map((order) => order.customer.externalId).filter((senderId): senderId is string => Boolean(senderId)),
    ...diagnostics.map((diagnostic) => diagnostic.senderId),
  ]));

  const customers = senderIds.length > 0
    ? await prisma.customer.findMany({
        where: {
          externalId: { in: senderIds },
          ...(brandScope
            ? {
                OR: [
                  { preferredBrand: { in: brandScope } },
                  { orders: { some: { brand: { in: brandScope } } } },
                  { supportEscalations: { some: { brand: { in: brandScope } } } },
                ],
              }
            : {}),
        },
        select: {
          externalId: true,
          name: true,
          channel: true,
          preferredBrand: true,
        },
      })
    : [];

  const report = buildBotInsightsReport({
    messages: messages as BotInsightChatMessage[],
    escalations: escalations as BotInsightEscalation[],
    webhookFailures: webhookFailures as BotInsightWebhookFailure[],
    orders: orders as BotInsightOrder[],
    customers,
    diagnostics: diagnostics as BotInsightDiagnostic[],
    windowDays,
    now,
  });

  return (
    <main className="main">
      <PageHeader
        title="Bot Insights"
        subtitle={`Conversation intelligence for ${describeScope(scope)} · last ${windowDays} days`}
        actions={
          <>
            <Link className="btn btn-secondary" href="/support">Inbox</Link>
            <Link className="btn btn-secondary" href="/support/simulator">Simulator</Link>
            <Link className="btn btn-secondary" href="/support/reply-qa">Reply QA</Link>
          </>
        }
      />

      <div
        aria-label="Bot insight date range"
        style={{
          flex: '0 0 auto',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          padding: '14px 28px 0',
        }}
      >
        {RANGE_PRESETS.map((preset) => (
          <Link
            key={preset}
            href={`/support/insights?range=${preset}`}
            className={preset === windowDays ? 'btn btn-primary' : 'btn btn-secondary'}
            style={{
              minHeight: 28,
              padding: '5px 10px',
              lineHeight: 1,
            }}
          >
            {preset}d
          </Link>
        ))}
      </div>

      <BotInsightsClient report={report} />
    </main>
  );
}
