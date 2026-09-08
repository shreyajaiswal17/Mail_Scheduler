-- AlterEnum
ALTER TYPE "EmailStatus" ADD VALUE 'NEEDS_REVIEW';

-- AlterTable
ALTER TABLE "EmailJob" ADD COLUMN "claimToken" TEXT,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
ADD COLUMN "smtpAttemptStartedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "EmailJob_status_leaseExpiresAt_idx" ON "EmailJob"("status", "leaseExpiresAt");
