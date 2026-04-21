/* eslint-disable @typescript-eslint/no-require-imports */
const {
  DEFAULT_BASE_URL,
  DEFAULT_PAGE_ID,
  disconnect,
  runConversation,
} = require('./messenger-test-helpers');

function parseArgs(argv) {
  const args = {
    sender: `sim-${Date.now()}`,
    baseUrl: DEFAULT_BASE_URL,
    pageId: DEFAULT_PAGE_ID,
    messages: [],
    reset: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === '--sender') {
      args.sender = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === '--base-url') {
      args.baseUrl = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === '--page-id') {
      args.pageId = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === '--reset') {
      args.reset = true;
      continue;
    }

    args.messages.push(value);
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.messages.length === 0) {
    console.error('Usage: node scripts/simulate-messenger-flow.js [--reset] [--sender id] "message 1" "message 2"');
    process.exit(1);
  }

  if (args.reset) {
    await resetConversation(args.sender);
  }

  console.log(`Sender: ${args.sender}`);
  console.log(`Base URL: ${args.baseUrl}`);
  console.log(`Page ID: ${args.pageId}`);

  const transcript = await runConversation({
    senderId: args.sender,
    messages: args.messages,
    baseUrl: args.baseUrl,
    pageId: args.pageId,
    reset: args.reset,
  });

  for (const entry of transcript) {
    console.log('\nUSER:', entry.user);
    console.log('WEBHOOK:', JSON.stringify(entry.webhook));
    console.log('BOT:', entry.bot);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnect();
  });
