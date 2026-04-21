/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client');
const { testCatalog } = require('../prisma/catalog-data');

const prisma = new PrismaClient();

async function main() {
  let createdCount = 0;

  for (const product of testCatalog) {
    const existingProduct = await prisma.product.findFirst({
      where: {
        brand: product.brand,
        name: product.name,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (existingProduct) {
      continue;
    }

    const createdProduct = await prisma.product.create({
      data: {
        ...product,
        inventory: {
          create: {
            availableQty: product.stock,
          },
        },
      },
    });

    createdCount += 1;
    console.log(`Created: ${createdProduct.brand} / ${createdProduct.name}`);
  }

  console.log(`Done. Added ${createdCount} missing test products.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
