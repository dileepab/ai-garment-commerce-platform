/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client');
const { testCatalog } = require('./catalog-data');
const prisma = new PrismaClient();

async function main() {
  console.log('Clearing existing data...');
  // Delete in correct order to avoid foreign key constraints
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.product.deleteMany();

  console.log('Seeding Products...');
  const createdProducts = new Map();

  for (const product of testCatalog) {
    const createdProduct = await prisma.product.create({
      data: {
        ...product,
        inventory: { create: { availableQty: product.stock } },
      },
    });

    createdProducts.set(`${product.brand}:${product.name}`, createdProduct);
  }

  console.log('Seeding Customers and Orders...');
  const cust1 = await prisma.customer.create({
    data: { name: 'Amal Perera', phone: '0771234567', channel: 'messenger', preferredBrand: 'Happyby' }
  });
  
  const cust2 = await prisma.customer.create({
    data: { name: 'Nethmi Fernando', phone: '0719876543', channel: 'instagram', preferredBrand: 'Cleopatra' }
  });

  await prisma.order.create({
    data: {
      customerId: cust1.id,
      brand: 'Happyby',
      totalAmount: 1750,
      orderStatus: 'confirmed',
      paymentMethod: 'Bank Transfer',
      deliveryAddress: 'Negombo, Sri Lanka',
      orderItems: {
        create: [
          {
            productId: createdProducts.get('Happyby:Oversized Casual Top').id,
            quantity: 1,
            price: 1750,
            size: 'M',
            color: 'Black',
          }
        ]
      }
    }
  });

  await prisma.order.create({
    data: {
      customerId: cust2.id,
      brand: 'Cleopatra',
      totalAmount: 8500,
      orderStatus: 'dispatched',
      paymentMethod: 'COD',
      deliveryAddress: 'Colombo 07, Sri Lanka',
      orderItems: {
        create: [
          {
            productId: createdProducts.get('Cleopatra:Premium Evening Gown').id,
            quantity: 1,
            price: 8500,
            size: 'M',
            color: 'Red',
          }
        ]
      }
    }
  });

  console.log('Database successfully seeded with realistic garment platform data!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
