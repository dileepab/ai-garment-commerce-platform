import prisma from '@/lib/prisma';

const warnedKeys = new Set<string>();

export const DEFAULT_STORE_KEY = 'default';
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

export interface RuntimeWarning {
  key: string;
  level: 'warning' | 'info';
  message: string;
}

export interface MerchantDeliverySettings {
  colomboCharge: number;
  outsideColomboCharge: number;
  colomboEstimate: string;
  outsideColomboEstimate: string;
}

export interface MerchantPaymentSettings {
  methods: string[];
  defaultMethod: string;
  onlineTransferLabel: string;
}

export interface MerchantSupportSettings {
  phone: string | null;
  whatsapp: string | null;
  hours: string;
  handoffMessage: string | null;
  processingErrorMessage: string;
}

export interface MerchantAutomationSettings {
  cartRecoveryEnabled: boolean;
  cartRecoveryDelayHours: number;
  cartRecoveryCooldownHours: number;
  supportTimeoutEnabled: boolean;
  supportTimeoutDelayHours: number;
  supportTimeoutCooldownHours: number;
  postOrderFollowUpEnabled: boolean;
  postOrderFollowUpDelayDays: number;
  postOrderFollowUpWindowDays: number;
  reorderReminderEnabled: boolean;
  reorderReminderDelayDays: number;
  reorderReminderWindowDays: number;
  purchaseNudgeCooldownDays: number;
}

export interface MerchantAutomationPolicy {
  cartRecoveryEnabled: boolean;
  cartRecoveryDelayMs: number;
  cartRecoveryCooldownMs: number;
  supportTimeoutEnabled: boolean;
  supportTimeoutDelayMs: number;
  supportTimeoutCooldownMs: number;
  postOrderFollowUpEnabled: boolean;
  postOrderFollowUpDelayMs: number;
  postOrderFollowUpWindowMs: number;
  reorderReminderEnabled: boolean;
  reorderReminderDelayMs: number;
  reorderReminderWindowMs: number;
  purchaseNudgeCooldownMs: number;
}

export interface MerchantSettings {
  storeKey: string;
  brand: string | null;
  displayName: string;
  support: MerchantSupportSettings;
  delivery: MerchantDeliverySettings;
  payment: MerchantPaymentSettings;
  automation: MerchantAutomationSettings;
}

interface MerchantSettingsRecord {
  storeKey: string;
  brand: string | null;
  displayName: string | null;
  supportPhone: string | null;
  supportWhatsapp: string | null;
  supportHours: string;
  supportHandoffMessage: string | null;
  processingErrorMessage: string | null;
  paymentMethods: string;
  defaultPaymentMethod: string;
  onlineTransferLabel: string;
  deliveryColomboCharge: number;
  deliveryOutsideColomboCharge: number;
  deliveryColomboEstimate: string;
  deliveryOutsideColomboEstimate: string;
  cartRecoveryEnabled: boolean;
  cartRecoveryDelayHours: number;
  cartRecoveryCooldownHours: number;
  supportTimeoutEnabled: boolean;
  supportTimeoutDelayHours: number;
  supportTimeoutCooldownHours: number;
  postOrderFollowUpEnabled: boolean;
  postOrderFollowUpDelayDays: number;
  postOrderFollowUpWindowDays: number;
  reorderReminderEnabled: boolean;
  reorderReminderDelayDays: number;
  reorderReminderWindowDays: number;
  purchaseNudgeCooldownDays: number;
}

