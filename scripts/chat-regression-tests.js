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

async function getOrdersForSender(senderId) {
  const customer = await prisma.customer.findUnique({
    where: {
      externalId: senderId,
    },
    include: {
      orders: {
        orderBy: {
          createdAt: 'asc',
        },
        include: {
          orderItems: true,
        },
      },
    },
  });

  return customer?.orders || [];
}

async function getConversationState(senderId, channel = 'messenger') {
  const record = await prisma.conversationState.findUnique({
    where: {
      senderId_channel: {
        senderId,
        channel,
      },
    },
    select: {
      stateJson: true,
    },
  });

  return record?.stateJson ? JSON.parse(record.stateJson) : null;
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

          const conversationState = await getConversationState(senderId);
          assert(
            conversationState?.supportMode === 'handoff_requested',
            `Expected supportMode handoff_requested, received ${String(conversationState?.supportMode)}.`
          );
        },
      },
      {
        name: 'Support handoff stays silent until the case is resolved',
        senderId: buildSender(runId, 'handoff-paused'),
        messages: [
          'I need to talk to a real person',
          'What are the available items?',
          'Are you there?',
        ],
        verify: async ({ transcript, senderId }) => {
          assert(
            transcript[1].bot === '[no assistant reply recorded]',
            `Expected no bot reply after support handoff.\n\nActual reply:\n${transcript[1].bot}`
          );
          assert(
            transcript[2].bot === '[no assistant reply recorded]',
            `Expected no bot reply while the support case remains open.\n\nActual reply:\n${transcript[2].bot}`
          );

          const escalation = await prisma.supportEscalation.findFirst({
            where: { senderId, channel: 'messenger' },
            orderBy: { updatedAt: 'desc' },
          });

          assert(escalation, 'Expected an escalation to remain open during paused handoff test.');
          assert(
            escalation.status === 'open',
            `Expected open escalation during paused handoff test, received ${escalation.status}.`
          );
          assert(
            escalation.latestCustomerMessage === 'Are you there?',
            `Expected latestCustomerMessage to keep tracking customer replies during handoff, received ${String(escalation.latestCustomerMessage)}.`
          );
        },
      },
      {
        name: 'Human active support case stays silent until resolved',
        senderId: buildSender(runId, 'human-active-silent'),
        messages: ['I need to talk to a real person'],
        verify: async ({ senderId }) => {
          const escalation = await prisma.supportEscalation.findFirst({
            where: { senderId, channel: 'messenger' },
            orderBy: { updatedAt: 'desc' },
          });

          assert(escalation, 'Expected an escalation before switching to human active mode.');

          await prisma.supportEscalation.update({
            where: {
              id: escalation.id,
            },
            data: {
              status: 'in_progress',
            },
          });

          await prisma.conversationState.update({
            where: {
              senderId_channel: {
                senderId,
                channel: 'messenger',
              },
            },
            data: {
              stateJson: JSON.stringify({
                ...(await getConversationState(senderId)),
                supportMode: 'bot_active',
              }),
            },
          });

          const followUpTranscript = await runConversation({
            senderId,
            messages: ['Can you update me?'],
            baseUrl,
            pageId: DEFAULT_PAGE_ID,
            reset: false,
          });

          console.log(formatTranscript(followUpTranscript));

          assert(
            followUpTranscript[0].bot === '[no assistant reply recorded]',
            `Expected no bot reply while human support is active.\n\nActual reply:\n${followUpTranscript[0].bot}`
          );
        },
      },
      {
        name: 'Resolved support handoff resumes the bot on the next customer message',
        senderId: buildSender(runId, 'handoff-resolved'),
        messages: ['I need to talk to a real person'],
        verify: async ({ senderId }) => {
          const escalation = await prisma.supportEscalation.findFirst({
            where: { senderId, channel: 'messenger' },
            orderBy: { updatedAt: 'desc' },
          });

          assert(escalation, 'Expected an escalation before resolving the support handoff.');

          await prisma.supportEscalation.update({
            where: {
              id: escalation.id,
            },
            data: {
              status: 'resolved',
              resolvedAt: new Date(),
            },
          });

          await prisma.conversationState.update({
            where: {
              senderId_channel: {
                senderId,
                channel: 'messenger',
              },
            },
            data: {
              stateJson: JSON.stringify({
                ...(await getConversationState(senderId)),
                supportMode: 'resolved',
              }),
            },
          });

          const followUpTranscript = await runConversation({
            senderId,
            messages: ['What are the available items?'],
            baseUrl,
            pageId: DEFAULT_PAGE_ID,
            reset: false,
          });

          console.log(formatTranscript(followUpTranscript));

          assertIncludes(followUpTranscript[0].bot, [
            'Here is what we have available right now:',
          ], 'Resolved handoff follow-up reply');
        },
      },
      {
        name: 'Unavailable Happyby dresses reply stays professional',
        senderId: buildSender(runId, 'dresses'),
        messages: ['What are the available dresses'],
        verify: async ({ transcript }) => {
          assertIncludes(transcript[0].bot, [
            'We do not have any dresses available in Happyby right now.',
            'Here are the available items:',
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
        name: 'Draft total question stays tied to the current order draft',
        senderId: buildSender(runId, 'draft-total'),
        messages: [
          'I want Oversized Casual Top in black, M size',
          'Please send me the total with delivery charges',
        ],
        verify: async ({ transcript }) => {
          assertIncludes(transcript[1].bot, [
            'The total for your order is Rs',
            'Order Summary',
            'Product: Oversized Casual Top',
            'Color: Black',
          ], 'Draft total reply');
          assert(
            !transcript[1].bot.includes('Order Details'),
            `Draft total reply leaked a stored order instead of the pending draft.\n\nActual reply:\n${transcript[1].bot}`
          );
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
        name: 'Gift follow-up can apply to the last active order',
        senderId: buildSender(runId, 'gift-follow-up'),
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Gift Followup Customer',
          '12 Main Street, Kurunegala',
          '0771001212',
          'yes correct',
          'yes correct',
          'Can I send this as a gift to my friend?',
          'Do it for the last order and add a Happy Birthday note',
        ],
        verify: async ({ transcript, senderId }) => {
          assertIncludes(transcript[6].bot, [
            'Yes, we can pack order #',
          ], 'Gift capability pre-check reply');
          assertIncludes(transcript[7].bot, [
            'I have updated order #',
            'Gift wrap requested',
            'Gift Note: Happy Birthday',
          ], 'Gift follow-up apply reply');

          const { latestOrder } = await getLatestOrderForSender(senderId);
          assert(latestOrder?.giftWrap, 'Expected gift wrap to be applied from follow-up instruction.');
          assert(
            latestOrder?.giftNote === 'Happy Birthday',
            `Expected follow-up gift note Happy Birthday, received ${latestOrder?.giftNote}.`
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
        name: 'Support contact requests return direct contact details and polite closure',
        senderId: buildSender(runId, 'support-contact'),
        messages: [
          'I want Oversized Casual Top in black, M size',
          'Support Contact Customer',
          '460/2, Temple Road, Bingiriya',
          '0702694269',
          'yes correct',
          'yes correct',
          'I want support center contact number',
          'can I have contact number',
          'okay thank you',
        ],
        verify: async ({ transcript, senderId }) => {
          assertIncludes(transcript[6].bot, [
            'You can reach our support team directly.',
            'Please call or WhatsApp our team on 0701234567',
          ], 'Support center contact reply');
          assert(
            !transcript[6].bot.includes('flagged this conversation'),
            `Support contact reply should not create a handoff escalation.\n\nActual reply:\n${transcript[6].bot}`
          );
          assertIncludes(transcript[7].bot, [
            'You can reach our support team directly.',
            'Please call or WhatsApp our team on 0701234567',
          ], 'Generic contact number follow-up reply');
          assertIncludes(transcript[8].bot, [
            'You are welcome.',
            'Please call or WhatsApp our team on 0701234567',
          ], 'Support contact thanks acknowledgement');
          assert(
            !transcript[8].bot.includes('Hello'),
            `Thanks acknowledgement incorrectly restarted with a greeting.\n\nActual reply:\n${transcript[8].bot}`
          );

          const escalation = await prisma.supportEscalation.findFirst({
            where: { senderId, channel: 'messenger' },
            orderBy: { updatedAt: 'desc' },
          });

          assert(!escalation, 'Did not expect a support escalation for a simple support contact request.');
        },
      },
      {
        name: 'Multiple size chart types can be requested in one follow-up',
        senderId: buildSender(runId, 'multi-size-chart'),
        messages: [
          'Do you have a size chart?',
          'Dresses and Tops',
        ],
        verify: async ({ transcript }) => {
          assertIncludes(transcript[1].bot, [
            'Here are our',
            'Tops',
            'Dresses',
            'size charts',
          ], 'Multi size chart reply');
        },
      },
      {
        name: 'Explicit missing order lookup keeps the same missing ID on follow-up',
        senderId: buildSender(runId, 'missing-order'),
        messages: [
          'Can you send me the order status of #9999',
          'check again',
        ],
        verify: async ({ transcript }) => {
          assertIncludes(transcript[0].bot, [
            'I could not find order #9999 for this conversation.',
          ], 'Missing order reply');
          assertIncludes(transcript[1].bot, [
            'I could not find order #9999 for this conversation.',
          ], 'Missing order follow-up reply');
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
      {
        name: 'Reorder after cancellation reuses the cancelled order details cleanly',
        senderId: buildSender(runId, 'reorder-cancelled'),
        messages: [
          'I want Oversized Casual Top in black, M size',
          'Reorder Customer',
          '12 Main Street, Kurunegala',
          '0771006666',
          'yes correct',
          'yes correct',
          'Cancel my order',
          'I want to re order the same item',
        ],
        verify: async ({ transcript, senderId }) => {
          assertIncludes(transcript[6].bot, [
            'Cancelled Order ID: #',
          ], 'Cancellation reply');
          assertIncludes(transcript[7].bot, [
            'Please confirm if these delivery details are correct:',
            'Name: Reorder Customer',
            'Address: 12 Main Street, Kurunegala',
            'Phone Number: 0771006666',
          ], 'Reorder contact confirmation reply');

          const orders = await getOrdersForSender(senderId);
          assert(
            orders.length === 1 && orders[0].orderStatus === 'cancelled',
            `Expected only the original cancelled order to exist before reorder confirmation, received ${orders.length} order(s).`
          );
        },
      },
      {
        name: 'Stock cap follow-up keeps the quantity update flow contextual',
        senderId: buildSender(runId, 'stock-cap'),
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Stock Cap Customer',
          '12 Main Street, Kurunegala',
          '0771007878',
          'yes correct',
          'yes correct',
          'can you increase order count of last order to 999',
          'okay',
        ],
        verify: async ({ transcript }) => {
          assertIncludes(transcript[6].bot, [
            'I can update order #',
            'Please send a lower quantity.',
          ], 'Stock cap reply');
          assertIncludes(transcript[7].bot, [
            'Please send the quantity you want for order #',
          ], 'Stock cap follow-up reply');
          assert(
            !transcript[7].bot.includes('Your order has been confirmed successfully'),
            `Stock cap follow-up incorrectly confirmed an order.\n\nActual reply:\n${transcript[7].bot}`
          );
        },
      },
      {
        name: 'Explicit order detail lookup returns the requested order instead of the latest one',
        senderId: buildSender(runId, 'explicit-order'),
        messages: [
          'I want Oversized Casual Top in black, M size',
          'Explicit Lookup Customer',
          '12 Main Street, Kurunegala',
          '0771008888',
          'yes correct',
          'yes correct',
          'I want Relaxed Linen Pants in beige, M size',
          'yes correct',
          'yes correct',
        ],
        verify: async ({ senderId }) => {
          const orders = await getOrdersForSender(senderId);
          assert(orders.length === 2, `Expected two orders for explicit lookup test, received ${orders.length}.`);

          const [firstOrder, secondOrder] = orders;
          assert(
            firstOrder.id !== secondOrder.id,
            'Expected two distinct orders for explicit order lookup test.'
          );

          const followUpTranscript = await runConversation({
            senderId,
            messages: [`Send me order details of #${firstOrder.id}`],
            baseUrl,
            pageId: DEFAULT_PAGE_ID,
            reset: false,
          });

          console.log(formatTranscript(followUpTranscript));

          assertIncludes(followUpTranscript[0].bot, [
            `Order ID: #${firstOrder.id}`,
            'Product: Oversized Casual Top',
          ], 'Explicit order lookup reply');
          assert(
            !followUpTranscript[0].bot.includes(`Order ID: #${secondOrder.id}`),
            `Explicit order lookup leaked the latest order instead of the requested order.\n\nActual reply:\n${followUpTranscript[0].bot}`
          );
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
