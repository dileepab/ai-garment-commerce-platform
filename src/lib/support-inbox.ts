import prisma from '@/lib/prisma';
import {
  AuthorizationError,
  canAccessBrand,
  type UserScope,
} from '@/lib/access-control';
import { resolveSelectedBrand } from '@/lib/brand-context';
import {
  formatSupportDate,
  formatSupportTime,
  serializeSupportMessage,
  serializeSupportOrder,
  SUPPORT_THREAD_MESSAGE_LIMIT,
} from '@/app/support/format';
import type {
  SupportStats,
  SupportThread,
  SupportThreadMessage,
} from '@/app/support/types';
import {
  createSupportConversationKey,
  parseSupportConversationKey,
  shouldAttachResolvedSupportCase,
  SupportInboxError,
  type SupportCaseTiming,
  type SupportConversationIdentity,
} from './support-inbox-core';

export {
  createSupportConversationKey,
  parseSupportConversationKey,
  shouldAttachResolvedSupportCase,
  SupportInboxError,
} from './support-inbox-core';
export type {
  SupportCaseTiming,
  SupportConversationIdentity,
} from './support-inbox-core';

const DEFAULT_CONVERSATION_SUMMARY = 'Bot-managed conversation.';

interface ConversationSource {
  identity: SupportConversationIdentity;
  firstMessageAt: Date | null;
  latestMessageAt: Date | null;
  messageCount: number;
}

interface ScopedBrandWhere {
  brand?: string | { in: string[] };
}

function getIdentityMapKey(identity: SupportConversationIdentity): string {
  return JSON.stringify([identity.brand, identity.channel, identity.senderId]);
}

function getScopedBrandWhere(
  scope: UserScope,
  selectedBrand?: string | null
): { selectedBrand: string | null; where: ScopedBrandWhere } {
  const resolvedBrand = resolveSelectedBrand(scope, selectedBrand);

  if (resolvedBrand) {
    return { selectedBrand: resolvedBrand, where: { brand: resolvedBrand } };
  }

  if (scope.brandAccess === 'limited') {
    return { selectedBrand: null, where: { brand: { in: scope.brands } } };
  }

  return { selectedBrand: null, where: {} };
}

function assertConversationAccess(
  scope: UserScope,
  identity: SupportConversationIdentity,
  selectedBrand?: string | null
) {
  const resolvedBrand = resolveSelectedBrand(scope, selectedBrand);

  if (resolvedBrand !== null && identity.brand !== resolvedBrand) {
    throw new AuthorizationError(
      'This conversation is outside the selected brand.'
    );
  }

  if (scope.brandAccess === 'limited') {
    if (!canAccessBrand(scope, identity.brand)) {
      throw new AuthorizationError(
        'You do not have access to this support conversation.'
      );
    }
  }
}

function resolvedCaseTime(supportCase: SupportCaseTiming): Date {
  return supportCase.resolvedAt ?? supportCase.updatedAt;
}

function selectCurrentSupportCase<T extends SupportCaseTiming>(
  supportCases: T[],
  latestMessageAt: Date | null
): T | null {
  let latestActive: T | null = null;
  let latestResolved: T | null = null;

  for (const supportCase of supportCases) {
    if (supportCase.status.toLowerCase() !== 'resolved') {
      if (
        latestActive === null ||
        supportCase.updatedAt.getTime() > latestActive.updatedAt.getTime()
      ) {
        latestActive = supportCase;
      }
      continue;
    }

    if (
      latestResolved === null ||
      resolvedCaseTime(supportCase).getTime() >
        resolvedCaseTime(latestResolved).getTime()
    ) {
      latestResolved = supportCase;
    }
  }

  if (latestActive) return latestActive;
  if (
    latestResolved &&
    shouldAttachResolvedSupportCase(latestResolved, latestMessageAt)
  ) {
    return latestResolved;
  }

  return null;
}

function maxDate(...values: Array<Date | null | undefined>): Date {
  const validValues = values.filter((value): value is Date => value instanceof Date);
  return validValues.reduce(
    (latest, value) =>
      value.getTime() > latest.getTime() ? value : latest,
    validValues[0] ?? new Date(0)
  );
}

function clampMessageLimit(limit?: number): number {
  if (limit === undefined) return SUPPORT_THREAD_MESSAGE_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new SupportInboxError('Message limit must be a positive integer.');
  }
  return Math.min(limit, 100);
}

function clampConversationLimit(limit?: number): number | null {
  if (limit === undefined) return null;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new SupportInboxError('Conversation limit must be a positive integer.');
  }
  return Math.min(limit, 1000);
}

