-- CreateTable
CREATE TABLE IF NOT EXISTS "SearchOutbox" (
    "id" TEXT NOT NULL,
    "emailId" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SearchOutbox_emailId_key" ON "SearchOutbox"("emailId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SearchOutbox_status_updatedAt_idx" ON "SearchOutbox"("status", "updatedAt");
