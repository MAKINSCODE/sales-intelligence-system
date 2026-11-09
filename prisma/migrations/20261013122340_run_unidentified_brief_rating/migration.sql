-- AlterTable
ALTER TABLE "Brief" ADD COLUMN     "ratedAt" TIMESTAMP(3),
ADD COLUMN     "rating" INTEGER,
ADD COLUMN     "ratingNote" TEXT;

-- AlterTable
ALTER TABLE "ResearchRun" ADD COLUMN     "unidentified" BOOLEAN NOT NULL DEFAULT false;
