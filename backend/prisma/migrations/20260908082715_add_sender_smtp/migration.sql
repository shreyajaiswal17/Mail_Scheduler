-- AlterTable
ALTER TABLE "Sender" ADD COLUMN     "smtpHost" TEXT,
ADD COLUMN     "smtpPasswordEnc" TEXT,
ADD COLUMN     "smtpPort" INTEGER,
ADD COLUMN     "smtpUser" TEXT,
ALTER COLUMN "isActive" SET DEFAULT false;