export interface MerchantSettingsFormInput {
  brand?: string | null;
  displayName?: string | null;
  supportPhone?: string | null;
  supportWhatsapp?: string | null;
  supportHours?: string | null;
  supportHandoffMessage?: string | null;
  processingErrorMessage?: string | null;
  paymentMethods?: string[];
  defaultPaymentMethod?: string | null;
  onlineTransferLabel?: string | null;
  deliveryColomboCharge?: number | null;
  deliveryOutsideColomboCharge?: number | null;
  deliveryColomboEstimate?: string | null;
  deliveryOutsideColomboEstimate?: string | null;
  cartRecoveryEnabled?: boolean;
  cartRecoveryDelayHours?: number | null;
  cartRecoveryCooldownHours?: number | null;
  supportTimeoutEnabled?: boolean;
  supportTimeoutDelayHours?: number | null;
  supportTimeoutCooldownHours?: number | null;
  postOrderFollowUpEnabled?: boolean;
  postOrderFollowUpDelayDays?: number | null;
  postOrderFollowUpWindowDays?: number | null;
  reorderReminderEnabled?: boolean;
  reorderReminderDelayDays?: number | null;
  reorderReminderWindowDays?: number | null;
  purchaseNudgeCooldownDays?: number | null;
}

function cleanOptionalText(value?: string | null): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function cleanText(value?: string | null, fallback = ''): string {
  return cleanOptionalText(value) ?? fallback;
}

