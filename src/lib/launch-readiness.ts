import prisma from '@/lib/prisma';
import { logAdminAudit } from '@/lib/admin-audit';
import { getCourierWebhookSecret } from '@/lib/courier-webhook-secret';

export const CLEAN_LAUNCH_CONFIRMATION = 'DELETE TEST DATA';

export const CLEAN_LAUNCH_PRESERVED = [
  'Merchant settings and delivery rules',
  'Brand channel config and Meta tokens',
  'Courier webhook secret',
  'Bot training rules',
  'Admin audit log',
  'Configured users and roles',
];

type DeleteResult = { count: number };

interface ResetTarget {
  key: string;
  label: string;
  group: 'conversation' | 'commerce' | 'content' | 'operations' | 'catalog';
  count: () => Promise<number>;
  deleteMany: () => Promise<DeleteResult>;
}

export interface CleanLaunchResetCount {
  key: string;
  label: string;
  group: ResetTarget['group'];
  count: number;
}

export interface ProductCatalogIssueRow {
  id: number;
  sku: string | null;
  name: string;
  brand: string;
  status: string;
  price: number;
  stock: number;
  variantCount: number;
  totalVariantAvailable: number;
  issues: string[];
}

export interface ProductCatalogQualityReport {
  totalProducts: number;
  cleanProducts: number;
  issueProducts: number;
  issueCounts: Array<{ label: string; count: number }>;
  rows: ProductCatalogIssueRow[];
}

export interface ReliabilityCheck {
  label: string;
  status: 'good' | 'warn' | 'bad';
  value: string;
  detail: string;
}

export interface ProductionReliabilitySnapshot {
  checks: ReliabilityCheck[];
  recentFailures: Array<{
    source: string;
    status: string;
    detail: string;
    at: string;
  }>;
}

