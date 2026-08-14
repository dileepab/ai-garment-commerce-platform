import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAuthorizedCronRequest } from '../src/lib/cron-auth.ts';

function requestWith(authorization?: string): Request {
  return new Request('https://app.deez.lk/api/cron/human-timeout', {
    headers: authorization ? { authorization } : {},
  });
}

function withEnv(env: Record<string, string | undefined>, run: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('the matching bearer token is accepted', () => {
  withEnv({ CRON_SECRET: 'sekret', NODE_ENV: 'production' }, () => {
    assert.equal(isAuthorizedCronRequest(requestWith('Bearer sekret')), true);
  });
});

/**
 * These endpoints send WhatsApp and Messenger messages to real customers. An
 * unauthenticated caller could make the shop message people at will, which
 * costs money and is the kind of thing Meta restricts a number for.
 */
test('a wrong or missing token is refused', () => {
  withEnv({ CRON_SECRET: 'sekret', NODE_ENV: 'production' }, () => {
    assert.equal(isAuthorizedCronRequest(requestWith('Bearer wrong')), false);
    assert.equal(isAuthorizedCronRequest(requestWith('sekret')), false);
    assert.equal(isAuthorizedCronRequest(requestWith()), false);
  });
});

// No secret in production means no sending: fail closed, not open.
test('production without a secret configured refuses everything', () => {
  withEnv({ CRON_SECRET: undefined, NODE_ENV: 'production' }, () => {
    assert.equal(isAuthorizedCronRequest(requestWith()), false);
    assert.equal(isAuthorizedCronRequest(requestWith('Bearer anything')), false);
  });
});

// Local runs stay convenient, because nothing real is reachable from there.
test('outside production a missing secret is allowed', () => {
  withEnv({ CRON_SECRET: undefined, NODE_ENV: 'development' }, () => {
    assert.equal(isAuthorizedCronRequest(requestWith()), true);
  });
});

test('an empty or whitespace secret counts as unset', () => {
  withEnv({ CRON_SECRET: '   ', NODE_ENV: 'production' }, () => {
    assert.equal(isAuthorizedCronRequest(requestWith('Bearer    ')), false);
  });
});
