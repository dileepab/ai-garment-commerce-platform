import { detectCustomerLanguage, type CustomerLanguage } from '@/lib/chat/language';

export interface BotInsightChatMessage {
  id: number;
  senderId: string;
  channel: string;
  role: string;
  message: string;
  createdAt: Date;
}

export interface BotInsightEscalation {
  id: number;
  senderId: string;
  channel: string;
  brand: string | null;
  reason: string;
  status: string;
  contactName: string | null;
  latestCustomerMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}

export interface BotInsightWebhookFailure {
  id: string;
  senderId: string | null;
  channel: string;
  brand: string | null;
  eventType: string;
  error: string | null;
  receivedAt: Date;
}

export interface BotInsightOrder {
  id: number;
  brand: string | null;
  orderStatus: string;
  createdAt: Date;
  customer: {
    externalId: string | null;
    channel: string | null;
  };
}

export interface BotInsightCustomer {
  externalId: string | null;
  name: string;
  channel: string | null;
  preferredBrand: string | null;
}

export interface BotInsightDiagnostic {
  id: number;
  senderId: string;
  channel: string;
  brand: string | null;
  detectedLanguage: string | null;
  replyLanguage: string | null;
  aiAction: string | null;
  effectiveAction: string | null;
  aiConfidence: number | null;
  assistantReplyKind: string | null;
  supportMode: string | null;
  pendingStep: string | null;
  hasReply: boolean;
  hasMedia: boolean;
  orderId: number | null;
  issueFlags: string | null;
  createdAt: Date;
}

export interface BotInsightTranscriptMessage {
  id: number;
  role: string;
  text: string;
  language: CustomerLanguage | 'unknown';
  replyKind: string;
  createdAt: string;
  createdAtLabel: string;
}

export interface BotInsightConversation {
  key: string;
  senderId: string;
  channel: string;
  brand: string | null;
  customerName: string | null;
  latestAt: string;
  latestAtLabel: string;
  userMessages: number;
  assistantMessages: number;
  fallbackCount: number;
  handoffCount: number;
  noReplyCount: number;
  supportWaitingCount: number;
  languageMismatchCount: number;
  repeatedReplyCount: number;
  webhookFailureCount: number;
  orderCount: number;
  conversionCount: number;
  score: number;
  issueLabels: string[];
  recommendation: string;
  lastCustomerMessage: string | null;
  lastAssistantMessage: string | null;
  diagnosticSummary: {
    detectedLanguage: string | null;
    replyLanguage: string | null;
    aiAction: string | null;
    effectiveAction: string | null;
    confidence: number | null;
    replyKind: string | null;
    supportMode: string | null;
    pendingStep: string | null;
    hasReply: boolean;
    hasMedia: boolean;
    orderId: number | null;
    issueFlags: string[];
  } | null;
  messages: BotInsightTranscriptMessage[];
  regressionSnippet: string;
}

export interface BotInsightTopQuestion {
  text: string;
  count: number;
  language: CustomerLanguage | 'unknown';
  channel: string;
  lastSeenAt: string;
}

export interface BotInsightMetric {
  label: string;
  value: string;
  note: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
}

export interface BotInsightsReport {
  generatedAt: string;
  windowDays: number;
  healthScore: number;
  metrics: BotInsightMetric[];
  funnel: {
    conversations: number;
    catalogShown: number;
    orderStarted: number;
    orderConfirmed: number;
    supportHandoff: number;
  };
  languageSplit: Array<{ label: string; count: number; pct: number }>;
  channelSplit: Array<{ label: string; count: number; pct: number }>;
  topQuestions: BotInsightTopQuestion[];
  problemConversations: BotInsightConversation[];
  recentFailures: Array<{
    id: string;
    channel: string;
    brand: string | null;
    senderId: string | null;
    eventType: string;
    error: string | null;
    receivedAt: string;
    receivedAtLabel: string;
  }>;
}

