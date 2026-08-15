-- Filet de sécurité anti-double-vente : un seul booking ACTIF par (tripId, seatNumber).
-- Index unique PARTIEL (non modélisable dans schema.prisma), donc porté par une migration SQL.
-- IF NOT EXISTS : idempotent si l'index a déjà été créé manuellement (cas de la base de dev).
CREATE UNIQUE INDEX IF NOT EXISTS booking_active_seat_uq
  ON "Booking"("tripId","seatNumber")
  WHERE status IN ('PENDING_PAYMENT','CONFIRMED');
