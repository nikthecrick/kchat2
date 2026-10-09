-- CreateTable
CREATE TABLE "VerifiedKeyPair" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "numberHash" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerifiedKeyPair_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedKeyPair_userAId_userBId_key" ON "VerifiedKeyPair"("userAId", "userBId");

-- CreateIndex
CREATE INDEX "VerifiedKeyPair_userAId_idx" ON "VerifiedKeyPair"("userAId");

-- CreateIndex
CREATE INDEX "VerifiedKeyPair_userBId_idx" ON "VerifiedKeyPair"("userBId");

-- AddForeignKey
ALTER TABLE "VerifiedKeyPair" ADD CONSTRAINT "VerifiedKeyPair_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifiedKeyPair" ADD CONSTRAINT "VerifiedKeyPair_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;