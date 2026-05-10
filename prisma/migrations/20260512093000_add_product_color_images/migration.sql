CREATE TABLE "ProductColorImage" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductColorImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductColorImage_productId_color_key" ON "ProductColorImage"("productId", "color");
CREATE INDEX "ProductColorImage_productId_idx" ON "ProductColorImage"("productId");

ALTER TABLE "ProductColorImage" ADD CONSTRAINT "ProductColorImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