function parseList(value?: string | null): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizePositiveInteger(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

export function getMerchantSettingsStoreKey(brand?: string | null): string {
  const cleanedBrand = cleanOptionalText(brand);
  return cleanedBrand ? `brand:${cleanedBrand.toLowerCase()}` : DEFAULT_STORE_KEY;
}

export function getDefaultMerchantSettings(): MerchantSettings {
  const phone = cleanOptionalText(process.env.STORE_SUPPORT_PHONE);
  const whatsapp = cleanOptionalText(process.env.STORE_SUPPORT_WHATSAPP) || phone;

  return {
    storeKey: DEFAULT_STORE_KEY,
    brand: null,
    displayName: 'GarmentOS',
    support: {
      phone,
      whatsapp,
      hours: cleanText(process.env.STORE_SUPPORT_HOURS, '9:00 AM to 6:00 PM'),
      handoffMessage: null,
      processingErrorMessage:
        'Sorry, something went wrong while handling your last message. Please reply once more, or contact support if it is urgent.',
    },
    delivery: {
      colomboCharge: 150,
      outsideColomboCharge: 200,
      colomboEstimate: '1-2 business days',
      outsideColomboEstimate: '2-3 business days',
    },
    payment: {
      methods: ['COD', 'Online Transfer'],
      defaultMethod: 'COD',
      onlineTransferLabel: 'Online Transfer',
    },
    automation: {
      cartRecoveryEnabled: true,
      cartRecoveryDelayHours: 12,
      cartRecoveryCooldownHours: 72,
      supportTimeoutEnabled: true,
      supportTimeoutDelayHours: 24,
      supportTimeoutCooldownHours: 48,
      postOrderFollowUpEnabled: true,
      postOrderFollowUpDelayDays: 3,
      postOrderFollowUpWindowDays: 21,
      reorderReminderEnabled: true,
      reorderReminderDelayDays: 45,
      reorderReminderWindowDays: 120,
      purchaseNudgeCooldownDays: 14,
    },
  };
}

function overlayMerchantSettings(
  base: MerchantSettings,
  record: MerchantSettingsRecord,
  inheritBlankText: boolean
): MerchantSettings {
  const textValue = (value: string | null, fallback: string): string => {
    const cleaned = cleanOptionalText(value);
    if (cleaned) return cleaned;
    return inheritBlankText ? fallback : '';
  };

  const nullableTextValue = (value: string | null, fallback: string | null): string | null => {
    const cleaned = cleanOptionalText(value);
    if (cleaned) return cleaned;
    return inheritBlankText ? fallback : null;
  };

  const methods = uniqueList(parseList(record.paymentMethods));
  const paymentMethods = methods.length > 0
    ? methods
    : inheritBlankText
      ? base.payment.methods
      : ['COD', 'Online Transfer'];
  const defaultPaymentMethod = paymentMethods.includes(record.defaultPaymentMethod)
    ? record.defaultPaymentMethod
    : paymentMethods.includes(base.payment.defaultMethod)
      ? base.payment.defaultMethod
      : paymentMethods[0] || 'COD';
  const onlineTransferLabel =
    cleanOptionalText(record.onlineTransferLabel) ||
    (paymentMethods.includes(base.payment.onlineTransferLabel)
      ? base.payment.onlineTransferLabel
      : paymentMethods.find((method) => /online|bank|transfer/i.test(method)) || 'Online Transfer');

  return {
    storeKey: record.storeKey,
    brand: cleanOptionalText(record.brand),
    displayName: textValue(record.displayName, base.displayName),
    support: {
      phone: nullableTextValue(record.supportPhone, base.support.phone),
      whatsapp: nullableTextValue(record.supportWhatsapp, base.support.whatsapp),
      hours: textValue(record.supportHours, base.support.hours) || base.support.hours,
      handoffMessage: nullableTextValue(record.supportHandoffMessage, base.support.handoffMessage),
      processingErrorMessage:
        textValue(record.processingErrorMessage, base.support.processingErrorMessage) ||
        base.support.processingErrorMessage,
    },
    delivery: {
      colomboCharge: normalizePositiveInteger(record.deliveryColomboCharge, base.delivery.colomboCharge),
      outsideColomboCharge: normalizePositiveInteger(
        record.deliveryOutsideColomboCharge,
        base.delivery.outsideColomboCharge
      ),
      colomboEstimate: textValue(record.deliveryColomboEstimate, base.delivery.colomboEstimate) || base.delivery.colomboEstimate,
      outsideColomboEstimate:
        textValue(record.deliveryOutsideColomboEstimate, base.delivery.outsideColomboEstimate) ||
        base.delivery.outsideColomboEstimate,
    },
    payment: {
      methods: paymentMethods,
      defaultMethod: defaultPaymentMethod,
      onlineTransferLabel,
    },
    automation: {
      cartRecoveryEnabled: record.cartRecoveryEnabled,
      cartRecoveryDelayHours: normalizePositiveInteger(
        record.cartRecoveryDelayHours,
        base.automation.cartRecoveryDelayHours
      ),
      cartRecoveryCooldownHours: normalizePositiveInteger(
        record.cartRecoveryCooldownHours,
        base.automation.cartRecoveryCooldownHours
      ),
      supportTimeoutEnabled: record.supportTimeoutEnabled,
      supportTimeoutDelayHours: normalizePositiveInteger(
        record.supportTimeoutDelayHours,
        base.automation.supportTimeoutDelayHours
      ),
      supportTimeoutCooldownHours: normalizePositiveInteger(
        record.supportTimeoutCooldownHours,
        base.automation.supportTimeoutCooldownHours
      ),
      postOrderFollowUpEnabled: record.postOrderFollowUpEnabled,
      postOrderFollowUpDelayDays: normalizePositiveInteger(
        record.postOrderFollowUpDelayDays,
        base.automation.postOrderFollowUpDelayDays
      ),
      postOrderFollowUpWindowDays: normalizePositiveInteger(
        record.postOrderFollowUpWindowDays,
        base.automation.postOrderFollowUpWindowDays
      ),
      reorderReminderEnabled: record.reorderReminderEnabled,
      reorderReminderDelayDays: normalizePositiveInteger(
        record.reorderReminderDelayDays,
        base.automation.reorderReminderDelayDays
      ),
      reorderReminderWindowDays: normalizePositiveInteger(
        record.reorderReminderWindowDays,
        base.automation.reorderReminderWindowDays
      ),
      purchaseNudgeCooldownDays: normalizePositiveInteger(
        record.purchaseNudgeCooldownDays,
        base.automation.purchaseNudgeCooldownDays
      ),
    },
  };
}

function warnSettingsReadError(error: unknown) {
  const key = 'merchant-settings-read-error';

  if (warnedKeys.has(key)) {
    return;
  }

  warnedKeys.add(key);
  console.warn('[Runtime Config] Merchant settings could not be read; using built-in defaults.', error);
}

export async function getMerchantSettings(brand?: string | null): Promise<MerchantSettings> {
  const defaults = getDefaultMerchantSettings();
  const cleanedBrand = cleanOptionalText(brand);
  const storeKey = getMerchantSettingsStoreKey(cleanedBrand);

  try {
    const records = await prisma.merchantSettings.findMany({
      where: {
        storeKey: {
          in: cleanedBrand ? [DEFAULT_STORE_KEY, storeKey] : [DEFAULT_STORE_KEY],
        },
      },
    });
    const globalRecord = records.find((record) => record.storeKey === DEFAULT_STORE_KEY) as MerchantSettingsRecord | undefined;
    const scopedRecord = cleanedBrand
      ? records.find((record) => record.storeKey === storeKey) as MerchantSettingsRecord | undefined
      : null;
    const globalSettings = globalRecord
      ? overlayMerchantSettings(defaults, globalRecord, false)
      : defaults;

    return scopedRecord
      ? overlayMerchantSettings(globalSettings, scopedRecord, true)
      : {
          ...globalSettings,
          storeKey,
          brand: cleanedBrand ?? null,
          displayName: cleanedBrand ?? globalSettings.displayName,
        };
  } catch (error) {
    warnSettingsReadError(error);
    return {
      ...defaults,
      storeKey,
      brand: cleanedBrand ?? null,
      displayName: cleanedBrand ?? defaults.displayName,
    };
  }
}

export function buildMerchantSettingsPersistenceInput(input: MerchantSettingsFormInput) {
  const brand = cleanOptionalText(input.brand);
  const storeKey = getMerchantSettingsStoreKey(brand);
  const defaults = getDefaultMerchantSettings();
  const paymentMethods = uniqueList(
    input.paymentMethods && input.paymentMethods.length > 0
      ? input.paymentMethods
      : defaults.payment.methods
  );
  const defaultPaymentMethod =
    cleanOptionalText(input.defaultPaymentMethod) &&
    paymentMethods.includes(cleanOptionalText(input.defaultPaymentMethod)!)
      ? cleanOptionalText(input.defaultPaymentMethod)!
      : paymentMethods[0] || defaults.payment.defaultMethod;
  const onlineTransferLabel =
    cleanOptionalText(input.onlineTransferLabel) ||
    paymentMethods.find((method) => /online|bank|transfer/i.test(method)) ||
    defaults.payment.onlineTransferLabel;

  return {
    storeKey,
    brand,
    displayName: cleanOptionalText(input.displayName) || brand || defaults.displayName,
    supportPhone: cleanOptionalText(input.supportPhone),
    supportWhatsapp: cleanOptionalText(input.supportWhatsapp),
    supportHours: cleanText(input.supportHours, defaults.support.hours),
    supportHandoffMessage: cleanOptionalText(input.supportHandoffMessage),
    processingErrorMessage: cleanText(
      input.processingErrorMessage,
      defaults.support.processingErrorMessage
    ),
    paymentMethods: paymentMethods.join(','),
    defaultPaymentMethod,
    onlineTransferLabel,
    deliveryColomboCharge: normalizePositiveInteger(
      input.deliveryColomboCharge,
      defaults.delivery.colomboCharge
    ),
    deliveryOutsideColomboCharge: normalizePositiveInteger(
      input.deliveryOutsideColomboCharge,
      defaults.delivery.outsideColomboCharge
    ),
    deliveryColomboEstimate: cleanText(
      input.deliveryColomboEstimate,
      defaults.delivery.colomboEstimate
    ),
    deliveryOutsideColomboEstimate: cleanText(
      input.deliveryOutsideColomboEstimate,
      defaults.delivery.outsideColomboEstimate
    ),
    cartRecoveryEnabled: Boolean(input.cartRecoveryEnabled),
    cartRecoveryDelayHours: normalizePositiveInteger(
      input.cartRecoveryDelayHours,
      defaults.automation.cartRecoveryDelayHours
    ),
    cartRecoveryCooldownHours: normalizePositiveInteger(
      input.cartRecoveryCooldownHours,
      defaults.automation.cartRecoveryCooldownHours
    ),
    supportTimeoutEnabled: Boolean(input.supportTimeoutEnabled),
    supportTimeoutDelayHours: normalizePositiveInteger(
      input.supportTimeoutDelayHours,
      defaults.automation.supportTimeoutDelayHours
    ),
    supportTimeoutCooldownHours: normalizePositiveInteger(
      input.supportTimeoutCooldownHours,
      defaults.automation.supportTimeoutCooldownHours
    ),
    postOrderFollowUpEnabled: Boolean(input.postOrderFollowUpEnabled),
    postOrderFollowUpDelayDays: normalizePositiveInteger(
      input.postOrderFollowUpDelayDays,
      defaults.automation.postOrderFollowUpDelayDays
    ),
    postOrderFollowUpWindowDays: normalizePositiveInteger(
      input.postOrderFollowUpWindowDays,
      defaults.automation.postOrderFollowUpWindowDays
    ),
    reorderReminderEnabled: Boolean(input.reorderReminderEnabled),
    reorderReminderDelayDays: normalizePositiveInteger(
      input.reorderReminderDelayDays,
      defaults.automation.reorderReminderDelayDays
    ),
    reorderReminderWindowDays: normalizePositiveInteger(
      input.reorderReminderWindowDays,
      defaults.automation.reorderReminderWindowDays
    ),
    purchaseNudgeCooldownDays: normalizePositiveInteger(
      input.purchaseNudgeCooldownDays,
      defaults.automation.purchaseNudgeCooldownDays
    ),
  };
}

export function getMerchantAutomationPolicy(
  settings: MerchantSettings
): MerchantAutomationPolicy {
  return {
    cartRecoveryEnabled: settings.automation.cartRecoveryEnabled,
    cartRecoveryDelayMs: settings.automation.cartRecoveryDelayHours * ONE_HOUR_MS,
    cartRecoveryCooldownMs: settings.automation.cartRecoveryCooldownHours * ONE_HOUR_MS,
    supportTimeoutEnabled: settings.automation.supportTimeoutEnabled,
    supportTimeoutDelayMs: settings.automation.supportTimeoutDelayHours * ONE_HOUR_MS,
    supportTimeoutCooldownMs: settings.automation.supportTimeoutCooldownHours * ONE_HOUR_MS,
    postOrderFollowUpEnabled: settings.automation.postOrderFollowUpEnabled,
    postOrderFollowUpDelayMs: settings.automation.postOrderFollowUpDelayDays * ONE_DAY_MS,
    postOrderFollowUpWindowMs: settings.automation.postOrderFollowUpWindowDays * ONE_DAY_MS,
    reorderReminderEnabled: settings.automation.reorderReminderEnabled,
    reorderReminderDelayMs: settings.automation.reorderReminderDelayDays * ONE_DAY_MS,
    reorderReminderWindowMs: settings.automation.reorderReminderWindowDays * ONE_DAY_MS,
    purchaseNudgeCooldownMs: settings.automation.purchaseNudgeCooldownDays * ONE_DAY_MS,
  };
}

export function describeDeliveryCharges(settings: MerchantSettings): string {
  return `Delivery charges are Rs ${settings.delivery.colomboCharge} within Colombo and Rs ${settings.delivery.outsideColomboCharge} outside Colombo.`;
}

export function describeDeliveryEstimates(settings: MerchantSettings): string {
  return `Delivery usually takes ${settings.delivery.colomboEstimate} within Colombo and ${settings.delivery.outsideColomboEstimate} outside Colombo, excluding weekends and Sri Lankan public holidays.`;
}

export function resolvePaymentMethod(
  requestedMethod: string | null | undefined,
  message: string | null | undefined,
  settings: MerchantSettings
): string {
  const normalizedRequested = cleanOptionalText(requestedMethod);
  const directMatch = normalizedRequested
    ? settings.payment.methods.find(
        (method) => method.toLowerCase() === normalizedRequested.toLowerCase()
      )
    : null;

  if (directMatch) {
    return directMatch;
  }

  const normalizedMessage = message?.toLowerCase() || '';
  const onlineMethod = settings.payment.methods.find(
    (method) =>
      method.toLowerCase() === settings.payment.onlineTransferLabel.toLowerCase() ||
      /online|bank|transfer/.test(method.toLowerCase())
  );

  if (onlineMethod && /\bonline transfer\b|\bbank transfer\b|\btransfer the money\b/.test(normalizedMessage)) {
    return onlineMethod;
  }

  const codMethod = settings.payment.methods.find((method) => /\bcod\b|cash on delivery/i.test(method));
  if (codMethod && /\bcod\b|cash on delivery/i.test(message || '')) {
    return codMethod;
  }

  return settings.payment.methods.includes(settings.payment.defaultMethod)
    ? settings.payment.defaultMethod
    : settings.payment.methods[0] || 'COD';
}

function hasValue(value?: string | null): boolean {
  return Boolean(value && value.trim());
}

function isPlaceholderValue(value?: string | null): boolean {
  if (!hasValue(value)) {
    return false;
  }

  const normalized = value!.trim().toLowerCase();

  return (
    normalized.startsWith('your_') ||
    normalized.includes('your-') ||
    normalized.includes('change_this') ||
    normalized.includes('generate_with_') ||
    normalized.includes('example.com')
  );
}

function hasConfiguredValue(value?: string | null): boolean {
  return hasValue(value) && !isPlaceholderValue(value);
}

function normalizeBaseUrl(value?: string | null): string | null {
  if (!hasValue(value)) {
    return null;
  }

  const trimmed = value!.trim();
  const withProtocol = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(withProtocol).origin.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function getAutoDetectedBaseUrl(): string | null {
  const candidates = [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function getRuntimeWarnings(): RuntimeWarning[] {
  const warnings: RuntimeWarning[] = [];
  const isChatTestMode = process.env.CHAT_TEST_MODE === '1';
  const isProduction = process.env.NODE_ENV === 'production';
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim();
  const normalizedConfiguredBaseUrl = normalizeBaseUrl(configuredBaseUrl);

  if (!hasConfiguredValue(process.env.DATABASE_URL)) {
    warnings.push({
      key: 'DATABASE_URL',
      level: 'warning',
      message: 'DATABASE_URL is missing or still set to a placeholder. Prisma-backed pages and chat flows will fail.',
    });
  }

  if (!hasConfiguredValue(process.env.DIRECT_URL)) {
    warnings.push({
      key: 'DIRECT_URL',
      level: 'info',
      message: 'DIRECT_URL is missing or still set to a placeholder. Prisma migrations should use a direct database URL in production.',
    });
  }

  if (!hasConfiguredValue(process.env.META_VERIFY_TOKEN)) {
    warnings.push({
      key: 'META_VERIFY_TOKEN',
      level: 'warning',
      message: 'META_VERIFY_TOKEN is missing or still set to a placeholder. Meta webhook verification will fail.',
    });
  }

  if (!isChatTestMode && !hasConfiguredValue(process.env.META_PAGE_ACCESS_TOKEN)) {
    warnings.push({
      key: 'META_PAGE_ACCESS_TOKEN',
      level: 'warning',
      message: 'META_PAGE_ACCESS_TOKEN is missing or still set to a placeholder. The app can receive messages, but it cannot send Meta replies.',
    });
  }

  if (!hasConfiguredValue(process.env.HAPPYBY_PAGE_ID)) {
    warnings.push({
      key: 'HAPPYBY_PAGE_ID',
      level: 'warning',
      message: 'HAPPYBY_PAGE_ID is missing or still set to a placeholder. Brand routing for Happyby Messenger traffic will be incomplete.',
    });
  }

  if (
    !hasConfiguredValue(process.env.HAPPYBY_INSTAGRAM_ID) &&
    !hasConfiguredValue(process.env.CLEOPATRA_INSTAGRAM_ID) &&
    !hasConfiguredValue(process.env.MODABELLA_INSTAGRAM_ID)
  ) {
    warnings.push({
      key: 'INSTAGRAM_ACCOUNT_IDS',
      level: 'info',
      message: 'No Instagram Business Account IDs are configured. Instagram webhook traffic will be accepted but brand routing will be unknown.',
    });
  }

  if (!hasConfiguredValue(process.env.GEMINI_API_KEY)) {
    warnings.push({
      key: 'GEMINI_API_KEY',
      level: 'info',
      message: 'GEMINI_API_KEY is missing or still set to a placeholder. The app will use deterministic fallback routing instead of the live AI model.',
    });
  }

  if (!hasValue(process.env.STORE_SUPPORT_PHONE) && !hasValue(process.env.STORE_SUPPORT_WHATSAPP)) {
    warnings.push({
      key: 'STORE_SUPPORT_CONTACT',
      level: 'info',
      message: 'Direct support phone/WhatsApp is not configured. Unclear conversations will be handed off without a real contact number.',
    });
  }

  if (isProduction && !hasConfiguredValue(process.env.AUTH_SECRET)) {
    warnings.push({
      key: 'AUTH_SECRET',
      level: 'warning',
      message: 'AUTH_SECRET is missing or still set to a placeholder. Admin authentication is not production-ready.',
    });
  }

  if (isProduction && !hasConfiguredValue(process.env.ADMIN_PASSWORD)) {
    warnings.push({
      key: 'ADMIN_PASSWORD',
      level: 'warning',
      message: 'ADMIN_PASSWORD is missing or still set to a placeholder. Set a strong production admin password.',
    });
  }

  if (hasValue(configuredBaseUrl) && !normalizedConfiguredBaseUrl) {
    warnings.push({
      key: 'APP_BASE_URL',
      level: 'warning',
      message: 'APP_BASE_URL is not a valid absolute URL. Use a full https:// URL or rely on exposed Vercel system environment variables.',
    });
  } else if (isProduction && isPlaceholderValue(configuredBaseUrl)) {
    warnings.push({
      key: 'APP_BASE_URL',
      level: 'warning',
      message: 'APP_BASE_URL is still set to a placeholder. Public media fallbacks will point at the wrong domain.',
    });
  } else if (!getPublicBaseUrl()) {
    warnings.push({
      key: 'APP_BASE_URL',
      level: 'info',
      message:
        'APP_BASE_URL is missing and no Vercel deployment URL could be detected. Public asset links and some external media fallbacks will not be available.',
    });
  }

  return warnings;
}

export function logRuntimeWarnings(scope: string) {
  const warnings = getRuntimeWarnings();

  for (const warning of warnings) {
    const key = `${scope}:${warning.key}`;

    if (warnedKeys.has(key)) {
      continue;
    }

    warnedKeys.add(key);

    if (warning.level === 'warning') {
      console.warn(`[${scope}] ${warning.message}`);
    } else {
      console.info(`[${scope}] ${warning.message}`);
    }
  }
}

export function getPublicBaseUrl(): string | null {
  return normalizeBaseUrl(process.env.APP_BASE_URL) ?? getAutoDetectedBaseUrl();
}

export function getPublicAssetUrl(assetPath: string): string | null {
  const baseUrl = getPublicBaseUrl();

  if (!baseUrl) {
    return null;
  }

  const normalizedPath = assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
  return `${baseUrl}${normalizedPath}`;
}