const BASE_RESET_TARGETS: ResetTarget[] = [
  {
    key: 'comment_reply_queue',
    label: 'Comment reply queue',
    group: 'conversation',
    count: () => prisma.commentReplyQueue.count(),
    deleteMany: () => prisma.commentReplyQueue.deleteMany(),
  },
  {
    key: 'comment_logs',
    label: 'Comment logs',
    group: 'conversation',
    count: () => prisma.commentLog.count(),
    deleteMany: () => prisma.commentLog.deleteMany(),
  },
  {
    key: 'comment_opt_outs',
    label: 'Comment opt-outs',
    group: 'conversation',
    count: () => prisma.commentOptOut.count(),
    deleteMany: () => prisma.commentOptOut.deleteMany(),
  },
  {
    key: 'webhook_events',
    label: 'Meta webhook event logs',
    group: 'conversation',
    count: () => prisma.webhookEventLog.count(),
    deleteMany: () => prisma.webhookEventLog.deleteMany(),
  },
  {
    key: 'automation_logs',
    label: 'Automation action logs',
    group: 'conversation',
    count: () => prisma.automationActionLog.count(),
    deleteMany: () => prisma.automationActionLog.deleteMany(),
  },
  {
    key: 'bot_diagnostics',
    label: 'Bot diagnostics',
    group: 'conversation',
    count: () => prisma.botMessageDiagnostic.count(),
    deleteMany: () => prisma.botMessageDiagnostic.deleteMany(),
  },
  {
    key: 'chat_messages',
    label: 'Chat messages',
    group: 'conversation',
    count: () => prisma.chatMessage.count(),
    deleteMany: () => prisma.chatMessage.deleteMany(),
  },
  {
    key: 'conversation_states',
    label: 'Conversation states',
    group: 'conversation',
    count: () => prisma.conversationState.count(),
    deleteMany: () => prisma.conversationState.deleteMany(),
  },
  {
    key: 'support_escalations',
    label: 'Support escalations',
    group: 'conversation',
    count: () => prisma.supportEscalation.count(),
    deleteMany: () => prisma.supportEscalation.deleteMany(),
  },
  {
    key: 'social_publish_logs',
    label: 'Social publish logs',
    group: 'content',
    count: () => prisma.socialPostPublishLog.count(),
    deleteMany: () => prisma.socialPostPublishLog.deleteMany(),
  },
  {
    key: 'social_post_creatives',
    label: 'Social post creative links',
    group: 'content',
    count: () => prisma.socialPostCreative.count(),
    deleteMany: () => prisma.socialPostCreative.deleteMany(),
  },
  {
    key: 'social_posts',
    label: 'Social posts',
    group: 'content',
    count: () => prisma.socialPost.count(),
    deleteMany: () => prisma.socialPost.deleteMany(),
  },
  {
    key: 'generated_creatives',
    label: 'Generated creatives',
    group: 'content',
    count: () => prisma.generatedCreative.count(),
    deleteMany: () => prisma.generatedCreative.deleteMany(),
  },
  {
    key: 'return_requests',
    label: 'Return and exchange requests',
    group: 'commerce',
    count: () => prisma.returnRequest.count(),
    deleteMany: () => prisma.returnRequest.deleteMany(),
  },
  {
    key: 'courier_webhook_logs',
    label: 'Courier webhook logs',
    group: 'commerce',
    count: () => prisma.courierWebhookEventLog.count(),
    deleteMany: () => prisma.courierWebhookEventLog.deleteMany(),
  },
  {
    key: 'fulfillment_events',
    label: 'Order fulfillment events',
    group: 'commerce',
    count: () => prisma.orderFulfillmentEvent.count(),
    deleteMany: () => prisma.orderFulfillmentEvent.deleteMany(),
  },
  {
    key: 'order_items',
    label: 'Order items',
    group: 'commerce',
    count: () => prisma.orderItem.count(),
    deleteMany: () => prisma.orderItem.deleteMany(),
  },
  {
    key: 'orders',
    label: 'Orders',
    group: 'commerce',
    count: () => prisma.order.count(),
    deleteMany: () => prisma.order.deleteMany(),
  },
  {
    key: 'customers',
    label: 'Customers',
    group: 'commerce',
    count: () => prisma.customer.count(),
    deleteMany: () => prisma.customer.deleteMany(),
  },
  {
    key: 'analytics_rows',
    label: 'Analytics rows',
    group: 'operations',
    count: () => prisma.analytics.count(),
    deleteMany: () => prisma.analytics.deleteMany(),
  },
  {
    key: 'production_batches',
    label: 'Production batches',
    group: 'operations',
    count: () => prisma.productionBatch.count(),
    deleteMany: () => prisma.productionBatch.deleteMany(),
  },
  {
    key: 'operator_outputs',
    label: 'Operator outputs',
    group: 'operations',
    count: () => prisma.operatorOutput.count(),
    deleteMany: () => prisma.operatorOutput.deleteMany(),
  },
  {
    key: 'operators',
    label: 'Operators',
    group: 'operations',
    count: () => prisma.operator.count(),
    deleteMany: () => prisma.operator.deleteMany(),
  },
  {
    key: 'fabric_rows',
    label: 'Fabric rows',
    group: 'operations',
    count: () => prisma.fabric.count(),
    deleteMany: () => prisma.fabric.deleteMany(),
  },
];

const CATALOG_RESET_TARGETS: ResetTarget[] = [
  {
    key: 'product_color_images',
    label: 'Product color images',
    group: 'catalog',
    count: () => prisma.productColorImage.count(),
    deleteMany: () => prisma.productColorImage.deleteMany(),
  },
  {
    key: 'variant_inventory',
    label: 'Variant inventory',
    group: 'catalog',
    count: () => prisma.variantInventory.count(),
    deleteMany: () => prisma.variantInventory.deleteMany(),
  },
  {
    key: 'product_variants',
    label: 'Product variants',
    group: 'catalog',
    count: () => prisma.productVariant.count(),
    deleteMany: () => prisma.productVariant.deleteMany(),
  },
  {
    key: 'product_inventory',
    label: 'Product inventory',
    group: 'catalog',
    count: () => prisma.inventory.count(),
    deleteMany: () => prisma.inventory.deleteMany(),
  },
  {
    key: 'products',
    label: 'Products',
    group: 'catalog',
    count: () => prisma.product.count(),
    deleteMany: () => prisma.product.deleteMany(),
  },
];

