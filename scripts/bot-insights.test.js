/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const BOT_INSIGHTS_FILE = path.join(__dirname, '..', 'src', 'lib', 'bot-insights.ts');
const LANGUAGE_FILE = path.join(__dirname, '..', 'src', 'lib', 'chat', 'language.ts');

function transpile(filePath) {
  const ts = require('typescript');
  const source = fs.readFileSync(filePath, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
  });
  return result.outputText;
}

function loadModule(filePath, replacements = {}) {
  const code = transpile(filePath);
  const m = new Module(filePath);
  m.filename = filePath;
  m.paths = Module._nodeModulePaths(path.dirname(filePath));
  const originalRequire = m.require.bind(m);
  m.require = (req) => {
    if (replacements[req]) return replacements[req];
    return originalRequire(req);
  };
  m._compile(code, filePath);
  return m.exports;
}

const languageModule = loadModule(LANGUAGE_FILE, {
  '@/lib/app-log': {
    logDebug: () => {},
    logError: () => {},
    logWarn: () => {},
  },
});
const { buildBotInsightsReport } = loadModule(BOT_INSIGHTS_FILE, {
  '@/lib/chat/language': languageModule,
});

const base = new Date('2026-05-30T09:00:00.000Z');
const minutes = (value) => new Date(base.getTime() + value * 60000);

const report = buildBotInsightsReport({
  windowDays: 30,
  now: minutes(20),
  customers: [],
  webhookFailures: [],
  orders: [],
  messages: [
    {
      id: 1,
      senderId: 'support-hold-sender',
      channel: 'messenger',
      role: 'user',
      message: 'I received a damaged item. I want a refund.',
      createdAt: minutes(1),
    },
    {
      id: 2,
      senderId: 'support-hold-sender',
      channel: 'messenger',
      role: 'assistant',
      message:
        'I want to make sure you get the right help for this order issue. I have also flagged this conversation for a team follow-up.',
      createdAt: minutes(1.1),
    },
    {
      id: 3,
      senderId: 'support-hold-sender',
      channel: 'messenger',
      role: 'user',
      message: 'கொழும்புக்கு வெளியே கிளைகள் உள்ளதா?',
      createdAt: minutes(2),
    },
  ],
  escalations: [
    {
      id: 1,
      senderId: 'support-hold-sender',
      channel: 'messenger',
      brand: 'Cleopatra',
      reason: 'order_issue',
      status: 'open',
      contactName: 'Test Customer',
      latestCustomerMessage: 'I received a damaged item. I want a refund.',
      createdAt: minutes(1.1),
      updatedAt: minutes(2),
      resolvedAt: null,
    },
  ],
  diagnostics: [
    {
      id: 1,
      senderId: 'support-hold-sender',
      channel: 'messenger',
      brand: 'Cleopatra',
      detectedLanguage: 'tamil',
      replyLanguage: 'tamil',
      aiAction: 'fallback',
      effectiveAction: 'support_silent_hold',
      aiConfidence: 0.9,
      assistantReplyKind: 'support_waiting',
      supportMode: 'handoff_requested',
      pendingStep: 'none',
      hasReply: false,
      hasMedia: false,
      orderId: null,
      issueFlags: JSON.stringify(['no_automated_reply', 'support_handoff']),
      createdAt: minutes(2.01),
    },
  ],
});

const handledMetric = report.metrics.find((metric) => metric.label === 'Handled rate');
assert.equal(handledMetric?.value, '100%');
assert.match(handledMetric?.note || '', /1 support holds/);

const conversation = report.problemConversations.find((item) => item.senderId === 'support-hold-sender');
assert.ok(conversation, 'support handoff conversation should still be visible for review');
assert.equal(conversation.noReplyCount, 0);
assert.equal(conversation.supportWaitingCount, 1);
assert.ok(conversation.issueLabels.includes('Support waiting'));
assert.ok(!conversation.issueLabels.includes('No bot reply'));

console.log('Bot insights support handoff tests passed');
