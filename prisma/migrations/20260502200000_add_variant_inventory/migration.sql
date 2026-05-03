-- CreateTable
CREATE TABLE "ProductVariant" (
    "id"            SERIAL NOT NULL,
    "productId"     INTEGER NOT NULL,
    "size"          TEXT NOT NULL,
    "color"         TEXT NOT NULL,
    "sku"           TEXT,
    "priceOverride" DOUBLE PRECISION,
    "status"        TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantInventory" (
    "id"               SERIAL NOT NULL,
    "variantId"        INTEGER NOT NULL,
    "availableQty"     INTEGER NOT NULL DEFAULT 0,
    "reservedQty"      INTEGER NOT NULL DEFAULT 0,
    "inProductionQty"  INTEGER NOT NULL DEFAULT 0,
    "reorderThreshold" INTEGER,
    "updatedAt"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantInventory_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add optional variantId to OrderItem
ALTER TABLE "OrderItem" ADD COLUMN "variantId" INTEGER;

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "ProductVariant_productId_size_color_key" ON "ProductVariant"("productId", "size", "color");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "VariantInventory_variantId_key" ON "VariantInventory"("variantId");

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantInventory" ADD CONSTRAINT "VariantInventory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