function getResetTargets(includeCatalog: boolean): ResetTarget[] {
  return includeCatalog
    ? [...BASE_RESET_TARGETS, ...CATALOG_RESET_TARGETS]
    : BASE_RESET_TARGETS;
}

function addIssue(issues: string[], issueCounts: Map<string, number>, issue: string) {
  issues.push(issue);
  issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1);
}

function hasProductDetailCopy(product: {
  style: string | null;
  fabric: string | null;
  fitType: string | null;
  neckline: string | null;
  patternDetails: string | null;
  aiFidelityNotes: string | null;
}): boolean {
  return Boolean(
    product.style?.trim() ||
      product.fabric?.trim() ||
      product.fitType?.trim() ||
      product.neckline?.trim() ||
      product.patternDetails?.trim() ||
      product.aiFidelityNotes?.trim()
  );
}

export async function getCleanLaunchResetPreview(includeCatalog = false): Promise<CleanLaunchResetCount[]> {
  const counts: CleanLaunchResetCount[] = [];

  for (const target of getResetTargets(includeCatalog)) {
    counts.push({
      key: target.key,
      label: target.label,
      group: target.group,
      count: await target.count(),
    });
  }

  return counts;
}

export async function runCleanLaunchReset({
  includeCatalog = false,
  actorEmail = null,
}: {
  includeCatalog?: boolean;
  actorEmail?: string | null;
}): Promise<CleanLaunchResetCount[]> {
  const deleted: CleanLaunchResetCount[] = [];

  for (const target of getResetTargets(includeCatalog)) {
    const result = await target.deleteMany();
    deleted.push({
      key: target.key,
      label: target.label,
      group: target.group,
      count: result.count,
    });
  }

  const total = deleted.reduce((sum, item) => sum + item.count, 0);

  await logAdminAudit({
    action: 'clean_launch_reset_applied',
    entityType: 'launch_readiness',
    entityId: includeCatalog ? 'with_catalog' : 'preserve_catalog',
    actorEmail,
    summary: `Clean launch reset removed ${total} test records${includeCatalog ? ', including product catalog data' : ''}.`,
    metadata: {
      includeCatalog,
      deleted,
      preserved: CLEAN_LAUNCH_PRESERVED,
    },
  });

  return deleted;
}

export async function getProductCatalogQualityReport(): Promise<ProductCatalogQualityReport> {
  const products = await prisma.product.findMany({
    orderBy: [
      { brand: 'asc' },
      { name: 'asc' },
    ],
    include: {
      inventory: true,
      colorImages: true,
      variants: {
        include: {
          inventory: true,
        },
      },
    },
  });
  const issueCounts = new Map<string, number>();
  const rows = products.map((product) => {
    const issues: string[] = [];
    const totalVariantAvailable = product.variants.reduce(
      (sum, variant) => sum + (variant.inventory?.availableQty ?? 0),
      0
    );

    if (!product.brand.trim()) addIssue(issues, issueCounts, 'Missing brand');
    if (!product.imageUrl && product.colorImages.length === 0) addIssue(issues, issueCounts, 'Missing image');
    if (!Number.isFinite(product.price) || product.price <= 0) addIssue(issues, issueCounts, 'Missing price');
    if (!product.sizes.trim()) addIssue(issues, issueCounts, 'Missing sizes');
    if (!product.colors.trim()) addIssue(issues, issueCounts, 'Missing colors');
    if (product.variants.length === 0) addIssue(issues, issueCounts, 'Missing variants');
    if (product.stock <= 0 && totalVariantAvailable <= 0) addIssue(issues, issueCounts, 'Missing stock');
    if (!hasProductDetailCopy(product)) addIssue(issues, issueCounts, 'Missing product details');

    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      brand: product.brand,
      status: product.status,
      price: product.price,
      stock: product.stock,
      variantCount: product.variants.length,
      totalVariantAvailable,
      issues,
    };
  });

  return {
    totalProducts: products.length,
    cleanProducts: rows.filter((row) => row.issues.length === 0).length,
    issueProducts: rows.filter((row) => row.issues.length > 0).length,
    issueCounts: Array.from(issueCounts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    rows: rows
      .filter((row) => row.issues.length > 0)
      .sort((a, b) => b.issues.length - a.issues.length || a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name)),
  };
}

