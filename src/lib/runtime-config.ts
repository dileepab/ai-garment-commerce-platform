const warnedKeys = new Set<string>();

export interface RuntimeWarning {
  key: string;
  level: 'warning' | 'info';
  message: string;
}

function hasValue(value?: string | null): boolean {
  return Boolean(value && value.trim());
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
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim();
  const normalizedConfiguredBaseUrl = normalizeBaseUrl(configuredBaseUrl);

  if (!hasValue(process.env.DATABASE_URL)) {
    warnings.push({
      key: 'DATABASE_URL',
      level: 'warning',
      message: 'DATABASE_URL is missing. Prisma-backed pages and chat flows will fail.',
    });
  }

  if (!hasValue(process.env.META_VERIFY_TOKEN)) {
    warnings.push({
      key: 'META_VERIFY_TOKEN',
      level: 'warning',
      message: 'META_VERIFY_TOKEN is missing. Messenger webhook verification will fail.',
    });
  }

  if (!isChatTestMode && !hasValue(process.env.META_PAGE_ACCESS_TOKEN)) {
    warnings.push({
      key: 'META_PAGE_ACCESS_TOKEN',
      level: 'warning',
      message: 'META_PAGE_ACCESS_TOKEN is missing. The app can receive messages, but it cannot send Messenger replies.',
    });
  }

  if (!hasValue(process.env.HAPPYBY_PAGE_ID)) {
    warnings.push({
      key: 'HAPPYBY_PAGE_ID',
      level: 'warning',
      message: 'HAPPYBY_PAGE_ID is missing. Brand routing for Happyby Messenger traffic will be incomplete.',
    });
  }

  if (!hasValue(process.env.GEMINI_API_KEY)) {
    warnings.push({
      key: 'GEMINI_API_KEY',
      level: 'info',
      message: 'GEMINI_API_KEY is missing. The app will use deterministic fallback routing instead of the live AI model.',
    });
  }

  if (!hasValue(process.env.STORE_SUPPORT_PHONE) && !hasValue(process.env.STORE_SUPPORT_WHATSAPP)) {
    warnings.push({
      key: 'STORE_SUPPORT_CONTACT',
      level: 'info',
      message: 'Direct support phone/WhatsApp is not configured. Unclear conversations will be handed off without a real contact number.',
    });
  }

  if (hasValue(configuredBaseUrl) && !normalizedConfiguredBaseUrl) {
    warnings.push({
      key: 'APP_BASE_URL',
      level: 'warning',
      message: 'APP_BASE_URL is not a valid absolute URL. Use a full https:// URL or rely on exposed Vercel system environment variables.',
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
