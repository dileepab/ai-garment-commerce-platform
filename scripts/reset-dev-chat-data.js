/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const senderId = readOption('--sender');
  const includeOrders = hasFlag('--include-orders');
  const channel = readOption('--channel') || 'messenger';

  const chatWhere = senderId ? { senderId, channel } : {};
  const conversationWhere = senderId ? { senderId, channel } : {};
  const escalationWhere = senderId ? { senderId, channel } : {};

  const deletedMessages = await prisma.chatMessage.deleteMany({
    where: chatWhere,
  });

  const deletedStates = await prisma.conversationState.deleteMany({
    where: conversationWhere,
  });

  const deletedEscalations = await prisma.supportEscalation.deleteMany({
    where: escalationWhere,
  });

  console.log(
    `Removed ${deletedMessages.count} chat messages, ${deletedStates.count} conversation states, and ${deletedEscalations.count} escalations${senderId ? ` for ${senderId}` : ''}.`
  );

  if (!includeOrders) {
    console.log('Orders were not changed. Pass --include-orders only if you intentionally want a full sender cleanup.');
    return;
  }

  if (!senderId) {
    throw new Error('Use --sender <id> together with --include-orders to avoid deleting every order in the database.');
  }

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

  if (!customer) {
    console.log(`No customer record found for sender ${senderId}.`);
    return;
  }

  for (const order of customer.orders) {
    if (order.orderStatus === 'cancelled') {
      continue;
    }

    for (const item of order.orderItems) {
      await prisma.inventory.update({
        where: { productId: item.productId },
        data: {
          availableQty: { increment: item.quantity },
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

  const deletedOrders = await prisma.order.deleteMany({
    where: {
      customerId: customer.id,
    },
  });

  await prisma.customer.delete({
    where: {
      id: customer.id,
    },
  });

  console.log(`Removed ${deletedOrders.count} orders and deleted the customer record for ${senderId}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