function statusFromFailures(failures: number, total: number): ReliabilityCheck['status'] {
  if (failures === 0) return 'good';
  if (failures <= Math.max(2, total * 0.08)) return 'warn';
  return 'bad';
}

function formatDateTime(date: Date | null | undefined): string {
  if (!date) return 'Never';

  return new Intl.DateTimeFormat('en-LK', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Colombo',
  }).format(date);
}

export async function getProductionReliabilitySnapshot(): Promise<ProductionReliabilitySnapshot> {
  const since = new Date(Date.now() - 30 * 86400000);
  let dbOk = false;

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const channelConfigs = await prisma.brandChannelConfig.findMany({
    select: {
      brand: true,
      facebookPageId: true,
      facebookPageAccessToken: true,
      instagramAccountId: true,
      instagramAccessToken: true,
    },
    orderBy: { brand: 'asc' },
  });
  const merchantSettings = await prisma.merchantSettings.findFirst({
    where: { storeKey: 'default' },
    select: { courierWebhookSecret: true },
  });
  const metaFailures = await prisma.webhookEventLog.count({ where: { status: 'failed', receivedAt: { gte: since } } });
  const metaTotal = await prisma.webhookEventLog.count({ where: { receivedAt: { gte: since } } });
  const courierFailures = await prisma.courierWebhookEventLog.count({ where: { status: 'failed', receivedAt: { gte: since } } });
  const courierTotal = await prisma.courierWebhookEventLog.count({ where: { receivedAt: { gte: since } } });
  const commentFailures = await prisma.commentReplyQueue.count({ where: { status: 'failed', updatedAt: { gte: since } } });
  const automationFailures = await prisma.automationActionLog.count({ where: { status: 'failed', updatedAt: { gte: since } } });
  const socialPublishFailures = await prisma.socialPostPublishLog.count({ where: { status: 'failed', createdAt: { gte: since } } });
  const lastBotReply = await prisma.chatMessage.findFirst({
    where: { role: 'assistant' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, channel: true },
  });
  const lastCustomerMessage = await prisma.chatMessage.findFirst({
    where: { role: 'user' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, channel: true },
  });
  const lastMetaWebhook = await prisma.webhookEventLog.findFirst({
    orderBy: { receivedAt: 'desc' },
    select: { receivedAt: true, channel: true, status: true },
  });
  const lastCourierWebhook = await prisma.courierWebhookEventLog.findFirst({
    orderBy: { receivedAt: 'desc' },
    select: { receivedAt: true, provider: true, status: true },
  });
  const lastAutomationSend = await prisma.automationActionLog.findFirst({
    where: { deliveryStatus: 'sent' },
    orderBy: { sentAt: 'desc' },
    select: { sentAt: true, action: true, channel: true },
  });
  const recentMetaFailures = await prisma.webhookEventLog.findMany({
    where: { status: 'failed' },
    orderBy: { receivedAt: 'desc' },
    take: 4,
    select: { channel: true, eventType: true, error: true, receivedAt: true },
  });
  const recentCourierFailures = await prisma.courierWebhookEventLog.findMany({
    where: { status: 'failed' },
    orderBy: { receivedAt: 'desc' },
    take: 4,
    select: { provider: true, courierStatus: true, error: true, receivedAt: true },
  });
  const recentAutomationFailures = await prisma.automationActionLog.findMany({
    where: { status: 'failed' },
    orderBy: { updatedAt: 'desc' },
    take: 4,
    select: { action: true, channel: true, error: true, updatedAt: true },
  });

  const courierSecret = process.env.COURIER_WEBHOOK_SECRET || merchantSettings?.courierWebhookSecret || await getCourierWebhookSecret();
  const metaReadyBrands = channelConfigs.filter(
    (config) =>
      (config.facebookPageId && config.facebookPageAccessToken) ||
      (config.instagramAccountId && config.instagramAccessToken)
  );
  const queueFailures = commentFailures + automationFailures + socialPublishFailures;
  const metaStatus = statusFromFailures(metaFailures, metaTotal);
  const courierStatus = statusFromFailures(courierFailures, courierTotal);
  const queueStatus = queueFailures === 0 ? 'good' : queueFailures <= 3 ? 'warn' : 'bad';

  return {
    checks: [
      {
        label: 'Database',
        status: dbOk ? 'good' : 'bad',
        value: dbOk ? 'Healthy' : 'Unavailable',
        detail: dbOk ? 'Prisma query succeeded.' : 'Prisma could not complete a health query.',
      },
      {
        label: 'Meta config',
        status: metaReadyBrands.length > 0 ? 'good' : 'warn',
        value: `${metaReadyBrands.length}/${channelConfigs.length}`,
        detail: 'Brands with a configured Page or Instagram account plus token.',
      },
      {
        label: 'Meta webhooks',
        status: metaStatus,
        value: `${metaFailures} failed`,
        detail: `${metaTotal} webhook events in the last 30 days. Last: ${lastMetaWebhook ? `${lastMetaWebhook.channel} ${lastMetaWebhook.status} ${formatDateTime(lastMetaWebhook.receivedAt)}` : 'none'}.`,
      },
      {
        label: 'Courier webhooks',
        status: courierSecret ? courierStatus : 'warn',
        value: courierSecret ? `${courierFailures} failed` : 'No secret',
        detail: `${courierTotal} courier events in the last 30 days. Last: ${lastCourierWebhook ? `${lastCourierWebhook.provider} ${lastCourierWebhook.status} ${formatDateTime(lastCourierWebhook.receivedAt)}` : 'none'}.`,
      },
      {
        label: 'Queue failures',
        status: queueStatus,
        value: `${queueFailures}`,
        detail: `${commentFailures} comment, ${automationFailures} automation, ${socialPublishFailures} social publish failures in 30 days.`,
      },
      {
        label: 'Bot activity',
        status: lastBotReply ? 'good' : lastCustomerMessage ? 'bad' : 'warn',
        value: lastBotReply ? formatDateTime(lastBotReply.createdAt) : 'No reply',
        detail: lastCustomerMessage
          ? `Last customer message: ${lastCustomerMessage.channel} ${formatDateTime(lastCustomerMessage.createdAt)}.`
          : 'No customer messages recorded yet.',
      },
      {
        label: 'Meta delivery',
        status: lastAutomationSend ? 'good' : 'warn',
        value: lastAutomationSend?.sentAt ? formatDateTime(lastAutomationSend.sentAt) : 'No sends',
        detail: lastAutomationSend
          ? `${lastAutomationSend.action} sent on ${lastAutomationSend.channel}.`
          : 'No successful automation delivery has been logged yet.',
      },
    ],
    recentFailures: [
      ...recentMetaFailures.map((failure) => ({
        source: 'Meta webhook',
        status: failure.channel,
        detail: `${failure.eventType}: ${failure.error || 'Unknown error'}`,
        at: formatDateTime(failure.receivedAt),
      })),
      ...recentCourierFailures.map((failure) => ({
        source: 'Courier webhook',
        status: failure.provider,
        detail: `${failure.courierStatus}: ${failure.error || 'Unknown error'}`,
        at: formatDateTime(failure.receivedAt),
      })),
      ...recentAutomationFailures.map((failure) => ({
        source: 'Automation',
        status: `${failure.action}/${failure.channel}`,
        detail: failure.error || 'Unknown error',
        at: formatDateTime(failure.updatedAt),
      })),
    ].slice(0, 10),
  };
}
