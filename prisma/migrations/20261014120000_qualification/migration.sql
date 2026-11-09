-- CreateEnum
CREATE TYPE "QualDecision" AS ENUM ('QUALIFIED', 'DISQUALIFIED', 'NEEDS_REVIEW');

-- AlterEnum
ALTER TYPE "BriefSection" ADD VALUE 'QUALIFICATION';

-- AlterEnum
ALTER TYPE "RunStatus" ADD VALUE 'SCREENED_OUT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SourceKind" ADD VALUE 'COMPANY_PROFILE';
ALTER TYPE "SourceKind" ADD VALUE 'JOB_LISTING';

-- AlterTable
ALTER TABLE "ResearchRun" ADD COLUMN     "decision" "QualDecision",
ADD COLUMN     "decisionData" JSONB,
ADD COLUMN     "overriddenAt" TIMESTAMP(3),
ADD COLUMN     "overriddenById" TEXT,
ADD COLUMN     "overrideDecision" "QualDecision",
ADD COLUMN     "overrideNote" TEXT,
ADD COLUMN     "screenBypassed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "QualificationSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "minEmployees" INTEGER NOT NULL,
    "minRevenueUsdM" INTEGER NOT NULL,
    "strongKeywords" TEXT[],
    "weakKeywords" TEXT[],
    "exceptionSectors" TEXT[],
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualificationSettings_pkey" PRIMARY KEY ("id")
);

