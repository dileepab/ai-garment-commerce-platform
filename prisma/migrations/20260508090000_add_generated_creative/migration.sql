-- CreateTable
CREATE TABLE "GeneratedCreative" (
    "id" SERIAL NOT NULL,
    "brand" TEXT NOT NULL,
    "sourceImageUrl" TEXT,
    "generatedImageData" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "personaStyle" TEXT,
    "productContext" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedCreative_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GeneratedCreative_brand_status_createdAt_idx" ON "GeneratedCreative"("brand", "status", "createdAt");
