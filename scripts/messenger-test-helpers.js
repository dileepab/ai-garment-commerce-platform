/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DEFAULT_BASE_URL = process.env.SIM_BASE_URL || 'http://127.0.0.1:3001';
const DEFAULT_PAGE_ID = process.env.HAPPYBY_PAGE_ID || '127157417146065';
const DEFAULT_INSTAGRAM_ID = process.env.HAPPYBY_INSTAGRAM_ID || '17841400000000000';

async function sleep(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function resetConversation(senderId, channel = 'messenger') {
  const customer = await prisma.customer.findFirst({
    where: {
      externalId: senderId,
      channel,
    },
    include: {
      orders: {
        include: {
          orderItems: true,
        },
      },
    },
  });

  await prisma.chatMessage.deleteMany({
    where: {
      senderId,
      channel,
    },
  });

  await prisma.conversationState.deleteMany({
    where: {
      senderId,
      channel,
    },
  });

  if (customer) {
    for (const order of customer.orders) {
      if (order.orderStatus !== 'cancelled') {
        for (const item of order.orderItems) {
          const inventory = await prisma.inventory.findUnique({
            where: { productId: item.productId },
          });

          await prisma.inventory.update({
            where: { productId: item.productId },
            data: {
              availableQty: { increment: item.quantity },
              reservedQty: Math.max(0, (inventory?.reservedQty || 0) - item.quantity),
            },
          });

          await prisma.product.update({
            where: { id: item.productId },
            data: {
              stock: { increment: item.quantity },
            },
          });
        }
      }
    }

    const orderIds = customer.orders.map((order) => order.id);

    await prisma.supportEscalation.deleteMany({
      where: {
        OR: [
          { customerId: customer.id },
          { senderId, channel },
          ...(orderIds.length > 0 ? [{ orderId: { in: orderIds } }] : []),
        ],
      },
    });

    await prisma.order.deleteMany({
      where: {
        customerId: customer.id,
      },
    });
  } else {
    await prisma.supportEscalation.deleteMany({
      where: {
        senderId,
        channel,
      },
    });
  }

  await prisma.customer.deleteMany({
    where: {
      externalId: senderId,
      channel,
    },
  });
}

async function getLatestAssistantMessage(senderId, channel = 'messenger') {
  return prisma.chatMessage.findFirst({
    where: {
      senderId,
      channel,
      role: 'assistant',
    },
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      message: true,
      createdAt: true,
    },
  });
}

async function getConversationMessages(senderId, channel = 'messenger') {
  return prisma.chatMessage.findMany({
    where: {
      senderId,
      channel,
    },
    orderBy: {
      createdAt: 'asc',
    },
    select: {
      role: true,
      message: true,
      createdAt: true,
    },
  });
}

async function waitForAssistantReply(senderId, previousCreatedAt, channel = 'messenger') {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const latest = await getLatestAssistantMessage(senderId, channel);

    if (
      latest &&
      (!previousCreatedAt || latest.createdAt.getTime() !== previousCreatedAt.getTime())
    ) {
      return latest;
    }

    await sleep(250);
  }

  return null;
}

function buildMessagingEvent({ senderId, pageOrAccountId, text }) {
  return {
    sender: { id: senderId },
    recipient: { id: pageOrAccountId },
    timestamp: Date.now(),
    message: {
      mid: `mid.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`,
      text,
    },
  };
}

async function postWebhookJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  return {
    status: response.status,
    payload,
  };
}

async function sendMessengerWebhookEvents({
  baseUrl = DEFAULT_BASE_URL,
  pageId = DEFAULT_PAGE_ID,
  events,
}) {
  return postWebhookJson(`${baseUrl}/api/webhooks/meta/messenger`, {
    object: 'page',
    entry: [
      {
        id: pageId,
        messaging: events.map((event) =>
          event.sender ? event : buildMessagingEvent({
            senderId: event.senderId,
            pageOrAccountId: pageId,
            text: event.text,
          })
        ),
      },
    ],
  });
}

async function sendInstagramWebhookEvents({
  baseUrl = DEFAULT_BASE_URL,
  accountId = DEFAULT_INSTAGRAM_ID,
  events,
}) {
  return postWebhookJson(`${baseUrl}/api/webhooks/meta/instagram`, {
    object: 'instagram',
    entry: [
      {
        id: accountId,
        messaging: events.map((event) =>
          event.sender ? event : buildMessagingEvent({
            senderId: event.senderId,
            pageOrAccountId: accountId,
            text: event.text,
          })
        ),
      },
    ],
  });
}

async function sendWebhookMessage({
  baseUrl = DEFAULT_BASE_URL,
  pageId = DEFAULT_PAGE_ID,
  accountId = DEFAULT_INSTAGRAM_ID,
  senderId,
  text,
  channel = 'messenger',
}) {
  if (channel === 'instagram') {
    return sendInstagramWebhookEvents({
      baseUrl,
      accountId,
      events: [{ senderId, text }],
    });
  }

  return sendMessengerWebhookEvents({
    baseUrl,
    pageId,
    events: [{ senderId, text }],
  });
}

async function runConversation({
  senderId,
  messages,
  baseUrl = DEFAULT_BASE_URL,
  pageId = DEFAULT_PAGE_ID,
  accountId = DEFAULT_INSTAGRAM_ID,
  channel = 'messenger',
  reset = false,
}) {
  if (reset) {
    await resetConversation(senderId, channel);
  }

  const transcript = [];

  for (const message of messages) {
    const previousAssistant = await getLatestAssistantMessage(senderId, channel);
    const response = await sendWebhookMessage({
      baseUrl,
      pageId,
      accountId,
      senderId,
      text: message,
      channel,
    });

    const assistantReply = await waitForAssistantReply(
      senderId,
      previousAssistant?.createdAt || null,
      channel
    );

    transcript.push({
      user: message,
      bot: assistantReply?.message || '[no assistant reply recorded]',
      webhook: response,
    });
  }

  return transcript;
}

function formatTranscript(transcript) {
  return transcript
    .map(
      (entry) =>
        `USER: ${entry.user}\nWEBHOOK: ${JSON.stringify(entry.webhook)}\nBOT: ${entry.bot}`
    )
    .join('\n\n');
}

async function disconnect() {
  await prisma.$disconnect();
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_INSTAGRAM_ID,
  DEFAULT_PAGE_ID,
  disconnect,
  formatTranscript,
  getConversationMessages,
  getLatestAssistantMessage,
  prisma,
  resetConversation,
  runConversation,
  sendInstagramWebhookEvents,
  sendMessengerWebhookEvents,
  sendWebhookMessage,
  sleep,
  waitForAssistantReply,
};
