/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require('node:child_process');

const {
  DEFAULT_PAGE_ID,
  disconnect,
  formatTranscript,
  prisma,
  resetConversation,
  runConversation,
  sleep,
} = require('./messenger-test-helpers');

const DEFAULT_TEST_PORT = Number.parseInt(process.env.CHAT_TEST_PORT || '3100', 10);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(actual, expectedSnippets, label) {
  for (const snippet of expectedSnippets) {
    assert(
      actual.includes(snippet),
      `${label} is missing expected text: ${snippet}\n\nActual reply:\n${actual}`
    );
  }
}

async function waitForServer(baseUrl, server, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (server?.child.exitCode !== null) {
      throw new Error(
        `Test server exited before becoming ready.\n\n${server.getOutput()}`
      );
    }

    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for test server at ${baseUrl}`);
}

function startTestServer(port) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(npmCommand, ['run', 'start', '--', '--port', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CHAT_TEST_MODE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let bufferedOutput = '';
  const appendOutput = (chunk) => {
    bufferedOutput += chunk.toString();
    if (bufferedOutput.length > 12000) {
      bufferedOutput = bufferedOutput.slice(-12000);
    }
  };

  child.stdout.on('data', appendOutput);
  child.stderr.on('data', appendOutput);

  const stop = async () => {
    if (child.exitCode !== null) {
      return;
    }

    child.kill('SIGTERM');

    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  };

  return {
    child,
    getOutput: () => bufferedOutput,
    stop,
  };
}

async function getLatestOrderForSender(senderId) {
  const customer = await prisma.customer.findUnique({
    where: {
      externalId: senderId,
    },
    include: {
      orders: {
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          orderItems: true,
        },
      },
    },
  });

  return {
    customer,
    latestOrder: customer?.orders[0] || null,
  };
}

function buildSender(runId, slug) {
  return `chat-regression-${runId}-${slug}`;
}

async function main() {
  const runId = Date.now();
  const port = DEFAULT_TEST_PORT;
  const baseUrl = process.env.CHAT_TEST_BASE_URL || `http://127.0.0.1:${port}`;
  const server = process.env.CHAT_TEST_BASE_URL ? null : startTestServer(port);
  const createdSenders = [];

  try {
    if (server) {
      await waitForServer(baseUrl, server);
    }

    const cases = [
      {
        name: 'Human support handoff stores escalation',
        senderId: buildSender(runId, 'human'),
        messages: ['I need to talk to a real person'],
        verify: async ({ transcript, senderId }) => {
          assertIncludes(transcript[0].bot, [
            'I want to make sure you get the right help for this support request.',
            'I have also flagged this conversation for a team follow-up.',
          ], 'Human support handoff reply');

          const escalation = await prisma.supportEscalation.findFirst({
            where: { senderId, channel: 'messenger' },
            orderBy: { updatedAt: 'desc' },
          });

          assert(escalation, 'Expected a support escalation for the human handoff test.');
          assert(
            escalation.reason === 'human_request',
            `Expected reason human_request, received ${escalation.reason}.`
          );
        },
      },
      {
        name: 'Unavailable Happyby dresses reply stays professional',
        senderId: buildSender(runId, 'dresses'),
        messages: ['What are the available dresses'],
        verify: async ({ transcript }) => {
          assertIncludes(transcript[0].bot, [
            'We do not have any dresses available in Happyby right now.',
            'Currently available items are:',
            'Relaxed Linen Pants',
          ], 'Unavailable dresses reply');
        },
      },
      {
        name: 'Order flow collects contact details and confirms order',
        senderId: buildSender(runId, 'happy-path'),
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Regression Customer',
          '12 Main Street, Kurunegala',
          '0771009999',
          'yes correct',
          'yes correct',
        ],
        verify: async ({ transcript, senderId }) => {
          assertIncludes(transcript[0].bot, [
            'To proceed with the order, please share:',
            'Name:',
            'Address:',
            'Phone Number:',
          ], 'Initial contact collection reply');

          assertIncludes(transcript[3].bot, [
            'Please confirm if these delivery details are correct:',
            'Name: Regression Customer',
            'Address: 12 Main Street, Kurunegala',
            'Phone Number: 0771009999',
          ], 'Contact confirmation reply');

          assertIncludes(transcript[4].bot, [
            'Order Summary',
            'Product: Relaxed Linen Pants',
            'Size: Medium',
            'Color: Beige',
          ], 'Order summary reply');

          assertIncludes(transcript[5].bot, [
            'Thank you. Your order has been confirmed successfully ✅',
            'Order ID: #',
            'Current Stage: Confirmed',
          ], 'Order placed reply');

          const { latestOrder } = await getLatestOrderForSender(senderId);
          assert(latestOrder, 'Expected an order to be created in the happy path test.');
          assert(
            latestOrder.orderStatus === 'confirmed',
            `Expected confirmed order status, received ${latestOrder.orderStatus}.`
          );
        },
      },
      {
        name: 'Contact correction from summary returns updated contact block',
        senderId: buildSender(runId, 'contact-correction'),
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Correction Customer',
          '460/2, Temple Road, Bingiriya',
          '0771002222',
          'yes correct',
          'change address to 12 Main Street, Kurunegala',
        ],
        verify: async ({ transcript }) => {
          assertIncludes(transcript[5].bot, [
            'Please confirm if these delivery details are correct:',
            'Name: Correction Customer',
            'Address: 12 Main Street, Kurunegala',
            'Phone Number: 0771002222',
          ], 'Updated contact confirmation reply');
        },
      },
      {
        name: 'Gift instructions update the latest order directly',
        senderId: buildSender(runId, 'gift-update'),
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Gift Update Customer',
          '12 Main Street, Kurunegala',
          '0771001111',
          'yes correct',
          'yes correct',
          'Please pack it as a gift and add a Happy Birthday note',
        ],
        verify: async ({ transcript, senderId }) => {
          assertIncludes(transcript[6].bot, [
            'I have updated order #',
            'Gift wrap requested',
            'Gift Note: Happy Birthday',
          ], 'Gift update reply');

          const { latestOrder } = await getLatestOrderForSender(senderId);
          assert(latestOrder, 'Expected a latest order for the gift update test.');
          assert(latestOrder.giftWrap === true, 'Expected giftWrap to be true after gift update.');
          assert(
            latestOrder.giftNote === 'Happy Birthday',
            `Expected gift note Happy Birthday, received ${latestOrder.giftNote}.`
          );
        },
      },
      {
        name: 'Gift capability question uses the active order context',
        senderId: buildSender(runId, 'gift-capability'),
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Gift Capability Customer',
          '12 Main Street, Kurunegala',
          '0771003333',
          'yes correct',
          'yes correct',
          'Can I send this as a gift to my friend?',
        ],
        verify: async ({ transcript }) => {
          assertIncludes(transcript[6].bot, [
            'Yes, we can pack order #',
            'add gift wrap to my last order',
          ], 'Gift capability reply');
          assert(
            !transcript[6].bot.includes('Please send the item details whenever you are ready to place the order.'),
            `Gift capability reply incorrectly asked for new item details.\n\nActual reply:\n${transcript[6].bot}`
          );
        },
      },
      {
        name: 'Complaint after order creates linked support escalation',
        senderId: buildSender(runId, 'complaint'),
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Complaint Customer',
          '12 Main Street, Kurunegala',
          '0771004444',
          'yes correct',
          'yes correct',
          'My parcel is late and I need refund',
        ],
        verify: async ({ transcript, senderId }) => {
          const { latestOrder } = await getLatestOrderForSender(senderId);
          assert(latestOrder, 'Expected a latest order for the complaint escalation test.');

          assertIncludes(transcript[6].bot, [
            'I want to make sure you get the right help for this order issue.',
            `Please mention order #${latestOrder.id}`,
          ], 'Complaint escalation reply');

          const escalation = await prisma.supportEscalation.findFirst({
            where: { senderId, channel: 'messenger' },
            orderBy: { updatedAt: 'desc' },
          });

          assert(escalation, 'Expected a support escalation for the complaint test.');
          assert(
            escalation.orderId === latestOrder.id,
            `Expected escalation orderId ${latestOrder.id}, received ${String(escalation.orderId)}.`
          );
          assert(
            escalation.reason === 'refund_or_damage',
            `Expected reason refund_or_damage, received ${escalation.reason}.`
          );
        },
      },
      {
        name: 'Order status reply uses stage wording',
        senderId: buildSender(runId, 'status'),
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Status Customer',
          '12 Main Street, Kurunegala',
          '0771005555',
          'yes correct',
          'yes correct',
          'What is the status of last order',
        ],
        verify: async ({ transcript }) => {
          assertIncludes(transcript[6].bot, [
            'currently at the Confirmed stage',
            'queued for packing',
          ], 'Order status reply');
        },
      },
    ];

    for (const testCase of cases) {
      createdSenders.push(testCase.senderId);
      console.log(`\n=== ${testCase.name} ===`);

      const transcript = await runConversation({
        senderId: testCase.senderId,
        messages: testCase.messages,
        baseUrl,
        pageId: DEFAULT_PAGE_ID,
        reset: true,
      });

      console.log(formatTranscript(transcript));
      await testCase.verify({
        transcript,
        senderId: testCase.senderId,
      });

      console.log(`PASS: ${testCase.name}`);
    }

    console.log(`\nAll chat regression tests passed (${cases.length} cases).`);
  } catch (error) {
    console.error('\nChat regression test failure:\n');
    console.error(error instanceof Error ? error.message : error);
    if (server) {
      console.error('\nRecent test server output:\n');
      console.error(server.getOutput());
    }
    process.exitCode = 1;
  } finally {
    for (const senderId of createdSenders) {
      try {
        await resetConversation(senderId);
      } catch (error) {
        console.error(`Cleanup failed for ${senderId}:`, error);
      }
    }

    if (server) {
      await server.stop();
    }

    await disconnect();
  }
}

main();
