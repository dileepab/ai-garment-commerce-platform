import prisma from '../src/lib/prisma.ts';
import { processCourierWebhookUpdate } from '../src/lib/courier-service.ts';
import { transitionFulfillment } from '../src/lib/fulfillment-service.ts';
import { logInfo, logError } from '../src/lib/app-log.ts';

async function main() {
  logInfo('Courier Simulation', 'Starting automated courier webhook integration simulation...');

  // 1. Fetch or create a test customer and order
  let customer = await prisma.customer.findFirst();
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        name: 'Simulated Courier Customer',
        phone: '0771234567',
        channel: 'messenger',
        externalId: 'test-courier-sender-id',
      },
    });
  }

  let order = await prisma.order.create({
    data: {
      customerId: customer.id,
      brand: 'Cleopatra',
      totalAmount: 1850.00,
      paymentMethod: 'COD',
      deliveryAddress: '123 Galle Road, Colombo 03',
      orderStatus: 'pending',
    },
  });

  logInfo('Courier Simulation', `Created test Order #${order.id} with status: ${order.orderStatus}`);

  // 2. Legally advance the order to 'packed' so a dispatched transition is allowed
  const stages = ['confirmed', 'packing', 'packed'] as const;
  for (const stage of stages) {
    await transitionFulfillment({
      orderId: order.id,
      toStatus: stage,
      note: `Simulation prep: moving to ${stage}`,
      actor: { name: 'Fulfillment Sim System' },
      notifyCustomer: false, // Don't try sending real Messenger pings in sim
    });
  }
  
  order = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  logInfo('Courier Simulation', `Successfully prepped Order #${order.id}. Current status: ${order.orderStatus}`);

  // 3. Simulate Koombiyo webhook: "pickup_complete" -> should transition order to "dispatched"
  logInfo('Courier Simulation', 'Simulating Koombiyo pickup webhook callback...');
  let result = await processCourierWebhookUpdate({
    orderId: order.id,
    provider: 'koombiyo',
    trackingNumber: 'KB-SIM-999',
    status: 'pickup_complete',
    notes: 'Parcel picked up by Koombiyo agent.',
  });

  order = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  logInfo('Courier Simulation', `Koombiyo Pickup Result: Order Status is now [${order.orderStatus}], Tracking: [${order.trackingNumber}], Courier: [${order.courier}]`);
  if (order.orderStatus !== 'dispatched') {
    throw new Error(`Expected status to be dispatched, but got ${order.orderStatus}`);
  }

  // 4. Simulate Koombiyo webhook: "delivered" -> should transition order to "delivered"
  logInfo('Courier Simulation', 'Simulating Koombiyo success delivery webhook callback...');
  result = await processCourierWebhookUpdate({
    orderId: order.id,
    provider: 'koombiyo',
    trackingNumber: 'KB-SIM-999',
    status: 'delivered',
    notes: 'Successfully delivered to customer Galle Road address and cash collected.',
  });

  order = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  logInfo('Courier Simulation', `Koombiyo Delivery Result: Order Status is now [${order.orderStatus}]`);
  if (order.orderStatus !== 'delivered') {
    throw new Error(`Expected status to be delivered, but got ${order.orderStatus}`);
  }

  // 5. Clean up simulated order
  await prisma.orderFulfillmentEvent.deleteMany({ where: { orderId: order.id } });
  await prisma.order.delete({ where: { id: order.id } });
  logInfo('Courier Simulation', 'Simulation order cleaned up successfully.');
  logInfo('Courier Simulation', '🎉 Automated courier webhook integration simulation passed 100% successfully!');
}

main().catch((err) => {
  logError('Courier Simulation', 'Simulation failed.', err);
  process.exit(1);
});
