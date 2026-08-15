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

## Contrainte anti-double-vente
Portée par la migration `20260815090000_booking_active_seat_unique`
(index unique partiel sur Booking, non modélisable dans schema.prisma).
Elle s'applique automatiquement avec `npx prisma migrate deploy` (prod)
ou `npx prisma migrate dev` (dev). Idempotente (IF NOT EXISTS).

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

## Module Auth (v0.3)
- Voyageur : `POST /auth/otp/request` {phone} puis `POST /auth/otp/verify`
  {phone, code} → token JWT 30 j. Hors production, le code OTP est renvoyé
  dans la réponse (devCode) et journalisé côté serveur.
- Agence : `POST /auth/agency/login` {agencySlug, phone, password} → token 12 h.
  Comptes de démo (après seed) : slug `express-littoral`,
  699000001 / wakago-demo-2026 (OWNER), 699000002 / guichet-demo-2026 (CASHIER).
- Routes protégées : `bookings/hold` (token requis ; canal et identité imposés
  par le rôle), `payments/initiate` et `payments/:id/status` (token requis),
  `payments/reconcile` (OWNER/MANAGER). Webhook public (signature vérifiée),
  recherche et plan de sièges publics.
- Utiliser le token : en-tête `Authorization: Bearer <token>`.

## Module Auth (v0.3)
Toute l'API exige désormais un jeton JWT (`Authorization: Bearer <token>`),
sauf les routes marquées publiques : recherche de trajets, plan de sièges,
webhook paiement, et les routes d'authentification.

- Voyageur : `POST /auth/otp/request` {phone} → SMS (stub : code loggé,
  et champ devCode hors production) puis `POST /auth/otp/verify`
  {phone, code} → accessToken.
- Agence : `POST /auth/agency/login` {agencySlug, phone, password} → accessToken
  portant agencyId et rôle (OWNER, MANAGER, CASHIER, CONTROLLER).
- `/bookings/hold` : voyageur (channel APP) ou compte agence (channel
  COUNTER) ; le travelerId provient du jeton, plus du corps de requête.
- Comptes de démo (via seed, agencySlug `express-littoral`) : 699000001 (OWNER),
  699000002 (CASHIER), 699000003 (CONTROLLER) — mot de passe `Wakago2026!`.
  Le seed réinitialise ce mot de passe à chaque exécution (dev uniquement).
- IMPORTANT production : définir un JWT_SECRET fort dans .env.

## Module Boarding (v0.4)
Réservé aux comptes agence CONTROLLER / MANAGER / OWNER, sur les départs de
leur propre agence uniquement.
- `GET  /boarding/trips/:tripId/manifest` — liste des passagers confirmés,
  statut d'embarquement, et qrTokens (base du mode hors ligne).
- `POST /boarding/trips/:tripId/scan` {qrToken} — scan en ligne. Réponses :
  BOARDED / ALREADY_BOARDED (doublon détecté) / REJECTED (raison explicite).
  Le premier scan passe le départ en BOARDING.
- `POST /boarding/trips/:tripId/sync` {scans:[{qrToken, scannedAt}]} — rejoue
  les scans faits hors ligne (max 200), conserve l'heure réelle du scan.
- `POST /boarding/trips/:tripId/close` — départ → DEPARTED, avec récapitulatif.

Mode hors ligne (côté app contrôleur, à implémenter) : télécharger le
manifeste avant le départ ; à chaque scan, vérifier la signature HMAC du
QR (`verifyQrSignature`, même algorithme que le serveur) et la présence du
qrToken dans le manifeste ; marquer localement ; puis /sync à la reconnexion.
Le contrôleur voit donc les billets forgés et les doublons même sans réseau.