export async function loadSupportInbox({
  scope,
  selectedBrand,
  includeMessages = false,
  messageLimit,
  conversationLimit,
}: {
  scope: UserScope;
  selectedBrand?: string | null;
  includeMessages?: boolean;
  messageLimit?: number;
  conversationLimit?: number;
}): Promise<{ threads: SupportThread[]; stats: SupportStats }> {
  const { where: brandWhere } = getScopedBrandWhere(scope, selectedBrand);
  const visibleMessageLimit = clampMessageLimit(messageLimit);
  const visibleConversationLimit = clampConversationLimit(conversationLimit);

  const [chatGroups, supportCases, latestUserGroups] = await Promise.all([
    prisma.chatMessage.groupBy({
      by: ['brand', 'channel', 'senderId'],
      where: brandWhere,
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    }),
    prisma.supportEscalation.findMany({
      where: brandWhere,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.chatMessage.groupBy({
      by: ['brand', 'channel', 'senderId'],
      where: { ...brandWhere, role: 'user' },
      _max: { id: true },
    }),
  ]);

  const sourcesByIdentity = new Map<string, ConversationSource>();
  for (const group of chatGroups) {
    const identity = {
      brand: group.brand,
      channel: group.channel,
      senderId: group.senderId,
    } satisfies SupportConversationIdentity;
    sourcesByIdentity.set(getIdentityMapKey(identity), {
      identity,
      firstMessageAt: group._min.createdAt,
      latestMessageAt: group._max.createdAt,
      messageCount: group._count._all,
    });
  }

  const supportCasesByIdentity = new Map<
    string,
    Array<(typeof supportCases)[number]>
  >();
  for (const supportCase of supportCases) {
    const identity = {
      brand: supportCase.brand,
      channel: supportCase.channel,
      senderId: supportCase.senderId,
    } satisfies SupportConversationIdentity;
    const identityKey = getIdentityMapKey(identity);
    const existingCases = supportCasesByIdentity.get(identityKey) ?? [];
    existingCases.push(supportCase);
    supportCasesByIdentity.set(identityKey, existingCases);

    if (!sourcesByIdentity.has(identityKey)) {
      sourcesByIdentity.set(identityKey, {
        identity,
        firstMessageAt: null,
        latestMessageAt: null,
        messageCount: 0,
      });
    }
  }

  const selectedCaseByIdentity = new Map<
    string,
    (typeof supportCases)[number]
  >();
  for (const [identityKey, source] of sourcesByIdentity) {
    const selectedCase = selectCurrentSupportCase(
      supportCasesByIdentity.get(identityKey) ?? [],
      source.latestMessageAt
    );
    if (selectedCase) selectedCaseByIdentity.set(identityKey, selectedCase);
  }

  let sources = Array.from(sourcesByIdentity.values()).sort((left, right) => {
    const leftKey = getIdentityMapKey(left.identity);
    const rightKey = getIdentityMapKey(right.identity);
    const leftUpdatedAt = maxDate(
      left.latestMessageAt,
      selectedCaseByIdentity.get(leftKey)?.updatedAt
    );
    const rightUpdatedAt = maxDate(
      right.latestMessageAt,
      selectedCaseByIdentity.get(rightKey)?.updatedAt
    );
    return rightUpdatedAt.getTime() - leftUpdatedAt.getTime();
  });

  if (visibleConversationLimit !== null) {
    sources = sources.slice(0, visibleConversationLimit);
  }

  const sourceKeys = new Set(
    sources.map((source) => getIdentityMapKey(source.identity))
  );
  const latestUserMessageIds = latestUserGroups
    .filter((group) => {
      const identityKey = getIdentityMapKey({
        brand: group.brand,
        channel: group.channel,
        senderId: group.senderId,
      });
      return sourceKeys.has(identityKey) && group._max.id !== null;
    })
    .map((group) => group._max.id)
    .filter((id): id is number => id !== null);

  const selectedCustomerIds = sources
    .map((source) =>
      selectedCaseByIdentity.get(getIdentityMapKey(source.identity))?.customerId
    )
    .filter((id): id is number => typeof id === 'number');
  const senderIds = Array.from(
    new Set(sources.map((source) => source.identity.senderId))
  );

  const [latestUserMessages, customers] = await Promise.all([
    latestUserMessageIds.length > 0
      ? prisma.chatMessage.findMany({
          where: { id: { in: latestUserMessageIds } },
        })
      : Promise.resolve([]),
    senderIds.length > 0 || selectedCustomerIds.length > 0
      ? prisma.customer.findMany({
          where: {
            OR: [
              ...(senderIds.length > 0
                ? [{ externalId: { in: senderIds } }]
                : []),
              ...(selectedCustomerIds.length > 0
                ? [{ id: { in: selectedCustomerIds } }]
                : []),
            ],
          },
        })
      : Promise.resolve([]),
  ]);

  const latestUserMessageByIdentity = new Map(
    latestUserMessages.map((message) => [
      getIdentityMapKey({
        brand: message.brand,
        channel: message.channel,
        senderId: message.senderId,
      }),
      message,
    ])
  );
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const customerByExternalId = new Map(
    customers
      .filter((customer) => customer.externalId !== null)
      .map((customer) => [customer.externalId as string, customer])
  );

  const customerIdByIdentity = new Map<string, number>();
  for (const source of sources) {
    const identityKey = getIdentityMapKey(source.identity);
    const selectedCase = selectedCaseByIdentity.get(identityKey);
    const customer =
      (selectedCase?.customerId
        ? customerById.get(selectedCase.customerId)
        : null) ?? customerByExternalId.get(source.identity.senderId);
    if (customer) customerIdByIdentity.set(identityKey, customer.id);
  }

  const customerIds = Array.from(new Set(customerIdByIdentity.values()));
  const linkedOrderIds = sources
    .map((source) =>
      selectedCaseByIdentity.get(getIdentityMapKey(source.identity))?.orderId
    )
    .filter((id): id is number => typeof id === 'number');
  const orderFilters = [
    ...(customerIds.length > 0 ? [{ customerId: { in: customerIds } }] : []),
    ...(linkedOrderIds.length > 0 ? [{ id: { in: linkedOrderIds } }] : []),
  ];
  const orders =
    orderFilters.length > 0
      ? await prisma.order.findMany({
          where: { ...brandWhere, OR: orderFilters },
          include: {
            orderItems: { include: { product: true } },
            returnRequests: {
              select: {
                id: true,
                type: true,
                status: true,
                reason: true,
              },
              orderBy: { createdAt: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];

  const serializedOrders = orders.map(serializeSupportOrder);
  const orderById = new Map(serializedOrders.map((order) => [order.id, order]));
  const ordersByCustomerAndBrand = new Map<string, typeof serializedOrders>();
  orders.forEach((order, index) => {
    const key = JSON.stringify([order.brand, order.customerId]);
    const existingOrders = ordersByCustomerAndBrand.get(key) ?? [];
    existingOrders.push(serializedOrders[index]);
    ordersByCustomerAndBrand.set(key, existingOrders);
  });

  const messagesByIdentity = new Map<string, SupportThreadMessage[]>();
  if (includeMessages) {
    await Promise.all(
      sources.map(async (source) => {
        const messages = await prisma.chatMessage.findMany({
          where: {
            brand: source.identity.brand,
            channel: source.identity.channel,
            senderId: source.identity.senderId,
          },
          orderBy: { id: 'desc' },
          take: visibleMessageLimit,
        });
        messagesByIdentity.set(
          getIdentityMapKey(source.identity),
          messages.reverse().map(serializeSupportMessage)
        );
      })
    );
  }

  const threads: SupportThread[] = sources.map((source) => {
    const identityKey = getIdentityMapKey(source.identity);
    const conversationKey = createSupportConversationKey(source.identity);
    const selectedCase = selectedCaseByIdentity.get(identityKey) ?? null;
    const customerId = customerIdByIdentity.get(identityKey) ?? null;
    const customer = customerId ? customerById.get(customerId) ?? null : null;
    const linkedOrderCandidate = selectedCase?.orderId
      ? orderById.get(selectedCase.orderId) ?? null
      : null;
    const linkedOrder =
      linkedOrderCandidate?.brand === source.identity.brand
        ? linkedOrderCandidate
        : null;
    let recentOrders = customerId
      ? (
          ordersByCustomerAndBrand.get(
            JSON.stringify([source.identity.brand, customerId])
          ) ?? []
        ).slice(0, 3)
      : [];

    if (linkedOrder && !recentOrders.some((order) => order.id === linkedOrder.id)) {
      recentOrders = [linkedOrder, ...recentOrders].slice(0, 3);
    }

    const latestUserMessage = latestUserMessageByIdentity.get(identityKey);
    const createdAt =
      selectedCase?.createdAt ??
      source.firstMessageAt ??
      source.latestMessageAt ??
      new Date(0);
    const updatedAt = maxDate(source.latestMessageAt, selectedCase?.updatedAt);

    return {
      id: conversationKey,
      conversationKey,
      escalationId: selectedCase?.id ?? null,
      senderId: source.identity.senderId,
      channel: source.identity.channel,
      customerId,
      customer: customer ? { id: customer.id, name: customer.name } : null,
      orderId: selectedCase?.orderId ?? null,
      order: linkedOrder,
      recentOrders,
      brand: source.identity.brand,
      reason: selectedCase?.reason ?? 'bot_active',
      status: selectedCase?.status ?? 'bot_active',
      contactName: selectedCase?.contactName ?? customer?.name ?? null,
      contactPhone: selectedCase?.contactPhone ?? customer?.phone ?? null,
      latestCustomerMessage:
        latestUserMessage?.message ?? selectedCase?.latestCustomerMessage ?? null,
      summary: selectedCase?.summary ?? DEFAULT_CONVERSATION_SUMMARY,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      updatedAtLabel: formatSupportTime(updatedAt),
      resolvedAt: selectedCase?.resolvedAt?.toISOString() ?? null,
      hasOlderMessages: includeMessages
        ? source.messageCount > visibleMessageLimit
        : false,
      messages: messagesByIdentity.get(identityKey) ?? [],
    };
  });

  return {
    threads,
    stats: {
      open: supportCases.filter(
        (supportCase) => supportCase.status.toLowerCase() !== 'resolved'
      ).length,
      linkedOrders: supportCases.filter((supportCase) => supportCase.orderId !== null)
        .length,
      dateLabel: formatSupportDate(new Date()),
    },
  };
}

export interface SupportConversationMessagesResult {
  messages: SupportThreadMessage[];
  hasMoreOlder?: boolean;
  conversation: {
    id: string;
    conversationKey: string;
    escalationId: number | null;
    senderId: string;
    channel: string;
    brand: string | null;
    status: string;
    latestCustomerMessage: string | null;
    summary: string;
    updatedAt: string;
    updatedAtLabel: string;
    resolvedAt: string | null;
  };
}

export async function loadSupportConversationMessages({
  scope,
  conversationKey,
  selectedBrand,
  beforeId,
  afterId,
  limit,
}: {
  scope: UserScope;
  conversationKey: string;
  selectedBrand?: string | null;
  beforeId?: number;
  afterId?: number;
  limit?: number;
}): Promise<SupportConversationMessagesResult> {
  if (beforeId !== undefined && afterId !== undefined) {
    throw new SupportInboxError('Use beforeId or afterId, not both.');
  }

  const identity = parseSupportConversationKey(conversationKey);
  assertConversationAccess(scope, identity, selectedBrand);
  const visibleMessageLimit = clampMessageLimit(limit);
  const exactConversationWhere = {
    brand: identity.brand,
    channel: identity.channel,
    senderId: identity.senderId,
  };
  const shouldCheckOlder = afterId === undefined;

  const [messages, latestMessage, latestUserMessage, supportCases] = await Promise.all([
    prisma.chatMessage.findMany({
      where: {
        ...exactConversationWhere,
        ...(beforeId !== undefined ? { id: { lt: beforeId } } : {}),
        ...(afterId !== undefined ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: afterId !== undefined ? 'asc' : 'desc' },
      take: shouldCheckOlder ? visibleMessageLimit + 1 : visibleMessageLimit,
    }),
    prisma.chatMessage.findFirst({
      where: exactConversationWhere,
      orderBy: { id: 'desc' },
      select: { createdAt: true },
    }),
    prisma.chatMessage.findFirst({
      where: { ...exactConversationWhere, role: 'user' },
      orderBy: { id: 'desc' },
      select: { message: true },
    }),
    prisma.supportEscalation.findMany({
      where: exactConversationWhere,
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  if (latestMessage === null && supportCases.length === 0) {
    throw new SupportInboxError('Support conversation not found.', 404);
  }

  const selectedCase = selectCurrentSupportCase(
    supportCases,
    latestMessage?.createdAt ?? null
  );
  const hasMoreOlder = shouldCheckOlder
    ? messages.length > visibleMessageLimit
    : undefined;
  const visibleMessages = shouldCheckOlder
    ? messages.slice(0, visibleMessageLimit).reverse()
    : messages;
  const updatedAt = maxDate(
    latestMessage?.createdAt,
    selectedCase?.updatedAt
  );

  return {
    messages: visibleMessages.map(serializeSupportMessage),
    hasMoreOlder,
    conversation: {
      id: conversationKey,
      conversationKey,
      escalationId: selectedCase?.id ?? null,
      senderId: identity.senderId,
      channel: identity.channel,
      brand: identity.brand,
      status: selectedCase?.status ?? 'bot_active',
      latestCustomerMessage:
        latestUserMessage?.message ?? selectedCase?.latestCustomerMessage ?? null,
      summary: selectedCase?.summary ?? DEFAULT_CONVERSATION_SUMMARY,
      updatedAt: updatedAt.toISOString(),
      updatedAtLabel: formatSupportTime(updatedAt),
      resolvedAt: selectedCase?.resolvedAt?.toISOString() ?? null,
    },
  };
}
