-- Pièce d'identité du passager : type + obligation paramétrable par agence
CREATE TYPE "IdType" AS ENUM ('CNI', 'RECEPISSE', 'PASSEPORT', 'CARTE_SEJOUR', 'AUTRE');
ALTER TABLE "Booking" ADD COLUMN "passengerIdType" "IdType";
ALTER TABLE "Agency" ADD COLUMN "requireIdNumber" BOOLEAN NOT NULL DEFAULT true;
