-- CreateEnum
CREATE TYPE "TeamProfileStatus" AS ENUM ('PENDING', 'REFRESHING', 'READY', 'FAILED');

-- DropForeignKey
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_referenceProfileId_fkey";

-- DropForeignKey
ALTER TABLE "ReferenceProfile" DROP CONSTRAINT "ReferenceProfile_createdById_fkey";

-- AlterTable
ALTER TABLE "Lead" DROP COLUMN "referenceProfileId";

-- AlterTable
ALTER TABLE "ResearchRun" DROP COLUMN "referenceProfileId";

-- DropTable
DROP TABLE "ReferenceProfile";

-- DropEnum
DROP TYPE "ProfileStatus";

-- CreateTable
CREATE TABLE "TeamProfile" (
    "id" TEXT NOT NULL,
    "linkedinUrl" TEXT NOT NULL,
    "fullName" TEXT,
    "headline" TEXT,
    "summary" TEXT,
    "education" JSONB NOT NULL DEFAULT '[]',
    "employment" JSONB NOT NULL DEFAULT '[]',
    "locations" JSONB NOT NULL DEFAULT '[]',
    "expertise" TEXT[],
    "status" "TeamProfileStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "lastRefreshedAt" TIMESTAMP(3),
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamProfile_linkedinUrl_key" ON "TeamProfile"("linkedinUrl");

-- CreateIndex
CREATE INDEX "TeamProfile_status_updatedAt_idx" ON "TeamProfile"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "TeamProfile" ADD CONSTRAINT "TeamProfile_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Seed: the initial team list. Their details are fetched by the worker.
INSERT INTO "TeamProfile" ("id", "linkedinUrl") VALUES
  (gen_random_uuid()::text, 'https://www.linkedin.com/in/olumide-soyombo'),
  (gen_random_uuid()::text, 'https://www.linkedin.com/in/azeez-busari-262a81a1'),
  (gen_random_uuid()::text, 'https://www.linkedin.com/in/piero-trivellato'),
  (gen_random_uuid()::text, 'https://www.linkedin.com/in/massimilianospalazzi'),
  (gen_random_uuid()::text, 'https://www.linkedin.com/in/alessandrocasuccio');
