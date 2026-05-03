/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client');
const { testCatalog, variantStocks } = require('./catalog-data');
const prisma = new PrismaClient();

async function main() {
  console.log('Clearing existing data...');
  // Delete in correct order to avoid foreign key constraints
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.variantInventory.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.product.deleteMany();

  console.log('Seeding Products and Variants...');
  const createdProducts = new Map();

  for (const product of testCatalog) {
    const createdProduct = await prisma.product.create({
      data: {
        ...product,
        inventory: { create: { availableQty: product.stock } },
      },
    });

    createdProducts.set(`${product.brand}:${product.name}`, createdProduct);

    // Create per-variant inventory records
    const stockMap = variantStocks[`${product.brand}:${product.name}`];
    if (stockMap) {
      for (const [size, colorMap] of Object.entries(stockMap)) {
        for (const [color, availableQty] of Object.entries(colorMap)) {
          await prisma.productVariant.create({
            data: {
              productId: createdProduct.id,
              size,
              color,
              status: availableQty > 0 ? 'active' : 'out-of-stock',
              inventory: {
                create: { availableQty },
              },
            },
          });
        }
      }
    }
  }

  console.log('Seeding Customers and Orders...');
  const cust1 = await prisma.customer.create({
    data: { name: 'Amal Perera', phone: '0771234567', channel: 'messenger', preferredBrand: 'Happyby' }
  });

  const cust2 = await prisma.customer.create({
    data: { name: 'Nethmi Fernando', phone: '0719876543', channel: 'instagram', preferredBrand: 'Cleopatra' }
  });

  // Seed order 1: reserve from variant inventory (M/Black Oversized Casual Top)
  const product1 = createdProducts.get('Happyby:Oversized Casual Top');
  const variant1 = await prisma.productVariant.findUnique({
    where: { productId_size_color: { productId: product1.id, size: 'M', color: 'Black' } },
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
            productId: product1.id,
            variantId: variant1?.id ?? null,
            quantity: 1,
            price: 1750,
            size: 'M',
            color: 'Black',
          }
        ]
      }
    }
  });

  // Seed order 2: Premium Evening Gown is out of stock at variant level — use M/Red for demo
  const product2 = createdProducts.get('Cleopatra:Premium Evening Gown');
  const variant2 = await prisma.productVariant.findUnique({
    where: { productId_size_color: { productId: product2.id, size: 'M', color: 'Red' } },
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
            productId: product2.id,
            variantId: variant2?.id ?? null,
            quantity: 1,
            price: 8500,
            size: 'M',
            color: 'Red',
          }
        ]
      }
    }
  });

  console.log('Database successfully seeded with variant-level inventory data!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
