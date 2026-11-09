-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT');

-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "originalStatement" TEXT;

-- CreateTable
CREATE TABLE "BriefMessage" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "citations" TEXT[],
    "proposals" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BriefMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BriefMessage_runId_createdAt_idx" ON "BriefMessage"("runId", "createdAt");

-- AddForeignKey
ALTER TABLE "BriefMessage" ADD CONSTRAINT "BriefMessage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