interface ConversationAccumulator {
  key: string;
  senderId: string;
  channel: string;
  brand: string | null;
  customerName: string | null;
  messages: BotInsightChatMessage[];
  escalations: BotInsightEscalation[];
  webhookFailures: BotInsightWebhookFailure[];
  orders: BotInsightOrder[];
  diagnostics: BotInsightDiagnostic[];
}

function conversationKey(channel: string, senderId: string): string {
  return `${channel}:${senderId}`;
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('en-LK', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function parseIssueFlags(value?: string | null): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item)).filter(Boolean)
      : [];
  } catch {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function normalizeQuestionText(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function isLowSignalMessage(value: string): boolean {
  const normalized = normalizeQuestionText(value).toLowerCase();

  return (
    normalized.length < 5 ||
    /^(hi|hello|hey|ok|okay|thanks|thank you|yes|no|fine|noted)\b/.test(normalized) ||
    /^(හායි|හලෝ|ඔව්|නැහැ|ස්තුතියි)$/.test(normalized) ||
    /^(வணக்கம்|சரி|நன்றி|ஆம்|இல்லை)$/.test(normalized)
  );
}

export function inferAssistantReplyKind(text: string): string {
  const normalized = text.toLowerCase();

  if (!text.trim()) return 'no_reply';
  if (normalized.includes('flagged this conversation') || normalized.includes('team follow-up')) {
    return 'support_handoff';
  }
  if (
    normalized.includes("didn't quite catch") ||
    text.includes('පැහැදිලිව තේරුණේ නැහැ') ||
    text.includes('தெளிவாக புரியவில்லை')
  ) {
    return 'fallback';
  }
  if (
    normalized.includes('we currently have the following items available') ||
    text.includes('දැනට අපට තිබෙන භාණ්ඩ') ||
    text.includes('தற்போது எங்களிடம் உள்ள பொருட்கள்')
  ) {
    return 'catalog';
  }
  if (
    normalized.includes('latest collection is dropping') ||
    text.includes('අලුත්ම ඇඳුම් එකතුව') ||
    text.includes('புதிய ஆடைகள் விரைவில்')
  ) {
    return 'empty_catalog';
  }
  if (normalized.startsWith('order summary')) return 'order_summary';
  if (normalized.includes('confirmed successfully')) return 'order_confirmed';
  if (normalized.includes('delivery window') || text.includes('අපේක්ෂිත භාරදීමේ කාලය')) {
    return 'delivery_question';
  }
  if (normalized.includes('cod works') || text.includes('COD පහසුකම')) {
    return 'payment_question';
  }
  if (normalized.includes('support team directly') || normalized.includes('call or whatsapp')) {
    return 'support_contact';
  }
  if (/^hello\b/i.test(text) || text.startsWith('ආයුබෝවන්') || text.startsWith('வணக்கம்')) {
    return 'greeting';
  }

  return 'generic';
}

function hasLanguageMismatch(userText: string, assistantText: string | null): boolean {
  if (!assistantText) return false;

  const userLanguage = detectCustomerLanguage(userText);
  const assistantLanguage = detectCustomerLanguage(assistantText);

  return Boolean(userLanguage && assistantLanguage && userLanguage !== assistantLanguage);
}

function isSupportWaitingDiagnostic(diagnostic: BotInsightDiagnostic): boolean {
  const flags = new Set(parseIssueFlags(diagnostic.issueFlags));
  const replyKind = diagnostic.assistantReplyKind || '';
  const supportMode = diagnostic.supportMode || '';

  return (
    replyKind === 'support_waiting' ||
    flags.has('support_handoff') ||
    flags.has('human_active') ||
    supportMode === 'handoff_requested' ||
    supportMode === 'human_active'
  );
}

function hasSupportEscalationAt(
  message: BotInsightChatMessage,
  escalations: BotInsightEscalation[]
): boolean {
  return escalations.some((escalation) => {
    if (escalation.createdAt > message.createdAt) return false;
    return !escalation.resolvedAt || escalation.resolvedAt > message.createdAt;
  });
}

function hasSupportWaitingDiagnosticAt(
  message: BotInsightChatMessage,
  diagnostics: BotInsightDiagnostic[]
): boolean {
  const messageTime = message.createdAt.getTime();

  return diagnostics.some((diagnostic) => {
    if (!isSupportWaitingDiagnostic(diagnostic)) return false;
    const diagnosticTime = diagnostic.createdAt.getTime();

    return diagnosticTime >= messageTime - 30000 && diagnosticTime <= messageTime + 5 * 60000;
  });
}

function isSupportWaitingMessage(
  message: BotInsightChatMessage,
  conversation: ConversationAccumulator
): boolean {
  return (
    hasSupportWaitingDiagnosticAt(message, conversation.diagnostics) ||
    hasSupportEscalationAt(message, conversation.escalations)
  );
}

function summarizeRepeatedReplies(messages: BotInsightChatMessage[]): number {
  let repeated = 0;
  let previousAssistant = '';

  for (const message of messages) {
    if (message.role !== 'assistant') continue;

    const normalized = normalizeQuestionText(message.message);
    if (normalized.length > 24 && normalized === previousAssistant) {
      repeated += 1;
    }
    previousAssistant = normalized;
  }

  return repeated;
}

function getLatestMessage(messages: BotInsightChatMessage[], role: string): BotInsightChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === role) return messages[index];
  }

  return null;
}

