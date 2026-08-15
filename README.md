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

## Modèle économique (v0.5)
Abonnement PRÉPAYÉ par agence, zéro commission sur les billets : les billets
sont encaissés sur le compte Campay DE L'AGENCE (champs campayAppUsername /
campayAppPassword sur Agency) ; les abonnements sur le compte Atlastech.

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

## Module Subscriptions (v0.5)
- `GET  /subscriptions/plans` (public) — grille des plans (paliers maxBuses/maxRoutes, essai).
- `GET  /subscriptions/me` — statut de l'abonnement de l'agence + BANDEAU à afficher
  dans le back-office (mise en demeure, suspension, rappel).
- `POST /subscriptions` {planCode} — souscrire/renouveler. Première souscription
  avec essai : TRIAL immédiat ; sinon PENDING jusqu'au paiement (servi APRÈS paiement).
- `POST /subscriptions/pay` {subscriptionId, provider, payerPhone} — paiement MoMo/OM
  (sandbox pour l'instant ; Campay compte Atlastech ensuite).
- `POST /subscriptions/reconcile` — confirme les paiements en attente (cron).
- `POST /subscriptions/lifecycle/run` — cycle quotidien (cron) : rappels J-7 / J-2,
  MISE EN DEMEURE J+0 (→ GRACE, SMS + email + bandeau, tracée en base),
  seconde relance J+4, SUSPENSION J+7 (agence invisible des voyageurs, billets
  déjà vendus toujours valides), réactivation immédiate au paiement.
- `POST /subscriptions/:id/extension` {extraDays} — sursis manuel (plateforme).
- Paramètres via .env : SUB_GRACE_DAYS, SUB_REMINDER1_DAYS, SUB_REMINDER2_DAYS,
  SUB_SECOND_NOTICE_DAY. Notifications SMS/email : stub loggé (à brancher).
- Migration `20260815100000_subscriptions`. Déploiement : `npx prisma migrate deploy
  && npx prisma generate` AVANT `npm run build`.
- Crons à installer (pm2/cron) : reconcile toutes les 2 min, lifecycle 1×/jour.

## Module Catalog — back-office agence (v0.6)
Préfixe `/agency`, réservé à OWNER / MANAGER, cloisonné par agence.
- Villes : `GET /agency/cities?q=` (public), `POST /agency/cities` (idempotent).
- Points d'embarquement : `GET|POST /agency/boarding-points`, `PATCH /agency/boarding-points/:id`.
- Lignes : `GET|POST /agency/routes`, `PATCH /agency/routes/:id` — palier maxRoutes du plan vérifié.
- Grille horaire : `GET|POST /agency/routes/:routeId/schedules`, `PATCH /agency/schedules/:id`
  (departureTime HH:mm, daysOfWeek 1=lundi…7=dimanche, priceFcfa).
- Génération des départs : `POST /agency/routes/:routeId/generate-trips`
  {fromDate, toDate (≤60 j), boardingPointId, busId?} — idempotent (n'écrase pas l'existant).
- Plans de sièges : `GET|POST /agency/seat-maps` (validation : sièges uniques, null = allée).
- Bus : `GET|POST /agency/buses`, `PATCH /agency/buses/:id` — palier maxBuses vérifié.
- Départs : `GET /agency/trips?from=&to=`, `POST /agency/trips` (ponctuel),
  `PATCH /agency/trips/:id` (refuse un bus trop petit pour les sièges déjà vendus),
  `DELETE /agency/trips/:id` = annulation (réservations et billets → CANCELLED ;
  remboursements : module à venir).

## Module Admin — plateforme Atlastech (v0.7)
Rôle `platform` (table PlatformAdmin, login `POST /auth/platform/login` {email, password}).
- `GET /admin/dashboard` — agences et abonnements par statut, billets du jour/mois,
  revenus d'abonnement du mois, voyageurs, départs à venir.
- Agences : `GET /admin/agencies?status=`, `GET /admin/agencies/:id` (jamais les
  identifiants Campay, seulement `campayConfigured`), `POST /admin/agencies`
  (onboarding : crée l'agence + le gérant, renvoie un mot de passe temporaire UNE fois),
  `PATCH /admin/agencies/:id/status`, `POST /admin/agency-users/:id/reset-password`.
- Plans : `GET|POST /admin/plans` (upsert par code).
- Abonnements : `GET /admin/subscriptions?status=`, `POST /admin/subscriptions/:id/extension`
  (sursis), `POST /admin/subscriptions/:id/activate-manually` {reference} (paiement reçu
  hors ligne), `POST /admin/subscriptions/lifecycle/run`.
- Les routes plateforme de Payments/Subscriptions (reconcile, lifecycle, extension) exigent
  désormais un jeton `platform` (plus @Public).
- Seed : admin `admin@atlastech.cm` / `Atlastech2026!` (variables SEED_ADMIN_EMAIL /
  SEED_ADMIN_PASSWORD) — À CHANGER en production.
- Migration `20260815110000_platform_admin`.

## Module Jobs — tâches planifiées internes (v0.7)
`@nestjs/schedule`, sans crontab système ni jeton : expiration des blocages de sièges
(chaque minute), réconciliation billets + abonnements (toutes les 2 min), cycle de vie
des abonnements (chaque jour 06:00 heure serveur). `JOBS_ENABLED=false` pour désactiver
sur d'éventuels réplicas. Visible dans `pm2 logs wakago-api` (préfixe [Jobs]).

## Pièce d'identité du passager (v0.8)
Obligation légale du manifeste passagers : par défaut chaque agence exige un
numéro de pièce (`Agency.requireIdNumber = true`, modifiable via
`GET|PATCH /agency/settings`). `POST /bookings/hold` exige alors
`passengerIdType` (CNI | RECEPISSE | PASSEPORT | CARTE_SEJOUR | AUTRE) et
`passengerIdNumber`. La recherche publique expose `requireIdNumber` par départ
pour que les apps sachent quoi demander. Le manifeste contrôleur inclut type +
numéro. Migration `20260815120000_passenger_id`.

## Notifications SMS / WhatsApp (v0.9)
Le voyageur choisit son canal (SMS ou WhatsApp) pour le code de vérification
(`POST /auth/otp/request` {phone, channel}) et pour recevoir son billet
(`ticketChannel` sur `POST /bookings/hold`) ; repli automatique SMS si WhatsApp
échoue. Fournisseurs configurés par .env : `SMS_PROVIDER=http` (passerelle POST
JSON générique : {to, from, message}) et `WA_PROVIDER=meta` (WhatsApp Business
Cloud API, modèles WA_TEMPLATE_OTP / WA_TEMPLATE_TICKET). Sans clés : mode log.
Modèle billet (6 variables) : « Bonjour {{1}}, votre billet {{2}} est confirmé :
{{3}}, le {{4}}, siège {{5}}. Réf. {{6}}. Présentez ce message ou le QR de
l'application Wakago au contrôleur. Bon voyage ! » — {{2}} = nom de l'agence.
Migration `20260815130000_ticket_channel`.
