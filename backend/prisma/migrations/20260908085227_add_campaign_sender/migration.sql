/*
  Warnings:

  - A unique constraint covering the columns `[idempotencyKey]` on the table `EmailCampaign` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `senderId` to the `EmailCampaign` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "EmailCampaign" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "senderId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "EmailCampaign_idempotencyKey_key" ON "EmailCampaign"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "EmailCampaign" ADD CONSTRAINT "EmailCampaign_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Sender"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
