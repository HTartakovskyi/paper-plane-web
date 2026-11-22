-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightAttempt" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "angle" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL,
    "distance" DOUBLE PRECISION NOT NULL,
    "score" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlightAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FlightAttempt_sessionId_createdAt_idx" ON "FlightAttempt"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "FlightAttempt" ADD CONSTRAINT "FlightAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
