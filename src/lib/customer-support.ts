import prisma from '@/lib/prisma';
import {
  getDefaultMerchantSettings,
  getMerchantSettings,
  type MerchantSupportSettings,
} from '@/lib/runtime-config';

export type SupportIssueReason =
  | 'human_request'
  | 'delivery_issue'
  | 'payment_issue'
  | 'refund_or_damage'
  | 'return_request'
  | 'exchange_request'
  | 'unclear_request';

interface SupportEscalationInput {
  senderId: string;
  channel: string;
  customerId?: number | null;
  orderId?: number | null;
  brand?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  latestCustomerMessage: string;
  reason: SupportIssueReason;
  summary: string;
}

export type SupportContactConfig = MerchantSupportSettings;

const SUPPORT_REASON_LABELS: Record<SupportIssueReason, string> = {
  human_request: 'support request',
  delivery_issue: 'delivery issue',
  payment_issue: 'payment issue',
  refund_or_damage: 'order issue',
  return_request: 'return request',
  exchange_request: 'exchange request',
  unclear_request: 'clarification request',
};

function cleanSupportContactValue(value?: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function formatSupportContactLine(
  config: SupportContactConfig,
  options?: { orderId?: number | null }
): string {
  const directPhone = config.phone;
  const directWhatsapp = config.whatsapp;
  const orderReference = options?.orderId
    ? directPhone || directWhatsapp
      ? ` Please mention order #${options.orderId} when you contact us.`
      : ` Please mention order #${options.orderId} in your message.`
    : '';

  if (!directPhone && !directWhatsapp) {
    return `Please reply here and our support team will follow up during ${config.hours}.${orderReference}`;
  }

  if (directPhone && directWhatsapp && directPhone === directWhatsapp) {
    return `Please call or WhatsApp our team on ${directPhone} during ${config.hours}.${orderReference}`;
  }

  if (directPhone && directWhatsapp) {
    return `Please call our team on ${directPhone} or WhatsApp ${directWhatsapp} during ${config.hours}.${orderReference}`;
  }

  if (directPhone) {
    return `Please call our team on ${directPhone} during ${config.hours}.${orderReference}`;
  }

  return `Please WhatsApp our team on ${directWhatsapp} during ${config.hours}.${orderReference}`;
}

export function getDefaultSupportContactConfig(): SupportContactConfig {
  return getDefaultMerchantSettings().support;
}

export async function getSupportContactConfig(brand?: string | null): Promise<SupportContactConfig> {
  return (await getMerchantSettings(brand)).support;
}

export function getSupportContactConfigSync(): SupportContactConfig {
  const phone = cleanSupportContactValue(process.env.STORE_SUPPORT_PHONE);
  const whatsapp = cleanSupportContactValue(process.env.STORE_SUPPORT_WHATSAPP) || phone;
  const defaults = getDefaultSupportContactConfig();

  return {
    ...defaults,
    phone,
    whatsapp,
    hours: process.env.STORE_SUPPORT_HOURS?.trim() || defaults.hours,
  };
}

export function hasDirectSupportContactConfigured(): boolean {
  const config = getSupportContactConfigSync();
  return Boolean(config.phone || config.whatsapp);
}

export async function hasDirectSupportContactConfiguredForBrand(brand?: string | null): Promise<boolean> {
  const config = await getSupportContactConfig(brand);
  return Boolean(config.phone || config.whatsapp);
}

export function getSupportReasonLabel(reason: SupportIssueReason): string {
  return SUPPORT_REASON_LABELS[reason];
}

export function buildSupportContactLine(options?: { orderId?: number | null }): string {
  return formatSupportContactLine(getSupportContactConfigSync(), options);
}

export function buildSupportContactLineFromConfig(
  config: SupportContactConfig,
  options?: { orderId?: number | null }
): string {
  return formatSupportContactLine(config, options);
}

export async function buildSupportContactLineForBrand(
  brand?: string | null,
  options?: { orderId?: number | null }
): Promise<string> {
  return formatSupportContactLine(await getSupportContactConfig(brand), options);
}

export function buildSupportContactReply(options?: {
  orderId?: number | null;
  supportConfig?: SupportContactConfig;
}): string {
  const contactLine = options?.supportConfig
    ? buildSupportContactLineFromConfig(options.supportConfig, options)
    : buildSupportContactLine(options);

  return `You can reach our support team directly. ${contactLine}`;
}

export function buildSupportContactAcknowledgement(options?: {
  orderId?: number | null;
  supportConfig?: SupportContactConfig;
}): string {
  const contactLine = options?.supportConfig
    ? buildSupportContactLineFromConfig(options.supportConfig, options)
    : buildSupportContactLine(options);

  return `You are welcome. ${contactLine}`;
}

export function buildSupportWaitingReply(params: {
  mode: 'handoff_requested' | 'human_active';
  orderId?: number | null;
  supportConfig?: SupportContactConfig;
}): string {
  const contactLine = params.supportConfig
    ? buildSupportContactLineFromConfig(params.supportConfig, { orderId: params.orderId })
    : buildSupportContactLine({ orderId: params.orderId });

  if (params.mode === 'human_active') {
    return `A support team member is already handling this conversation. ${contactLine}`;
  }

  return `Our support team has your message and will follow up shortly. ${contactLine}`;
}

export function buildHumanSupportReply(params: {
  reason: SupportIssueReason;
  orderId?: number | null;
  supportConfig?: SupportContactConfig;
}): string {
  const contactLine = params.supportConfig
    ? buildSupportContactLineFromConfig(params.supportConfig, { orderId: params.orderId })
    : buildSupportContactLine({ orderId: params.orderId });
  const handoffLead =
    params.supportConfig?.handoffMessage?.trim() ||
    `I want to make sure you get the right help for this ${getSupportReasonLabel(
      params.reason
    )}.`;

  return `${handoffLead} ${contactLine} I have also flagged this conversation for a team follow-up.`;
}

export function buildSupportConversationSummary(params: {
  reason: SupportIssueReason;
  currentMessage: string;
  recentMessages: Array<{ role: string; message: string }>;
  orderId?: number | null;
}): string {
  const transcript = [...params.recentMessages, { role: 'user', message: params.currentMessage }]
    .slice(-6)
    .map((message) => `${message.role === 'assistant' ? 'Bot' : 'Customer'}: ${message.message}`)
    .join('\n');

  return [
    `Issue type: ${getSupportReasonLabel(params.reason)}`,
    params.orderId ? `Related order: #${params.orderId}` : '',
    `Latest customer message: ${params.currentMessage}`,
    '',
    'Recent conversation:',
    transcript,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function upsertSupportEscalation(input: SupportEscalationInput) {
  const latestOpenEscalation = await prisma.supportEscalation.findFirst({
    where: {
      senderId: input.senderId,
      channel: input.channel,
      status: {
        not: 'resolved',
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  if (latestOpenEscalation) {
    return prisma.supportEscalation.update({
      where: {
        id: latestOpenEscalation.id,
      },
      data: {
        customerId: input.customerId || null,
        orderId: input.orderId || null,
        brand: input.brand || null,
        reason: input.reason,
        contactName: input.contactName || null,
        contactPhone: input.contactPhone || null,
        latestCustomerMessage: input.latestCustomerMessage,
        summary: input.summary,
        status: 'open',
      },
    });
  }

  return prisma.supportEscalation.create({
    data: {
      senderId: input.senderId,
      channel: input.channel,
      customerId: input.customerId || null,
      orderId: input.orderId || null,
      brand: input.brand || null,
      reason: input.reason,
      status: 'open',
      contactName: input.contactName || null,
      contactPhone: input.contactPhone || null,
      latestCustomerMessage: input.latestCustomerMessage,
      summary: input.summary,
    },
  });
}
