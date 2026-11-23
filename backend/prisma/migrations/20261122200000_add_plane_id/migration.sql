-- Legacy attempts have no recorded plane; backfill BasicPlane for compatibility.
ALTER TABLE "FlightAttempt" ADD COLUMN "planeId" TEXT NOT NULL DEFAULT 'BasicPlane';
ALTER TABLE "FlightAttempt" ALTER COLUMN "planeId" DROP DEFAULT;
