-- AlterTable
ALTER TABLE "SlackConnection" ADD COLUMN "channelName" TEXT;

-- CreateTable
CREATE TABLE "SlackNotificationOutbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "senderId" TEXT,
    "channelId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL DEFAULT 'HOURLY_LIMIT',
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlackNotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SlackNotificationOutbox_status_nextAttemptAt_idx" ON "SlackNotificationOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "SlackNotificationOutbox_userId_createdAt_idx" ON "SlackNotificationOutbox"("userId", "createdAt");
