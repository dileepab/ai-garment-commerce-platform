/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

const BRAND_PAGE_ID_ENV_KEYS = {
  happyby: 'HAPPYBY_PAGE_ID',
  happybuy: 'HAPPYBY_PAGE_ID',
  cleopatra: 'CLEOPATRA_PAGE_ID',
  modabella: 'MODABELLA_PAGE_ID',
};

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseEnvValue(rawValue) {
  const trimmed = rawValue.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function loadEnvFile(filename) {
  const filePath = path.join(process.cwd(), filename);

  if (!fs.existsSync(filePath)) {
    return;
  }

  const fileContents = fs.readFileSync(filePath, 'utf8');
  const lines = fileContents.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = parseEnvValue(trimmed.slice(separatorIndex + 1));
    process.env[key] = value;
  }
}

function loadLocalEnv() {
  const envFiles = [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
    '.env.production',
    '.env.production.local',
  ];

  for (const filename of envFiles) {
    loadEnvFile(filename);
  }
}

function firstDefinedValue(keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) {
      return value;
    }
  }

  return undefined;
}

function maskSecret(value) {
  if (!value) {
    return '[missing]';
  }

  if (value.length <= 10) {
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function normalizeBrand(value) {
  return (value || 'happyby').toLowerCase().replace(/\s+/g, '');
}

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function printCheck(status, label, details) {
  const prefix = status === 'pass' ? '[PASS]' : status === 'warn' ? '[WARN]' : '[FAIL]';
  console.log(`${prefix} ${label}`);

  if (details) {
    console.log(details);
  }
}

function formatMetaError(error) {
  if (!error || typeof error !== 'object') {
    return 'Unknown error';
  }

  const message = typeof error.message === 'string' ? error.message : 'Unknown error';
  const code = typeof error.code === 'number' || typeof error.code === 'string'
    ? `code ${error.code}`
    : 'no code';

  return `${message} (${code})`;
}

function interpretMetaError(error) {
  const message = typeof error?.message === 'string' ? error.message : '';

  if (/pages_manage_metadata/i.test(message)) {
    return 'The token or app is missing pages_manage_metadata. Reconnect the Page with full Messenger/Page management permissions, then re-subscribe the Page.';
  }

  if (/pages_read_engagement/i.test(message)) {
    return 'The token or app is missing pages_read_engagement. Reconnect the Facebook Page and make sure the app has Page read access before testing subscriptions.';
  }

  if (/pages_messaging/i.test(message)) {
    return 'The token or app is missing pages_messaging. Without it, Messenger events and replies will be unreliable.';
  }

  if (String(error?.code) === '190') {
    return 'The access token is invalid or expired. Generate a fresh Page access token.';
  }

  if (String(error?.code) === '200') {
    return 'The token is valid enough to call Graph, but it does not have the permission required for this operation.';
  }

  return 'Check the app permissions, Page connection, and whether the Page was re-subscribed after the token was generated.';
}

async function metaGet(endpoint, params) {
  const query = new URLSearchParams(params);
  const response = await fetch(`${GRAPH_BASE_URL}/${endpoint}?${query.toString()}`);
  const data = await response.json().catch(() => null);

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

function findSubscriptionForCurrentApp(subscribedApps, appId) {
  if (!Array.isArray(subscribedApps)) {
    return null;
  }

  if (!appId) {
    return subscribedApps[0] || null;
  }

  return (
    subscribedApps.find((entry) => {
      const id = entry?.id;
      return String(id) === String(appId);
    }) || null
  );
}

async function main() {
  loadLocalEnv();

  const verbose = hasFlag('--verbose');
  const brand = normalizeBrand(readOption('--brand'));
  const pageIdEnvKey = BRAND_PAGE_ID_ENV_KEYS[brand] || BRAND_PAGE_ID_ENV_KEYS.happyby;
  const pageId = readOption('--page-id') || process.env[pageIdEnvKey];
  const pageAccessToken =
    readOption('--token') || firstDefinedValue(['META_PAGE_ACCESS_TOKEN']);
  const appId =
    readOption('--app-id') || firstDefinedValue(['META_APP_ID', 'FACEBOOK_APP_ID', 'APP_ID']);
  const appSecret =
    readOption('--app-secret') ||
    firstDefinedValue(['META_APP_SECRET', 'FACEBOOK_APP_SECRET', 'APP_SECRET']);

  printSection('Configuration');
  console.log(`Graph version: ${GRAPH_VERSION}`);
  console.log(`Brand: ${brand}`);
  console.log(`Page env key: ${pageIdEnvKey}`);
  console.log(`Page ID: ${pageId || '[missing]'}`);
  console.log(`Page token: ${maskSecret(pageAccessToken)}`);
  console.log(`App ID: ${appId || '[missing]'}`);
  console.log(`App secret: ${appSecret ? '[present]' : '[missing]'}`);

  if (!pageId || !pageAccessToken) {
    printCheck(
      'fail',
      'Missing required Page configuration.',
      'Set the Page ID and META_PAGE_ACCESS_TOKEN in your local env, or pass --page-id and --token.'
    );
    process.exit(1);
  }

  if (appId && appSecret) {
    printSection('Token Debug');
    const appAccessToken = `${appId}|${appSecret}`;
    const debugResponse = await metaGet('debug_token', {
      input_token: pageAccessToken,
      access_token: appAccessToken,
    });

    if (!debugResponse.ok) {
      const error = debugResponse.data?.error;
      printCheck(
        'warn',
        'Could not inspect the Page token with debug_token.',
        `${formatMetaError(error)}\n${interpretMetaError(error)}`
      );
    } else {
      const tokenData = debugResponse.data?.data || {};
      const scopes = Array.isArray(tokenData.scopes) ? tokenData.scopes : [];
      const requiredScopes = [
        'pages_manage_metadata',
        'pages_read_engagement',
        'pages_messaging',
      ];
      const missingScopes = requiredScopes.filter((scope) => !scopes.includes(scope));

      printCheck(
        missingScopes.length === 0 ? 'pass' : 'warn',
        'Inspected the configured Page token.',
        [
          `Valid: ${Boolean(tokenData.is_valid)}`,
          `Type: ${tokenData.type || 'unknown'}`,
          `App ID on token: ${tokenData.app_id || 'unknown'}`,
          `Profile/Page ID on token: ${tokenData.profile_id || 'unknown'}`,
          `Scopes: ${scopes.length > 0 ? scopes.join(', ') : '[none reported]'}`,
          missingScopes.length > 0
            ? `Missing required scopes: ${missingScopes.join(', ')}`
            : 'Required scopes are present on the token.',
        ].join('\n')
      );

      if (verbose) {
        console.log(JSON.stringify(tokenData, null, 2));
      }
    }
  } else {
    printSection('Token Debug');
    printCheck(
      'warn',
      'Skipping debug_token inspection.',
      'Add META_APP_ID and META_APP_SECRET (or pass --app-id/--app-secret) to inspect token scopes.'
    );
  }

  printSection('Page Metadata');
  const pageResponse = await metaGet(pageId, {
    fields: 'id,name',
    access_token: pageAccessToken,
  });

  if (!pageResponse.ok) {
    const error = pageResponse.data?.error;
    printCheck(
      'fail',
      'Could not load basic Page metadata with the configured Page token.',
      `${formatMetaError(error)}\n${interpretMetaError(error)}`
    );
  } else {
    printCheck(
      'pass',
      'Loaded basic Page metadata.',
      `Page name: ${pageResponse.data?.name || '[unknown]'}\nPage ID: ${pageResponse.data?.id || pageId}`
    );
  }

  printSection('Page Subscription');
  const subscriptionResponse = await metaGet(`${pageId}/subscribed_apps`, {
    access_token: pageAccessToken,
  });

  if (!subscriptionResponse.ok) {
    const error = subscriptionResponse.data?.error;
    printCheck(
      'fail',
      'Could not inspect subscribed_apps for this Page.',
      `${formatMetaError(error)}\n${interpretMetaError(error)}`
    );
  } else {
    const subscription = findSubscriptionForCurrentApp(subscriptionResponse.data?.data, appId);
    const subscribedFields = Array.isArray(subscription?.subscribed_fields)
      ? subscription.subscribed_fields
      : [];
    const requiredFields = ['messages', 'messaging_postbacks'];
    const missingFields = requiredFields.filter((field) => !subscribedFields.includes(field));

    printCheck(
      missingFields.length === 0 ? 'pass' : 'warn',
      subscription
        ? 'Found an app subscription record for this Page.'
        : 'subscribed_apps responded, but no matching app subscription was found.',
      [
        `Matched app ID: ${subscription?.id || '[not found]'}`,
        `Subscribed fields: ${subscribedFields.length > 0 ? subscribedFields.join(', ') : '[none reported]'}`,
        missingFields.length > 0
          ? `Missing required webhook fields: ${missingFields.join(', ')}`
          : 'Required webhook fields are present.',
      ].join('\n')
    );

    if (verbose) {
      console.log(JSON.stringify(subscriptionResponse.data, null, 2));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
