-- Size charts as data rather than as one PNG per brand per garment type.
--
-- The pictures showed the same numbers for every dress a brand sold, including
-- the sizes it was not made in, and a length that belonged to whichever dress
-- the artwork was drawn for. A maxi and a midi are not the same garment at
-- size M, and that is the measurement customers ask about before they buy.

-- What a brand grades one garment type to, before any product exists.
CREATE TABLE "SizeChartTemplate" (
    "id" SERIAL NOT NULL,
    "brandKey" TEXT NOT NULL,
    "garmentType" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'in',
    "columnsJson" TEXT NOT NULL,
    "rowsJson" TEXT NOT NULL,
    "footerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SizeChartTemplate_pkey" PRIMARY KEY ("id")
);

-- One template per brand and type. This is what makes saving a template an
-- upsert rather than a growing pile of near-identical rows.
CREATE UNIQUE INDEX "SizeChartTemplate_brandKey_garmentType_key" ON "SizeChartTemplate"("brandKey", "garmentType");

-- One product's own chart: a snapshot taken at creation, edited by hand after.
CREATE TABLE "ProductSizeChart" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "garmentType" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'in',
    "columnsJson" TEXT NOT NULL,
    "rowsJson" TEXT NOT NULL,
    "footerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSizeChart_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductSizeChart_productId_key" ON "ProductSizeChart"("productId");

-- Deleting a product takes its chart with it; a chart has no meaning alone.
ALTER TABLE "ProductSizeChart" ADD CONSTRAINT "ProductSizeChart_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
