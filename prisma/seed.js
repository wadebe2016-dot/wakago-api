/**
 * Wakago — Script de seed (données de démonstration)
 * Usage :  node prisma/seed.js
 *
 * Crée : 1 agence active (Express Littoral), villes, points d'embarquement,
 * ligne Douala–Yaoundé (et retour), un plan de bus 30 places, 2 bus,
 * et des départs sur les 3 prochains jours (07h00 et 13h00 dans chaque sens).
 *
 * Idempotent : relançable sans créer de doublons (upsert / vérifications).
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

// Plan de bus 30 places : 7 rangées de 4 (2+2) + rangée arrière de 2
function seatLayout30() {
  const rows = [];
  for (let r = 1; r <= 7; r++) {
    rows.push({ row: r, seats: [`${r}A`, `${r}B`, null, `${r}C`, `${r}D`] });
  }
  rows.push({ row: 8, seats: [`8A`, `8B`] });
  return rows;
}

async function main() {
  console.log('— Seed Wakago : démarrage —');

  // 1. Agence de démonstration
  const agency = await prisma.agency.upsert({
    where: { slug: 'express-littoral' },
    update: { status: 'ACTIVE' },
    create: {
      name: 'Express Littoral (démo)',
      slug: 'express-littoral',
      status: 'ACTIVE',
      phone: '699000001',
      email: 'demo@wakago.example',
      commissionRate: 5.0,
      payoutFrequency: 'WEEKLY',
    },
  });
  console.log('Agence :', agency.name);

  // 1b. Comptes du personnel d'agence — mot de passe de démo : Wakago2026!
  //     (le seed RÉINITIALISE ce mot de passe à chaque exécution : pratique en dev,
  //      à retirer avant la production)
  const DEMO_PASSWORD = 'Wakago2026!';
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  async function agencyUser(phone, fullName, role) {
    return prisma.agencyUser.upsert({
      where: { agencyId_phone: { agencyId: agency.id, phone } },
      update: { role, fullName, isActive: true, passwordHash },
      create: { agencyId: agency.id, phone, fullName, role, passwordHash },
    });
  }
  await agencyUser('699000001', 'Gérant Démo', 'OWNER');
  await agencyUser('699000002', 'Guichetier Démo', 'CASHIER');
  await agencyUser('699000003', 'Contrôleur Démo', 'CONTROLLER');
  console.log(`Comptes agence (slug: ${agency.slug}) : 699000001 OWNER, 699000002 CASHIER, 699000003 CONTROLLER — mot de passe : ${DEMO_PASSWORD}`);

  // 1c. Plans d'abonnement (grille de départ — à valider commercialement)
  const plans = [
    { code: 'STARTER_M', name: 'Starter mensuel',   period: 'MONTHLY',   priceFcfa: 15000,  maxBuses: 3,   maxRoutes: 3,   trialDays: 30, sortOrder: 1 },
    { code: 'PRO_M',     name: 'Pro mensuel',       period: 'MONTHLY',   priceFcfa: 35000,  maxBuses: 10,  maxRoutes: 10,  trialDays: 30, sortOrder: 2 },
    { code: 'PRO_Q',     name: 'Pro trimestriel',   period: 'QUARTERLY', priceFcfa: 95000,  maxBuses: 10,  maxRoutes: 10,  trialDays: 30, sortOrder: 3 },
    { code: 'ENTREPRISE_Y', name: 'Entreprise annuel', period: 'YEARLY', priceFcfa: 600000, maxBuses: null, maxRoutes: null, trialDays: 30, sortOrder: 4 },
  ];
  for (const pl of plans) {
    await prisma.subscriptionPlan.upsert({ where: { code: pl.code }, update: pl, create: pl });
  }
  console.log('Plans :', plans.map((p) => p.code).join(', '));

  // 1d. Abonnement d'essai pour l'agence démo (si aucun abonnement)
  const existingSub = await prisma.subscription.findFirst({ where: { agencyId: agency.id } });
  if (!existingSub) {
    const starter = await prisma.subscriptionPlan.findUnique({ where: { code: 'STARTER_M' } });
    const now = new Date();
    const endsAt = new Date(now.getTime() + starter.trialDays * 86400000);
    await prisma.subscription.create({
      data: { agencyId: agency.id, planId: starter.id, status: 'TRIAL', startsAt: now, endsAt, graceEndsAt: new Date(endsAt.getTime() + 7 * 86400000) },
    });
    console.log(`Abonnement démo : essai STARTER_M jusqu'au ${endsAt.toISOString().slice(0, 10)}`);
  }

  // 2. Villes
  const cityData = [
    { name: 'Douala', region: 'Littoral' },
    { name: 'Yaoundé', region: 'Centre' },
  ];
  const cities = {};
  for (const c of cityData) {
    cities[c.name] = await prisma.city.upsert({
      where: { name_region: { name: c.name, region: c.region } },
      update: {},
      create: c,
    });
  }
  console.log('Villes :', Object.keys(cities).join(', '));

  // 3. Points d'embarquement
  async function boardingPoint(cityName, name, address) {
    const existing = await prisma.boardingPoint.findFirst({
      where: { agencyId: agency.id, cityId: cities[cityName].id, name },
    });
    if (existing) return existing;
    return prisma.boardingPoint.create({
      data: { agencyId: agency.id, cityId: cities[cityName].id, name, address },
    });
  }
  const bpDouala = await boardingPoint('Douala', 'Agence Akwa', 'Boulevard de la Liberté, Akwa');
  const bpYaounde = await boardingPoint('Yaoundé', 'Agence Mvan', 'Carrefour Mvan');

  // 4. Lignes (aller et retour)
  async function route(fromName, toName) {
    return prisma.route.upsert({
      where: {
        agencyId_originCityId_destinationCityId: {
          agencyId: agency.id,
          originCityId: cities[fromName].id,
          destinationCityId: cities[toName].id,
        },
      },
      update: {},
      create: {
        agencyId: agency.id,
        originCityId: cities[fromName].id,
        destinationCityId: cities[toName].id,
      },
    });
  }
  const routeDlaYde = await route('Douala', 'Yaoundé');
  const routeYdeDla = await route('Yaoundé', 'Douala');
  console.log('Lignes : Douala→Yaoundé, Yaoundé→Douala');

  // 5. Plan de sièges + bus
  let seatMap = await prisma.seatMap.findFirst({
    where: { agencyId: agency.id, name: 'Coaster 30 places' },
  });
  if (!seatMap) {
    seatMap = await prisma.seatMap.create({
      data: {
        agencyId: agency.id,
        name: 'Coaster 30 places',
        capacity: 30,
        layout: seatLayout30(),
      },
    });
  }
  async function bus(plate) {
    return prisma.bus.upsert({
      where: { agencyId_plateNumber: { agencyId: agency.id, plateNumber: plate } },
      update: {},
      create: { agencyId: agency.id, plateNumber: plate, seatMapId: seatMap.id },
    });
  }
  const bus1 = await bus('LT-234-AB');
  const bus2 = await bus('LT-567-CD');
  console.log('Bus :', bus1.plateNumber, ',', bus2.plateNumber);

  // 6. Départs : 3 prochains jours, 07h00 et 13h00, dans les deux sens
  const PRICE = 5000; // FCFA
  let created = 0;
  for (let d = 1; d <= 3; d++) {
    const day = new Date();
    day.setDate(day.getDate() + d);
    const dateStr = day.toISOString().slice(0, 10);

    const departures = [
      { route: routeDlaYde, bp: bpDouala, bus: bus1, hour: '07:00' },
      { route: routeDlaYde, bp: bpDouala, bus: bus2, hour: '13:00' },
      { route: routeYdeDla, bp: bpYaounde, bus: bus2, hour: '07:00' },
      { route: routeYdeDla, bp: bpYaounde, bus: bus1, hour: '13:00' },
    ];

    for (const dep of departures) {
      const departureAt = new Date(`${dateStr}T${dep.hour}:00Z`);
      const existing = await prisma.trip.findFirst({
        where: { routeId: dep.route.id, departureAt },
      });
      if (existing) continue;
      await prisma.trip.create({
        data: {
          agencyId: agency.id,
          routeId: dep.route.id,
          boardingPointId: dep.bp.id,
          busId: dep.bus.id,
          departureAt,
          priceFcfa: PRICE,
          status: 'SCHEDULED',
        },
      });
      created++;
    }
  }
  console.log(`Départs créés : ${created} (12 attendus au premier lancement)`);

  // 7. Récapitulatif pour tester tout de suite
  const trip = await prisma.trip.findFirst({
    where: { routeId: routeDlaYde.id, status: 'SCHEDULED' },
    orderBy: { departureAt: 'asc' },
  });
  console.log('\n— Seed terminé. Pour tester : —');
  console.log(`cityId Douala  : ${cities['Douala'].id}`);
  console.log(`cityId Yaoundé : ${cities['Yaoundé'].id}`);
  if (trip) console.log(`premier tripId : ${trip.id}`);
  console.log(`\nExemple :\ncurl "http://localhost:3000/api/v1/trips/search?from=${cities['Douala'].id}&to=${cities['Yaoundé'].id}&date=${trip ? trip.departureAt.toISOString().slice(0, 10) : 'YYYY-MM-DD'}"`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
