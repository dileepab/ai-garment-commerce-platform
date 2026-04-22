const verboseLoggingEnabled =
  process.env.DEBUG_APP_LOGS === '1' || process.env.NODE_ENV !== 'production';

export function logDebug(scope: string, message: string, details?: unknown) {
  if (!verboseLoggingEnabled || process.env.CHAT_TEST_MODE === '1') {
    return;
  }

  if (details === undefined) {
    console.log(`[${scope}] ${message}`);
    return;
  }

  console.log(`[${scope}] ${message}`, details);
}

export function logInfo(scope: string, message: string, details?: unknown) {
  if (details === undefined) {
    console.log(`[${scope}] ${message}`);
    return;
  }

  console.log(`[${scope}] ${message}`, details);
}

export function logWarn(scope: string, message: string, details?: unknown) {
  if (details === undefined) {
    console.warn(`[${scope}] ${message}`);
    return;
  }

  console.warn(`[${scope}] ${message}`, details);
}

export function logError(scope: string, message: string, details?: unknown) {
  if (details === undefined) {
    console.error(`[${scope}] ${message}`);
    return;
  }

  console.error(`[${scope}] ${message}`, details);
}
