-- AlterEnum
ALTER TYPE "SourceKind" ADD VALUE 'SOCIAL_POST';

-- AlterTable
ALTER TABLE "ResearchRun" ADD COLUMN     "postRuns" INTEGER NOT NULL DEFAULT 0;
