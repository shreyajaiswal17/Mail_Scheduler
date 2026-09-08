-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DISPATCHED', 'FAILED');

-- DropIndex
DROP INDEX "EmailCampaign_idempotencyKey_key";

-- AlterTable
ALTER TABLE "EmailCampaign" ADD COLUMN "payloadHash" TEXT;

-- AlterTable
ALTER TABLE "EmailJob" ADD COLUMN "nextEligibleAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL DEFAULT 'SEND_EMAIL',
    "jobId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_jobId_key" ON "OutboxEvent"("jobId");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_createdAt_idx" ON "OutboxEvent"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailCampaign_userId_idempotencyKey_key" ON "EmailCampaign"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "EmailJob_status_nextEligibleAt_idx" ON "EmailJob"("status", "nextEligibleAt");
