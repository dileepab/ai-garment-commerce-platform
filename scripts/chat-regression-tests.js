/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require('node:child_process');

const {
  DEFAULT_INSTAGRAM_ID,
  DEFAULT_PAGE_ID,
  disconnect,
  formatTranscript,
  getConversationMessages,
  prisma,
  resetConversation,
  runConversation,
  sendMessengerWebhookEvents,
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

async function getProductInventoryByName(name) {
  return prisma.product.findFirst({
    where: { name },
    include: { inventory: true },
  });
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

async function waitForRoleMessageCount(senderId, channel, role, expectedCount) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const messages = await getConversationMessages(senderId, channel);
    const count = messages.filter((message) => message.role === role).length;

    if (count >= expectedCount) {
      return messages;
    }

    await sleep(250);
  }

  return getConversationMessages(senderId, channel);
}

function buildSender(runId, slug) {
  return `chat-regression-${runId}-${slug}`;
}

async function resetInventoryToSeedValues() {
  const { variantStocks } = require('../prisma/catalog-data');

  for (const [key, sizeMap] of Object.entries(variantStocks)) {
    const [brand, name] = key.split(':');
    const product = await prisma.product.findFirst({ where: { name, brand } });
    if (!product) continue;

    for (const [size, colorMap] of Object.entries(sizeMap)) {
      for (const [color, qty] of Object.entries(colorMap)) {
        const variant = await prisma.productVariant.findUnique({
          where: { productId_size_color: { productId: product.id, size, color } },
        });
        if (!variant) continue;
        await prisma.variantInventory.updateMany({
          where: { variantId: variant.id },
          data: { availableQty: qty, reservedQty: 0 },
        });
      }
    }
  }
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
            'available',
            'Oversized Casual Top',
            'Relaxed Linen Pants',
          ], 'Resolved handoff follow-up reply');
        },
      },
      {
        name: 'Available Happyby dresses reply stays professional',
        senderId: buildSender(runId, 'dresses'),
        messages: ['What are the available dresses'],
        verify: async ({ transcript }) => {
          assertIncludes(transcript[0].bot, [
            'We currently have the following items available:',
            'Breezy Summer Dress',
          ], 'Available dresses reply');
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
        name: 'Instagram DM order flow uses the same orchestration path',
        senderId: buildSender(runId, 'instagram-order'),
        channel: 'instagram',
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Instagram Regression Customer',
          '12 Main Street, Kurunegala',
          '0771009898',
          'yes correct',
          'yes correct',
        ],
        verify: async ({ transcript, senderId }) => {
          assertIncludes(transcript[0].bot, [
            'To proceed with the order, please share:',
            'Name:',
            'Address:',
            'Phone Number:',
          ], 'Instagram initial contact collection reply');

          assertIncludes(transcript[5].bot, [
            'Thank you. Your order has been confirmed successfully ✅',
            'Order ID: #',
            'Current Stage: Confirmed',
          ], 'Instagram order placed reply');

          const { customer, latestOrder } = await getLatestOrderForSender(senderId);
          assert(customer?.channel === 'instagram', `Expected Instagram customer channel, received ${String(customer?.channel)}.`);
          assert(latestOrder, 'Expected an order to be created from the Instagram DM flow.');
          assert(
            latestOrder.orderStatus === 'confirmed',
            `Expected Instagram order status confirmed, received ${latestOrder.orderStatus}.`
          );
        },
      },
      {
        name: 'Messenger batched webhook events preserve conversation state',
        senderId: buildSender(runId, 'messenger-batch'),
        messages: [],
        verify: async ({ senderId }) => {
          const response = await sendMessengerWebhookEvents({
            baseUrl,
            pageId: DEFAULT_PAGE_ID,
            events: [
              { senderId, text: 'I want Oversized Casual Top in black, M size' },
              { senderId, text: 'Batch Regression Customer' },
            ],
          });

          assert(response.status === 200, `Expected batched Messenger webhook status 200, received ${response.status}.`);
          const messages = await waitForRoleMessageCount(senderId, 'messenger', 'assistant', 2);
          const assistantMessages = messages.filter((message) => message.role === 'assistant');

          assertIncludes(assistantMessages[0]?.message || '', [
            'To proceed with the order, please share:',
            'Name:',
            'Address:',
            'Phone Number:',
          ], 'First batched Messenger assistant reply');
          assertIncludes(assistantMessages[1]?.message || '', [
            'To proceed with the order, please share:',
            'Address:',
            'Phone Number:',
          ], 'Second batched Messenger assistant reply');

          const state = await getConversationState(senderId);
          assert(
            state?.pendingStep === 'contact_collection',
            `Expected batched Messenger flow to remain in contact_collection, received ${String(state?.pendingStep)}.`
          );
          assert(
            state?.orderDraft?.name === 'Batch Regression Customer',
            `Expected batched Messenger flow to keep the collected name, received ${String(state?.orderDraft?.name)}.`
          );
        },
      },
      {
        name: 'Duplicate Messenger event ID is processed once',
        senderId: buildSender(runId, 'messenger-duplicate-event'),
        messages: [],
        verify: async ({ senderId }) => {
          const timestamp = Date.now();
          const duplicateEvent = {
            sender: { id: senderId },
            recipient: { id: DEFAULT_PAGE_ID },
            timestamp,
            message: {
              mid: `mid.${runId}.duplicate-event`,
              text: 'What do you have available?',
            },
          };

          const response = await sendMessengerWebhookEvents({
            baseUrl,
            pageId: DEFAULT_PAGE_ID,
            events: [duplicateEvent, duplicateEvent],
          });

          assert(response.status === 200, `Expected duplicate webhook status 200, received ${response.status}.`);
          assert(
            response.payload?.stats?.duplicates === 1,
            `Expected one duplicate webhook event, received ${JSON.stringify(response.payload?.stats)}.`
          );

          const messages = await waitForRoleMessageCount(senderId, 'messenger', 'assistant', 1);
          const assistantMessages = messages.filter((message) => message.role === 'assistant');
          const userMessages = messages.filter((message) => message.role === 'user');

          assert(
            assistantMessages.length === 1,
            `Expected one assistant reply for duplicate event, received ${assistantMessages.length}.`
          );
          assert(
            userMessages.length === 1,
            `Expected one stored user message for duplicate event, received ${userMessages.length}.`
          );
        },
      },
      {
        name: 'Duplicate order confirmation does not create a second order',
        senderId: buildSender(runId, 'duplicate-confirm'),
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Duplicate Confirm Customer',
          '12 Main Street, Kurunegala',
          '0771009090',
          'yes correct',
          'yes correct',
          'yes correct',
        ],
        verify: async ({ transcript, senderId }) => {
          assertIncludes(transcript[6].bot, [
            'already confirmed',
          ], 'Duplicate confirmation acknowledgement');

          const orders = await getOrdersForSender(senderId);
          assert(
            orders.length === 1,
            `Expected one order after duplicate confirmation, received ${orders.length}.`
          );
          assert(
            orders[0].orderStatus === 'confirmed',
            `Expected duplicate confirmation order to remain confirmed, received ${orders[0].orderStatus}.`
          );
        },
      },
      {
        name: 'Cancelling a pending draft does not cancel an existing order',
        senderId: buildSender(runId, 'draft-cancel'),
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Draft Cancel Customer',
          '12 Main Street, Kurunegala',
          '0771009191',
          'yes correct',
          'yes correct',
          'I want Oversized Casual Top in black, M size',
          'cancel my order',
        ],
        verify: async ({ transcript, senderId }) => {
          assertIncludes(transcript[7].bot, [
            'No order has been placed yet',
            'nothing was processed',
          ], 'Draft cancellation reply');

          const orders = await getOrdersForSender(senderId);
          assert(
            orders.length === 1,
            `Expected the previous confirmed order to remain the only order, received ${orders.length}.`
          );
          assert(
            orders[0].orderStatus === 'confirmed',
            `Expected previous order to remain confirmed, received ${orders[0].orderStatus}.`
          );
        },
      },
      {
        name: 'Cancel during contact_collection clears the draft without placing an order',
        senderId: buildSender(runId, 'contact-cancel'),
        messages: [
          'I want Oversized Casual Top in black, M size',
          'cancel',
        ],
        verify: async ({ transcript, senderId }) => {
          assertIncludes(transcript[1].bot, [
            'No order has been placed yet',
            'nothing was processed',
          ], 'Cancel during contact collection reply');

          const orders = await getOrdersForSender(senderId);
          assert(
            orders.length === 0,
            `Expected no orders after draft cancellation, received ${orders.length}.`
          );

          const conversationState = await getConversationState(senderId);
          assert(
            conversationState?.pendingStep === 'none',
            `Expected pendingStep none after draft cancellation, received ${String(conversationState?.pendingStep)}.`
          );
          assert(
            !conversationState?.orderDraft,
            'Expected orderDraft to be null after draft cancellation.'
          );
        },
      },
      {
        name: 'Quantity update confirmation reserves only the delta once',
        senderId: buildSender(runId, 'quantity-reserve'),
        before: async ({ context }) => {
          context.productBefore = await getProductInventoryByName('Relaxed Linen Pants');
          assert(context.productBefore?.inventory, 'Expected Relaxed Linen Pants inventory before quantity reserve test.');
        },
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Quantity Reserve Customer',
          '12 Main Street, Kurunegala',
          '0771009292',
          'yes correct',
          'yes correct',
          'can you increase order count of last order to 2',
          'yes correct',
          'yes correct',
        ],
        verify: async ({ transcript, senderId, context }) => {
          assertIncludes(transcript[6].bot, [
            'Order Update Summary',
            'Quantity: 2',
          ], 'Quantity update summary');
          assertIncludes(transcript[7].bot, [
            'updated successfully',
            'Quantity: 2',
          ], 'Quantity update confirmation');
          assertIncludes(transcript[8].bot, [
            'already confirmed',
          ], 'Duplicate quantity confirmation acknowledgement');

          const orders = await getOrdersForSender(senderId);
          assert(orders.length === 1, `Expected one order after quantity update, received ${orders.length}.`);
          assert(
            orders[0].orderItems[0].quantity === 2,
            `Expected updated quantity 2, received ${orders[0].orderItems[0].quantity}.`
          );

          const productAfter = await getProductInventoryByName('Relaxed Linen Pants');
          const before = context.productBefore;
          assert(productAfter?.inventory, 'Expected Relaxed Linen Pants inventory after quantity reserve test.');
          assert(
            productAfter.inventory.availableQty === before.inventory.availableQty - 2,
            `Expected availableQty delta -2, before ${before.inventory.availableQty}, after ${productAfter.inventory.availableQty}.`
          );
          assert(
            productAfter.inventory.reservedQty === before.inventory.reservedQty + 2,
            `Expected reservedQty delta +2, before ${before.inventory.reservedQty}, after ${productAfter.inventory.reservedQty}.`
          );
          assert(
            productAfter.stock === before.stock - 2,
            `Expected product stock delta -2, before ${before.stock}, after ${productAfter.stock}.`
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
            "Got it — I've updated the address.",
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
          assert(
            latestOrder.orderStatus === 'confirmed',
            `Expected gift update to keep order confirmed, received ${latestOrder.orderStatus}.`
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
        name: 'Existing order IDs owned by another customer are not exposed',
        senderId: buildSender(runId, 'foreign-order-owner'),
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Foreign Owner Customer',
          '12 Main Street, Kurunegala',
          '0771005656',
          'yes correct',
          'yes correct',
        ],
        verify: async ({ senderId }) => {
          const { latestOrder } = await getLatestOrderForSender(senderId);
          assert(latestOrder, 'Expected owner order before foreign order lookup test.');

          const intruderSenderId = `${senderId}-intruder`;
          createdSenders.push({ senderId: intruderSenderId, channel: 'messenger' });
          await resetConversation(intruderSenderId);

          const intruderTranscript = await runConversation({
            senderId: intruderSenderId,
            messages: [`What is the status of #${latestOrder.id}`],
            baseUrl,
            pageId: DEFAULT_PAGE_ID,
            reset: false,
          });

          console.log(formatTranscript(intruderTranscript));

          assertIncludes(intruderTranscript[0].bot, [
            `I could not find order #${latestOrder.id} for this conversation.`,
          ], 'Foreign order lookup rejection');
          assert(
            !intruderTranscript[0].bot.includes('Relaxed Linen Pants') &&
              !intruderTranscript[0].bot.includes('Confirmed stage'),
            `Foreign order lookup leaked owner order details.\n\nActual reply:\n${intruderTranscript[0].bot}`
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
      {
        name: 'Self-service contact update edits active order before dispatch',
        senderId: buildSender(runId, 'self-service-contact'),
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Self Service Contact Customer',
          '12 Main Street, Kurunegala',
          '0771003030',
          'yes correct',
          'yes correct',
          'Please update delivery details for my last order\nAddress: 99 Self Service Road, Colombo\nPhone: 0771234500',
        ],
        verify: async ({ transcript, senderId }) => {
          assertIncludes(transcript[6].bot, [
            'I have updated order #',
            'Address: 99 Self Service Road, Colombo',
            'Phone Number: 0771234500',
          ], 'Self-service contact update reply');

          const { customer, latestOrder } = await getLatestOrderForSender(senderId);
          assert(latestOrder, 'Expected an order for the self-service contact update test.');
          assert(
            latestOrder.deliveryAddress === '99 Self Service Road, Colombo',
            `Expected delivery address to update, received ${String(latestOrder.deliveryAddress)}.`
          );
          assert(
            customer?.phone === '0771234500',
            `Expected customer phone to update, received ${String(customer?.phone)}.`
          );

          const escalation = await prisma.supportEscalation.findFirst({
            where: { senderId, channel: 'messenger' },
          });
          assert(!escalation, 'Did not expect support escalation for an eligible contact update.');
        },
      },
      {
        name: 'Tracking status reply includes courier details when available',
        senderId: buildSender(runId, 'tracking-status'),
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Tracking Status Customer',
          '12 Main Street, Kurunegala',
          '0771003131',
          'yes correct',
          'yes correct',
        ],
        verify: async ({ senderId }) => {
          const { latestOrder } = await getLatestOrderForSender(senderId);
          assert(latestOrder, 'Expected an order before tracking status follow-up.');

          await prisma.order.update({
            where: { id: latestOrder.id },
            data: {
              orderStatus: 'dispatched',
              trackingNumber: 'TRK-SELF-123',
              courier: 'CityCourier',
            },
          });

          const followUpTranscript = await runConversation({
            senderId,
            messages: ['What is the status of last order'],
            baseUrl,
            pageId: DEFAULT_PAGE_ID,
            reset: false,
          });

          console.log(formatTranscript(followUpTranscript));

          assertIncludes(followUpTranscript[0].bot, [
            `Order #${latestOrder.id} is currently at the Dispatched stage`,
            'Tracking: TRK-SELF-123 via CityCourier.',
          ], 'Tracking status reply');
        },
      },
      {
        name: 'Self-service contact update after dispatch escalates without editing order',
        senderId: buildSender(runId, 'self-service-contact-blocked'),
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Blocked Contact Customer',
          '12 Main Street, Kurunegala',
          '0771003232',
          'yes correct',
          'yes correct',
        ],
        verify: async ({ senderId }) => {
          const { latestOrder } = await getLatestOrderForSender(senderId);
          assert(latestOrder, 'Expected an order before blocked contact update follow-up.');

          await prisma.order.update({
            where: { id: latestOrder.id },
            data: {
              orderStatus: 'dispatched',
              trackingNumber: 'TRK-BLOCKED-1',
              courier: 'CityCourier',
            },
          });

          const followUpTranscript = await runConversation({
            senderId,
            messages: ['Please update address of my last order to 55 Late Road, Colombo'],
            baseUrl,
            pageId: DEFAULT_PAGE_ID,
            reset: false,
          });

          console.log(formatTranscript(followUpTranscript));

          assertIncludes(followUpTranscript[0].bot, [
            `Order #${latestOrder.id} is already at the dispatched stage`,
            'cannot update delivery details automatically',
            'I have also flagged this conversation for a team follow-up.',
          ], 'Blocked contact update reply');

          const orderAfter = await prisma.order.findUnique({
            where: { id: latestOrder.id },
          });
          assert(
            orderAfter?.deliveryAddress === '12 Main Street, Kurunegala',
            `Expected dispatched order address to remain unchanged, received ${String(orderAfter?.deliveryAddress)}.`
          );

          const escalation = await prisma.supportEscalation.findFirst({
            where: { senderId, channel: 'messenger' },
            orderBy: { updatedAt: 'desc' },
          });
          assert(escalation, 'Expected support escalation for blocked contact update.');
          assert(
            escalation.reason === 'delivery_issue',
            `Expected delivery_issue escalation, received ${String(escalation.reason)}.`
          );
          assert(
            escalation.orderId === latestOrder.id,
            `Expected escalation to link order ${latestOrder.id}, received ${String(escalation.orderId)}.`
          );
        },
      },
      {
        name: 'Explicit human request for contact update keeps human handoff',
        senderId: buildSender(runId, 'self-service-contact-human'),
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Contact Human Customer',
          '12 Main Street, Kurunegala',
          '0771003233',
          'yes correct',
          'yes correct',
          'I need to talk to someone to update address of my last order',
        ],
        verify: async ({ transcript, senderId }) => {
          assertIncludes(transcript[6].bot, [
            'I want to make sure you get the right help for this support request.',
            'I have also flagged this conversation for a team follow-up.',
          ], 'Human contact update handoff reply');
          assert(
            !transcript[6].bot.includes('please send the new delivery address'),
            `Explicit human request should not be converted into a self-service prompt.\n\nActual reply:\n${transcript[6].bot}`
          );

          const { latestOrder } = await getLatestOrderForSender(senderId);
          assert(latestOrder, 'Expected an order for the human contact update handoff test.');

          const escalation = await prisma.supportEscalation.findFirst({
            where: { senderId, channel: 'messenger' },
            orderBy: { updatedAt: 'desc' },
          });
          assert(escalation, 'Expected support escalation for explicit human contact update request.');
          assert(
            escalation.reason === 'human_request',
            `Expected human_request escalation, received ${String(escalation.reason)}.`
          );
          assert(
            escalation.orderId === latestOrder.id,
            `Expected escalation to link order ${latestOrder.id}, received ${String(escalation.orderId)}.`
          );
        },
      },
      {
        name: 'Self-service cancellation after dispatch escalates without cancelling',
        senderId: buildSender(runId, 'self-service-cancel-blocked'),
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Blocked Cancel Customer',
          '12 Main Street, Kurunegala',
          '0771003334',
          'yes correct',
          'yes correct',
        ],
        verify: async ({ senderId }) => {
          const { latestOrder } = await getLatestOrderForSender(senderId);
          assert(latestOrder, 'Expected an order before blocked cancellation follow-up.');

          await prisma.order.update({
            where: { id: latestOrder.id },
            data: {
              orderStatus: 'dispatched',
              trackingNumber: 'TRK-CANCEL-1',
              courier: 'CityCourier',
            },
          });

          const followUpTranscript = await runConversation({
            senderId,
            messages: ['Cancel my last order'],
            baseUrl,
            pageId: DEFAULT_PAGE_ID,
            reset: false,
          });

          console.log(formatTranscript(followUpTranscript));

          assertIncludes(followUpTranscript[0].bot, [
            `Order #${latestOrder.id} is already at the dispatched stage`,
            'cannot cancel it automatically',
            'I have also flagged this conversation for a team follow-up.',
          ], 'Blocked cancellation reply');

          const orderAfter = await prisma.order.findUnique({
            where: { id: latestOrder.id },
          });
          assert(
            orderAfter?.orderStatus === 'dispatched',
            `Expected dispatched order to remain dispatched, received ${String(orderAfter?.orderStatus)}.`
          );

          const escalation = await prisma.supportEscalation.findFirst({
            where: { senderId, channel: 'messenger' },
            orderBy: { updatedAt: 'desc' },
          });
          assert(escalation, 'Expected support escalation for blocked cancellation.');
          assert(
            escalation.reason === 'human_request',
            `Expected human_request escalation, received ${String(escalation.reason)}.`
          );
          assert(
            escalation.orderId === latestOrder.id,
            `Expected escalation to link order ${latestOrder.id}, received ${String(escalation.orderId)}.`
          );
        },
      },
      {
        name: 'Reorder after cancellation reuses the cancelled order details cleanly',
        senderId: buildSender(runId, 'reorder-cancelled'),
        before: async ({ context }) => {
          context.productBefore = await getProductInventoryByName('Oversized Casual Top');
          assert(context.productBefore?.inventory, 'Expected Oversized Casual Top inventory before cancellation test.');
        },
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
        verify: async ({ transcript, senderId, context }) => {
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

          const productAfterCancellation = await getProductInventoryByName('Oversized Casual Top');
          const before = context.productBefore;
          assert(productAfterCancellation?.inventory, 'Expected Oversized Casual Top inventory after cancellation test.');
          assert(
            productAfterCancellation.inventory.availableQty === before.inventory.availableQty,
            `Expected cancellation to return available stock, before ${before.inventory.availableQty}, after ${productAfterCancellation.inventory.availableQty}.`
          );
          assert(
            productAfterCancellation.inventory.reservedQty === before.inventory.reservedQty,
            `Expected cancellation to release reserved stock, before ${before.inventory.reservedQty}, after ${productAfterCancellation.inventory.reservedQty}.`
          );
          assert(
            productAfterCancellation.stock === before.stock,
            `Expected cancellation to restore product stock, before ${before.stock}, after ${productAfterCancellation.stock}.`
          );

          const reorderConfirmationTranscript = await runConversation({
            senderId,
            messages: ['yes correct', 'yes correct'],
            baseUrl,
            pageId: DEFAULT_PAGE_ID,
            reset: false,
          });

          console.log(formatTranscript(reorderConfirmationTranscript));

          assertIncludes(reorderConfirmationTranscript[0].bot, [
            'Order Summary',
            'Product: Oversized Casual Top',
            'Size: Medium',
            'Color: Black',
          ], 'Reorder summary reply');
          assertIncludes(reorderConfirmationTranscript[1].bot, [
            'Thank you. Your order has been confirmed successfully ✅',
            'Order ID: #',
            'Current Stage: Confirmed',
          ], 'Reorder confirmation reply');

          const ordersAfterReorder = await getOrdersForSender(senderId);
          assert(
            ordersAfterReorder.length === 2,
            `Expected original cancelled order and new reorder, received ${ordersAfterReorder.length} order(s).`
          );
          assert(
            ordersAfterReorder[0].orderStatus === 'cancelled' &&
              ordersAfterReorder[1].orderStatus === 'confirmed',
            `Expected cancelled then confirmed reorder statuses, received ${ordersAfterReorder.map((order) => order.orderStatus).join(', ')}.`
          );
          assert(
            ordersAfterReorder[1].orderItems[0].productId === ordersAfterReorder[0].orderItems[0].productId &&
              ordersAfterReorder[1].orderItems[0].quantity === ordersAfterReorder[0].orderItems[0].quantity,
            'Expected reorder to use the same product and quantity as the cancelled source order.'
          );

          const productAfterReorder = await getProductInventoryByName('Oversized Casual Top');
          assert(productAfterReorder?.inventory, 'Expected Oversized Casual Top inventory after reorder confirmation.');
          assert(
            productAfterReorder.inventory.availableQty === before.inventory.availableQty - 1,
            `Expected reorder to reserve one available unit, before ${before.inventory.availableQty}, after ${productAfterReorder.inventory.availableQty}.`
          );
          assert(
            productAfterReorder.inventory.reservedQty === before.inventory.reservedQty + 1,
            `Expected reorder to reserve one unit, before ${before.inventory.reservedQty}, after ${productAfterReorder.inventory.reservedQty}.`
          );
          assert(
            productAfterReorder.stock === before.stock - 1,
            `Expected reorder to decrement product stock once, before ${before.stock}, after ${productAfterReorder.stock}.`
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
        name: 'Neutral acknowledgement during contact confirmation re-opens the prompt warmly',
        senderId: buildSender(runId, 'neutral-ack-contact'),
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Neutral Ack Customer',
          '12 Main Street, Kurunegala',
          '0771007171',
          'okay',
        ],
        verify: async ({ transcript }) => {
          assertIncludes(transcript[4].bot, [
            'Whenever you are ready, reply "yes" to confirm the delivery details',
          ], 'Neutral acknowledgement reply during contact confirmation');
          assert(
            !transcript[4].bot.includes('Please confirm the delivery details or send the correction you need.'),
            `Neutral ack still uses the old terse confirmation prompt.\n\nActual reply:\n${transcript[4].bot}`
          );
        },
      },
      {
        name: 'Order summary uses the polished close-out wording',
        senderId: buildSender(runId, 'summary-wording'),
        messages: [
          'I want Relaxed Linen Pants in beige, M size',
          'Summary Wording Customer',
          '12 Main Street, Kurunegala',
          '0771007272',
          'yes correct',
        ],
        verify: async ({ transcript }) => {
          assertIncludes(transcript[4].bot, [
            'Order Summary',
            'Reply "yes" to confirm, or tell me what to change.',
          ], 'Polished order summary wording');
          assertIncludes(transcript[3].bot, [
            'Please confirm if these delivery details are correct:',
            'Reply "yes" to confirm, or send the correction you need.',
          ], 'Polished contact confirmation wording');
        },
      },
      {
        name: 'Unclear request gets warmer fallback wording before escalation',
        senderId: buildSender(runId, 'fallback-wording'),
        messages: ['blargh blargh blargh'],
        verify: async ({ transcript }) => {
          assertIncludes(transcript[0].bot, [
            "Sorry, I didn't quite catch that.",
          ], 'Polished fallback wording');
          assert(
            !transcript[0].bot.includes('I am not fully sure I understood that.'),
            `Fallback still uses the stiff legacy wording.\n\nActual reply:\n${transcript[0].bot}`
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
        verify: async ({ transcript, senderId }) => {
          assertIncludes(transcript[6].bot, [
            'Please confirm if these delivery details are correct:',
            'Name: Explicit Lookup Customer',
            'Address: 12 Main Street, Kurunegala',
            'Phone Number: 0771008888',
          ], 'Existing-customer contact confirmation reply');
          assertIncludes(transcript[7].bot, [
            'Order Summary',
            'Product: Relaxed Linen Pants',
            'Size: Medium',
            'Color: Beige',
          ], 'Existing-customer second order summary');
          assertIncludes(transcript[8].bot, [
            'Thank you. Your order has been confirmed successfully ✅',
            'Order ID: #',
          ], 'Existing-customer second order confirmation');

          const orders = await getOrdersForSender(senderId);
          assert(orders.length === 2, `Expected two orders for explicit lookup test, received ${orders.length}.`);

          const [firstOrder, secondOrder] = orders;
          assert(
            firstOrder.id !== secondOrder.id,
            'Expected two distinct orders for explicit order lookup test.'
          );

          const firstProductBeforeUpdate = await getProductInventoryByName('Oversized Casual Top');
          assert(firstProductBeforeUpdate?.inventory, 'Expected Oversized Casual Top inventory before explicit quantity update.');

          const followUpTranscript = await runConversation({
            senderId,
            messages: [
              `Send me order details of #${firstOrder.id}`,
              'Please add gift wrap to that order with a Happy Birthday note',
              `Change quantity of order #${firstOrder.id} to 2`,
              'yes correct',
              'What is the status of last order',
            ],
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

          assertIncludes(followUpTranscript[1].bot, [
            `I have updated order #${firstOrder.id}`,
            'Gift wrap requested',
            'Gift Note: Happy Birthday',
          ], 'That-order gift update reply');

          assertIncludes(followUpTranscript[2].bot, [
            'Order Update Summary',
            `Order ID: #${firstOrder.id}`,
            'Quantity: 2',
          ], 'Explicit order quantity update summary');
          assertIncludes(followUpTranscript[3].bot, [
            'updated successfully',
            `Order ID: #${firstOrder.id}`,
            'Quantity: 2',
          ], 'Explicit order quantity update confirmation');

          const ordersAfterFollowUp = await getOrdersForSender(senderId);
          const firstAfterFollowUp = ordersAfterFollowUp.find((order) => order.id === firstOrder.id);
          const secondAfterFollowUp = ordersAfterFollowUp.find((order) => order.id === secondOrder.id);
          assert(firstAfterFollowUp?.giftWrap === true, 'Expected gift wrap to apply to the explicitly referenced order.');
          assert(
            firstAfterFollowUp?.giftNote === 'Happy Birthday',
            `Expected first order gift note Happy Birthday, received ${firstAfterFollowUp?.giftNote}.`
          );
          assert(
            firstAfterFollowUp?.orderItems[0].quantity === 2,
            `Expected explicitly referenced first order quantity 2, received ${firstAfterFollowUp?.orderItems[0].quantity}.`
          );
          assert(
            secondAfterFollowUp?.giftWrap === false,
            'Expected that-order gift update not to modify the latest order.'
          );
          assert(
            secondAfterFollowUp?.orderItems[0].quantity === 1,
            `Expected latest order quantity to remain 1, received ${secondAfterFollowUp?.orderItems[0].quantity}.`
          );

          const firstProductAfterUpdate = await getProductInventoryByName('Oversized Casual Top');
          const inventoryBefore = firstProductBeforeUpdate.inventory;
          assert(firstProductAfterUpdate?.inventory, 'Expected Oversized Casual Top inventory after explicit quantity update.');
          assert(
            firstProductAfterUpdate.inventory.availableQty === inventoryBefore.availableQty - 1,
            `Expected explicit quantity update to reserve one additional top, before ${inventoryBefore.availableQty}, after ${firstProductAfterUpdate.inventory.availableQty}.`
          );
          assert(
            firstProductAfterUpdate.inventory.reservedQty === inventoryBefore.reservedQty + 1,
            `Expected explicit quantity update to add one reserved top, before ${inventoryBefore.reservedQty}, after ${firstProductAfterUpdate.inventory.reservedQty}.`
          );
          assert(
            firstProductAfterUpdate.stock === firstProductBeforeUpdate.stock - 1,
            `Expected explicit quantity update to decrement product stock once, before ${firstProductBeforeUpdate.stock}, after ${firstProductAfterUpdate.stock}.`
          );

          assertIncludes(followUpTranscript[4].bot, [
            `Order #${secondOrder.id} is currently at the Confirmed stage`,
          ], 'Last-order status reply after explicit reference');
        },
      },
      // ─── Variant inventory regression tests ───────────────────────────────
      {
        name: 'Variant order reserves from the correct size+color variant inventory',
        senderId: buildSender(runId, 'variant-reserve'),
        before: async ({ context }) => {
          const product = await prisma.product.findFirst({
            where: { name: 'Oversized Casual Top' },
            include: { variants: { include: { inventory: true } } },
          });
          assert(product, 'Expected Oversized Casual Top for variant reserve test.');
          context.variantBefore = product.variants.find(v => v.size === 'M' && v.color === 'Black');
          assert(context.variantBefore?.inventory, 'Expected M/Black variant inventory before variant reserve test.');
          context.productBefore = product;
        },
        messages: [
          'I want Oversized Casual Top in black, M size',
          'Variant Reserve Customer',
          '12 Main Street, Kurunegala',
          '0771020001',
          'yes correct',
          'yes correct',
        ],
        verify: async ({ transcript, senderId, context }) => {
          assertIncludes(transcript[5].bot, [
            'Thank you. Your order has been confirmed successfully ✅',
            'Order ID: #',
          ], 'Variant order placed reply');

          const { latestOrder } = await getLatestOrderForSender(senderId);
          assert(latestOrder, 'Expected an order to be created for variant reserve test.');
          assert(
            latestOrder.orderStatus === 'confirmed',
            `Expected confirmed status, received ${latestOrder.orderStatus}.`
          );
          assert(
            latestOrder.orderItems[0].size === 'M',
            `Expected size M, received ${latestOrder.orderItems[0].size}.`
          );
          assert(
            latestOrder.orderItems[0].color === 'Black',
            `Expected color Black, received ${latestOrder.orderItems[0].color}.`
          );
          assert(
            latestOrder.orderItems[0].variantId != null,
            'Expected variantId to be set on the order item.'
          );

          const productAfter = await prisma.product.findFirst({
            where: { name: 'Oversized Casual Top' },
            include: { variants: { include: { inventory: true } } },
          });
          const variantAfter = productAfter?.variants.find(v => v.size === 'M' && v.color === 'Black');
          const vBefore = context.variantBefore;

          assert(
            variantAfter?.inventory?.availableQty === vBefore.inventory.availableQty - 1,
            `Expected M/Black variant availableQty delta -1, before ${vBefore.inventory.availableQty}, after ${variantAfter?.inventory?.availableQty}.`
          );
          assert(
            variantAfter?.inventory?.reservedQty === vBefore.inventory.reservedQty + 1,
            `Expected M/Black variant reservedQty delta +1, before ${vBefore.inventory.reservedQty}, after ${variantAfter?.inventory?.reservedQty}.`
          );
        },
      },
      {
        name: 'Cancellation restores the correct variant inventory',
        senderId: buildSender(runId, 'variant-cancel'),
        before: async ({ context }) => {
          const product = await prisma.product.findFirst({
            where: { name: 'Oversized Casual Top' },
            include: { variants: { include: { inventory: true } } },
          });
          assert(product, 'Expected Oversized Casual Top for variant cancel test.');
          context.variantBefore = product.variants.find(v => v.size === 'M' && v.color === 'Black');
          assert(context.variantBefore?.inventory, 'Expected M/Black variant inventory before cancel test.');
        },
        messages: [
          'I want Oversized Casual Top in black, M size',
          'Variant Cancel Customer',
          '12 Main Street, Kurunegala',
          '0771020002',
          'yes correct',
          'yes correct',
          'Cancel my order',
        ],
        verify: async ({ transcript, context }) => {
          assertIncludes(transcript[6].bot, [
            'Cancelled Order ID: #',
          ], 'Variant order cancellation reply');

          const productAfter = await prisma.product.findFirst({
            where: { name: 'Oversized Casual Top' },
            include: { variants: { include: { inventory: true } } },
          });
          const variantAfter = productAfter?.variants.find(v => v.size === 'M' && v.color === 'Black');
          const vBefore = context.variantBefore;

          assert(
            variantAfter?.inventory?.availableQty === vBefore.inventory.availableQty,
            `Expected M/Black variant availableQty restored after cancel, before ${vBefore.inventory.availableQty}, after ${variantAfter?.inventory?.availableQty}.`
          );
          assert(
            variantAfter?.inventory?.reservedQty === vBefore.inventory.reservedQty,
            `Expected M/Black variant reservedQty restored after cancel, before ${vBefore.inventory.reservedQty}, after ${variantAfter?.inventory?.reservedQty}.`
          );
        },
      },
      {
        name: 'Ordering an out-of-stock variant is rejected with a helpful reply',
        senderId: buildSender(runId, 'variant-oos'),
        before: async () => {
          // Set M/Black Oversized Casual Top variant to 0 for this test
          await prisma.variantInventory.updateMany({
            where: {
              variant: { product: { name: 'Oversized Casual Top' }, size: 'L', color: 'White' },
            },
            data: { availableQty: 0 },
          });
        },
        messages: [
          'I want Oversized Casual Top in white, L size',
          'OOS Variant Customer',
          '12 Main Street, Kurunegala',
          '0771020003',
          'yes correct',
          'yes correct',
        ],
        verify: async ({ transcript }) => {
          // The order should be blocked — either at variant prompt or at quantity check
          const allReplies = transcript.map(t => t.bot).join('\n');
          assert(
            allReplies.includes('available') || allReplies.includes('not available') || allReplies.includes('0 item'),
            `Expected out-of-stock variant to be rejected.\n\nTranscript:\n${allReplies}`
          );
        },
      },
      {
        name: 'Variant-aware availability reply distinguishes which sizes+colors are in stock',
        senderId: buildSender(runId, 'variant-avail'),
        messages: [
          'What colors does the Ribbed Crop Top come in?',
        ],
        verify: async ({ transcript }) => {
          assertIncludes(transcript[0].bot, [
            'Ribbed Crop Top',
          ], 'Variant availability reply mentions product');
          // The reply should mention available colors (Beige or Pink) or sizes (S or M)
          assert(
            transcript[0].bot.includes('Beige') || transcript[0].bot.includes('Pink'),
            `Expected variant colors in availability reply.\n\nActual reply:\n${transcript[0].bot}`
          );
        },
      },
    ];

    // Remove the one-time reset — we reset before every case instead.
    for (const testCase of cases) {
      await resetInventoryToSeedValues();
      const testChannel = testCase.channel || 'messenger';
      createdSenders.push({ senderId: testCase.senderId, channel: testChannel });
      console.log(`\n=== ${testCase.name} ===`);
      const context = {};

      if (testCase.before) {
        await testCase.before({
          senderId: testCase.senderId,
          channel: testChannel,
          baseUrl,
          pageId: DEFAULT_PAGE_ID,
          accountId: DEFAULT_INSTAGRAM_ID,
          context,
        });
      }

      const transcript = await runConversation({
        senderId: testCase.senderId,
        messages: testCase.messages,
        baseUrl,
        pageId: DEFAULT_PAGE_ID,
        accountId: DEFAULT_INSTAGRAM_ID,
        channel: testChannel,
        reset: true,
      });

      console.log(formatTranscript(transcript));
      await testCase.verify({
        transcript,
        senderId: testCase.senderId,
        channel: testChannel,
        context,
      });

      console.log(`PASS: ${testCase.name}`);
      await resetConversation(testCase.senderId, testChannel);
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
    for (const entry of createdSenders) {
      try {
        await resetConversation(entry.senderId, entry.channel);
      } catch (error) {
        console.error(`Cleanup failed for ${entry.senderId}:`, error);
      }
    }

    if (server) {
      await server.stop();
    }

    await disconnect();
  }
}

main();
