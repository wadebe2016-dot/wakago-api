# Wakago API (socle v0.1)

API multi-tenant de la plateforme Wakago (Atlastech Solution) —
réservation de billets de bus interurbains avec paiement Mobile Money.

## Contenu du socle
- `prisma/schema.prisma` : modèle de données complet (agences, réseau,
  flotte, départs, réservations, billets QR, paiements, reversements).
- `src/modules/trips` : recherche de départs multi-agences avec places restantes.
- `src/modules/bookings` : plan de sièges + blocage de siège anti-double-vente
  (verrou Redis + transaction + contrainte unique partielle PostgreSQL).
- Autres modules (auth, payments, boarding, payouts...) : dossiers créés,
  à implémenter dans les prochaines itérations.

## Démarrage
```bash
cp .env.example .env        # renseigner DATABASE_URL et REDIS_URL
npm install
npx prisma migrate dev      # créer le schéma
npm run start:dev
```

## IMPORTANT — contrainte anti-double-vente
Après la première migration, ajouter dans une migration SQL :
```sql
CREATE UNIQUE INDEX booking_active_seat_uq
  ON "Booking"("tripId","seatNumber")
  WHERE status IN ('PENDING_PAYMENT','CONFIRMED');
```
(Prisma ne modélise pas les index partiels ; cette contrainte est le
filet de sécurité ultime contre la double vente.)

## Endpoints disponibles
- `GET  /api/v1/trips/search?from=&to=&date=YYYY-MM-DD`
- `GET  /api/v1/trips/:tripId/seats`
- `POST /api/v1/bookings/hold`

## Module Payments (v0.2)
Chaîne complète : `POST /bookings/hold` → `POST /payments/initiate`
→ push Mobile Money → webhook `POST /payments/webhook` (ou réconciliation)
→ billet QR émis → `GET /payments/:id/status` retourne le billet.

- `payment-provider.ts` : interface `PaymentProvider` (initiatePush,
  checkStatus, verifyWebhookSignature) + `SandboxPaymentProvider` pour
  développer sans contrat agrégateur.
- Simulation sandbox : téléphone finissant par 0 = échec ; par 9 = timeout
  (réconciliation) ; sinon succès en ~3 s.
- Idempotence : webhooks rejoués sans effet de bord, billet unique par
  réservation.
- Bascule vers l'agrégateur réel : implémenter `PaymentProvider` (ex.
  `CampayProvider`) et changer la factory dans `payments.module.ts`.
