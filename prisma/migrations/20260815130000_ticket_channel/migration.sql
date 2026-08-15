-- Canal de réception du billet choisi par le voyageur
ALTER TABLE "Booking" ADD COLUMN "ticketChannel" TEXT DEFAULT 'SMS';