function deriveRecommendation(labels: string[]): string {
  if (labels.includes('Meta delivery failed')) {
    return 'Check Meta token health and resend from Support after the token is fixed.';
  }
  if (labels.includes('Support waiting')) {
    return 'Bot silence is intentional because support owns this conversation. Reply or resolve the case from the support inbox.';
  }
  if (labels.includes('No bot reply')) {
    return 'Review support handoff state. Resolve/reopen the case or start a clean test sender before judging bot copy.';
  }
  if (labels.includes('Language mismatch')) {
    return 'Add this transcript to chat regression tests and inspect language detection for the latest customer message.';
  }
  if (labels.includes('Fallback')) {
    return 'Create a deterministic intent rule or approved template for this repeated customer question.';
  }
  if (labels.includes('Repeated reply')) {
    return 'Check whether the bot is missing new context and repeating the previous answer.';
  }
  if (labels.includes('Support handoff')) {
    return 'Use the support inbox to close the loop, then add a bot rule only if this issue is safe to automate.';
  }

  return 'Review the transcript and decide whether this should become a deterministic rule, template, or support workflow.';
}

function createRegressionSnippet(conversation: ConversationAccumulator): string {
  const userMessages = conversation.messages
    .filter((message) => message.role === 'user')
    .slice(-6)
    .map((message) => message.message);
  const slug = `${conversation.channel}-${conversation.senderId}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'conversation';

  return `{
  name: 'Regression from Bot Insights: ${slug}',
  senderId: buildSender(runId, '${slug}'),
  messages: ${JSON.stringify(userMessages, null, 2).replace(/\n/g, '\n  ')},
  verify: async ({ transcript }) => {
    assert(
      transcript[transcript.length - 1].bot !== '[no assistant reply recorded]',
      'Expected the bot to produce a customer-facing reply.'
    );
  },
},`;
}

function ensureConversation(
  conversations: Map<string, ConversationAccumulator>,
  channel: string,
  senderId: string
): ConversationAccumulator {
  const key = conversationKey(channel, senderId);
  let conversation = conversations.get(key);

  if (!conversation) {
    conversation = {
      key,
      senderId,
      channel,
      brand: null,
      customerName: null,
      messages: [],
      escalations: [],
      webhookFailures: [],
      orders: [],
      diagnostics: [],
    };
    conversations.set(key, conversation);
  }

  return conversation;
}

function addBrand(conversation: ConversationAccumulator, brand?: string | null) {
  if (!conversation.brand && brand) {
    conversation.brand = brand;
  }
}

function addCustomerName(conversation: ConversationAccumulator, name?: string | null) {
  if (!conversation.customerName && name) {
    conversation.customerName = name;
  }
}

export function buildBotInsightsReport(input: {
  messages: BotInsightChatMessage[];
  escalations: BotInsightEscalation[];
  webhookFailures: BotInsightWebhookFailure[];
  orders: BotInsightOrder[];
  customers: BotInsightCustomer[];
  diagnostics: BotInsightDiagnostic[];
  windowDays: number;
  now?: Date;
}): BotInsightsReport {
  const now = input.now ?? new Date();
  const conversations = new Map<string, ConversationAccumulator>();
  const customerByExternalId = new Map(
    input.customers
      .filter((customer) => customer.externalId)
      .map((customer) => [customer.externalId as string, customer])
  );

  for (const message of input.messages) {
    const conversation = ensureConversation(conversations, message.channel, message.senderId);
    conversation.messages.push(message);
    const customer = customerByExternalId.get(message.senderId);
    if (customer) {
      addCustomerName(conversation, customer.name);
      addBrand(conversation, customer.preferredBrand);
    }
  }

  for (const escalation of input.escalations) {
    const conversation = ensureConversation(conversations, escalation.channel, escalation.senderId);
    conversation.escalations.push(escalation);
    addCustomerName(conversation, escalation.contactName);
    addBrand(conversation, escalation.brand);
  }

  for (const failure of input.webhookFailures) {
    if (!failure.senderId) continue;
    const conversation = ensureConversation(conversations, failure.channel, failure.senderId);
    conversation.webhookFailures.push(failure);
    addBrand(conversation, failure.brand);
  }

  for (const order of input.orders) {
    const senderId = order.customer.externalId;
    const channel = order.customer.channel || 'messenger';
    if (!senderId) continue;

    const conversation = ensureConversation(conversations, channel, senderId);
    conversation.orders.push(order);
    addBrand(conversation, order.brand);
  }

  for (const diagnostic of input.diagnostics) {
    const conversation = ensureConversation(conversations, diagnostic.channel, diagnostic.senderId);
    conversation.diagnostics.push(diagnostic);
    addBrand(conversation, diagnostic.brand);
  }

  for (const conversation of conversations.values()) {
    conversation.messages.sort((a, b) => a.id - b.id);
    conversation.escalations.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    conversation.webhookFailures.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
    conversation.orders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    conversation.diagnostics.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  let userMessages = 0;
  let assistantMessages = 0;
  let fallbackCount = 0;
  let noReplyCount = 0;
  let supportWaitingCount = 0;
  let languageMismatchCount = 0;
  let catalogConversations = 0;
  let orderStartedConversations = 0;
  let orderConfirmedConversations = 0;
  let handoffConversations = 0;
  const languageCounts = new Map<string, number>();
  const channelCounts = new Map<string, number>();
  const questionCounts = new Map<string, BotInsightTopQuestion>();
  const problemConversations: BotInsightConversation[] = [];

  for (const conversation of conversations.values()) {
    const labels = new Set<string>();
    const replyKinds = new Set<string>();
    const latestDiagnostic = conversation.diagnostics[0] || null;
    const latestAt = [
      ...conversation.messages.map((message) => message.createdAt),
      ...conversation.escalations.map((escalation) => escalation.updatedAt),
      ...conversation.webhookFailures.map((failure) => failure.receivedAt),
      ...conversation.orders.map((order) => order.createdAt),
      ...conversation.diagnostics.map((diagnostic) => diagnostic.createdAt),
    ].sort((a, b) => b.getTime() - a.getTime())[0] ?? now;

    const conversationUserMessages = conversation.messages.filter((message) => message.role === 'user');
    const conversationAssistantMessages = conversation.messages.filter((message) => message.role === 'assistant');
    userMessages += conversationUserMessages.length;
    assistantMessages += conversationAssistantMessages.length;
    channelCounts.set(conversation.channel, (channelCounts.get(conversation.channel) ?? 0) + conversationUserMessages.length);

    for (const message of conversationUserMessages) {
      const language = detectCustomerLanguage(message.message) || 'unknown';
      languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);

      const normalizedQuestion = normalizeQuestionText(message.message);
      if (!isLowSignalMessage(normalizedQuestion)) {
        const key = `${conversation.channel}|${language}|${normalizedQuestion.toLowerCase()}`;
        const current = questionCounts.get(key) ?? {
          text: normalizedQuestion,
          count: 0,
          language,
          channel: conversation.channel,
          lastSeenAt: message.createdAt.toISOString(),
        };
        current.count += 1;
        if (message.createdAt > new Date(current.lastSeenAt)) {
          current.lastSeenAt = message.createdAt.toISOString();
        }
        questionCounts.set(key, current);
      }
    }

    let conversationFallbacks = 0;
    let conversationNoReplies = 0;
    let conversationSupportWaiting = 0;
    let conversationMismatches = 0;

    for (let index = 0; index < conversation.messages.length; index += 1) {
      const message = conversation.messages[index];
      if (message.role !== 'user') {
        if (message.role === 'assistant') {
          replyKinds.add(inferAssistantReplyKind(message.message));
        }
        continue;
      }

      const next = conversation.messages[index + 1];
      const assistantReply = next?.role === 'assistant' ? next.message : null;
      const replyKind = assistantReply ? inferAssistantReplyKind(assistantReply) : 'no_reply';

      if (!assistantReply) {
        if (isSupportWaitingMessage(message, conversation)) {
          conversationSupportWaiting += 1;
          replyKinds.add('support_waiting');
        } else {
          conversationNoReplies += 1;
          replyKinds.add(replyKind);
        }
      } else {
        replyKinds.add(replyKind);
      }
      if (replyKind === 'fallback') {
        conversationFallbacks += 1;
      }
      if (hasLanguageMismatch(message.message, assistantReply)) {
        conversationMismatches += 1;
      }
    }

    const conversationRepeatedReplies = summarizeRepeatedReplies(conversation.messages);
    const diagnosticFlags = new Set(
      conversation.diagnostics.flatMap((diagnostic) => parseIssueFlags(diagnostic.issueFlags))
    );
    const hasSupportWaitingDiagnostics = conversation.diagnostics.some(isSupportWaitingDiagnostic);
    const webhookFailureCount = conversation.webhookFailures.length;

    fallbackCount += conversationFallbacks;
    noReplyCount += conversationNoReplies;
    supportWaitingCount += conversationSupportWaiting;
    languageMismatchCount += conversationMismatches;

    if (conversationFallbacks > 0 || diagnosticFlags.has('fallback_reply')) labels.add('Fallback');
    if (conversationSupportWaiting > 0 || replyKinds.has('support_waiting') || hasSupportWaitingDiagnostics) {
      labels.add('Support waiting');
    }
    if (
      conversationNoReplies > 0 ||
      (diagnosticFlags.has('no_automated_reply') && !replyKinds.has('support_waiting') && !hasSupportWaitingDiagnostics)
    ) {
      labels.add('No bot reply');
    }
    if (conversationMismatches > 0 || diagnosticFlags.has('language_mismatch')) labels.add('Language mismatch');
    if (conversationRepeatedReplies > 0 || diagnosticFlags.has('repeated_reply')) labels.add('Repeated reply');
    if (conversation.escalations.length > 0 || diagnosticFlags.has('support_handoff')) labels.add('Support handoff');
    if (webhookFailureCount > 0) labels.add('Meta delivery failed');

    if (replyKinds.has('catalog') || replyKinds.has('empty_catalog')) catalogConversations += 1;
    if (replyKinds.has('order_summary') || conversation.messages.some((m) => /to proceed with the order/i.test(m.message))) {
      orderStartedConversations += 1;
    }
    if (
      replyKinds.has('order_confirmed') ||
      conversation.orders.some((order) => order.orderStatus !== 'cancelled')
    ) {
      orderConfirmedConversations += 1;
    }
    if (conversation.escalations.length > 0) {
      handoffConversations += 1;
    }

    const issueScore =
      conversationNoReplies * 32 +
      webhookFailureCount * 32 +
      conversationMismatches * 24 +
      conversationFallbacks * 18 +
      conversationRepeatedReplies * 10 +
      conversation.escalations.length * 8;
    const score = Math.max(0, Math.min(100, 100 - issueScore));

    if (labels.size > 0) {
      const lastCustomerMessage = getLatestMessage(conversation.messages, 'user');
      const lastAssistantMessage = getLatestMessage(conversation.messages, 'assistant');
      const issueLabels = Array.from(labels);

      problemConversations.push({
        key: conversation.key,
        senderId: conversation.senderId,
        channel: conversation.channel,
        brand: conversation.brand,
        customerName: conversation.customerName,
        latestAt: latestAt.toISOString(),
        latestAtLabel: formatDateTime(latestAt),
        userMessages: conversationUserMessages.length,
        assistantMessages: conversationAssistantMessages.length,
        fallbackCount: conversationFallbacks,
        handoffCount: conversation.escalations.length,
        noReplyCount: conversationNoReplies,
        supportWaitingCount: conversationSupportWaiting,
        languageMismatchCount: conversationMismatches,
        repeatedReplyCount: conversationRepeatedReplies,
        webhookFailureCount,
        orderCount: conversation.orders.length,
        conversionCount: conversation.orders.filter((order) => order.orderStatus !== 'cancelled').length,
        score,
        issueLabels,
        recommendation: deriveRecommendation(issueLabels),
        lastCustomerMessage: lastCustomerMessage?.message ?? null,
        lastAssistantMessage: lastAssistantMessage?.message ?? null,
        diagnosticSummary: latestDiagnostic
          ? {
              detectedLanguage: latestDiagnostic.detectedLanguage,
              replyLanguage: latestDiagnostic.replyLanguage,
              aiAction: latestDiagnostic.aiAction,
              effectiveAction: latestDiagnostic.effectiveAction,
              confidence: latestDiagnostic.aiConfidence,
              replyKind: latestDiagnostic.assistantReplyKind,
              supportMode: latestDiagnostic.supportMode,
              pendingStep: latestDiagnostic.pendingStep,
              hasReply: latestDiagnostic.hasReply,
              hasMedia: latestDiagnostic.hasMedia,
              orderId: latestDiagnostic.orderId,
              issueFlags: parseIssueFlags(latestDiagnostic.issueFlags),
            }
          : null,
        messages: conversation.messages.slice(-18).map((message) => ({
          id: message.id,
          role: message.role,
          text: message.message,
          language: detectCustomerLanguage(message.message) || 'unknown',
          replyKind: message.role === 'assistant' ? inferAssistantReplyKind(message.message) : 'customer',
          createdAt: message.createdAt.toISOString(),
          createdAtLabel: formatDateTime(message.createdAt),
        })),
        regressionSnippet: createRegressionSnippet(conversation),
      });
    }
  }

  const conversationCount = conversations.size;
  const handledMessages = assistantMessages + supportWaitingCount;
  const responseRate = userMessages > 0 ? handledMessages / userMessages : 0;
  const fallbackRate = userMessages > 0 ? fallbackCount / userMessages : 0;
  const noReplyRate = userMessages > 0 ? noReplyCount / userMessages : 0;
  const handoffRate = conversationCount > 0 ? handoffConversations / conversationCount : 0;
  const conversionRate = conversationCount > 0 ? orderConfirmedConversations / conversationCount : 0;
  const healthScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 -
          fallbackRate * 28 -
          noReplyRate * 35 -
          handoffRate * 18 -
          (languageMismatchCount / Math.max(1, userMessages)) * 22 -
          (input.webhookFailures.length / Math.max(1, userMessages)) * 30
      )
    )
  );
  const languageTotal = Array.from(languageCounts.values()).reduce((sum, count) => sum + count, 0);
  const channelTotal = Array.from(channelCounts.values()).reduce((sum, count) => sum + count, 0);

  return {
    generatedAt: now.toISOString(),
    windowDays: input.windowDays,
    healthScore,
    metrics: [
      {
        label: 'Bot health',
        value: `${healthScore}`,
        note: 'Composite score from fallback, no-reply, handoff, mismatch, and delivery failure rates.',
        tone: healthScore >= 85 ? 'good' : healthScore >= 70 ? 'warn' : 'bad',
      },
      {
        label: 'Handled rate',
        value: formatPct(Math.min(1, responseRate)),
        note:
          supportWaitingCount > 0
            ? `${assistantMessages} replies + ${supportWaitingCount} support holds for ${userMessages} customer messages.`
            : `${assistantMessages} assistant replies for ${userMessages} customer messages.`,
        tone: responseRate >= 0.9 ? 'good' : responseRate >= 0.75 ? 'warn' : 'bad',
      },
      {
        label: 'Fallback rate',
        value: formatPct(fallbackRate),
        note: `${fallbackCount} clarification replies detected.`,
        tone: fallbackRate <= 0.05 ? 'good' : fallbackRate <= 0.12 ? 'warn' : 'bad',
      },
      {
        label: 'Support handoff',
        value: formatPct(handoffRate),
        note: `${handoffConversations} conversations escalated or handed off.`,
        tone: handoffRate <= 0.08 ? 'good' : handoffRate <= 0.18 ? 'warn' : 'bad',
      },
      {
        label: 'Order conversion',
        value: formatPct(conversionRate),
        note: `${orderConfirmedConversations} conversations created a non-cancelled order.`,
        tone: conversionRate >= 0.12 ? 'good' : conversionRate >= 0.05 ? 'warn' : 'neutral',
      },
      {
        label: 'Language issues',
        value: String(languageMismatchCount),
        note: 'Detected user/reply language mismatches.',
        tone: languageMismatchCount === 0 ? 'good' : languageMismatchCount <= 2 ? 'warn' : 'bad',
      },
    ],
    funnel: {
      conversations: conversationCount,
      catalogShown: catalogConversations,
      orderStarted: orderStartedConversations,
      orderConfirmed: orderConfirmedConversations,
      supportHandoff: handoffConversations,
    },
    languageSplit: Array.from(languageCounts.entries())
      .map(([label, count]) => ({
        label,
        count,
        pct: languageTotal > 0 ? count / languageTotal : 0,
      }))
      .sort((a, b) => b.count - a.count),
    channelSplit: Array.from(channelCounts.entries())
      .map(([label, count]) => ({
        label,
        count,
        pct: channelTotal > 0 ? count / channelTotal : 0,
      }))
      .sort((a, b) => b.count - a.count),
    topQuestions: Array.from(questionCounts.values())
      .sort((a, b) => b.count - a.count || b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, 12),
    problemConversations: problemConversations
      .sort((a, b) => a.score - b.score || b.latestAt.localeCompare(a.latestAt))
      .slice(0, 30),
    recentFailures: input.webhookFailures.slice(0, 20).map((failure) => ({
      id: failure.id,
      channel: failure.channel,
      brand: failure.brand,
      senderId: failure.senderId,
      eventType: failure.eventType,
      error: failure.error,
      receivedAt: failure.receivedAt.toISOString(),
      receivedAtLabel: formatDateTime(failure.receivedAt),
    })),
  };
}
