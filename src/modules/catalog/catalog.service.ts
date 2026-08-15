import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtUser } from '../auth/auth.service';
import {
  CreateBoardingPointDto, CreateBusDto, CreateCityDto, CreateRouteDto, CreateScheduleDto,
  CreateSeatMapDto, CreateTripDto, GenerateTripsDto, UpdateBoardingPointDto, UpdateBusDto,
  UpdateAgencySettingsDto, UpdateRouteDto, UpdateScheduleDto, UpdateTripDto,
} from './dto/catalog.dto';

const DAY = 86400000;

/**
 * Back-office agence : tout est cloisonné par agencyId issu du jeton.
 * Une agence ne voit et ne modifie que ses propres objets ; les villes sont
 * un référentiel partagé (création possible, pas de suppression).
 */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  private agencyId(user: JwtUser) {
    if (user.type !== 'agency' || !user.agencyId) throw new ForbiddenException('Compte agence requis');
    return user.agencyId;
  }

  /** Vérifie les paliers du plan (maxBuses / maxRoutes) avant création. */
  private async assertQuota(agencyId: string, kind: 'bus' | 'route') {
    const sub = await this.prisma.subscription.findFirst({
      where: { agencyId, status: { in: ['TRIAL', 'ACTIVE', 'GRACE'] } },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) return; // pas d'abonnement : l'agence est de toute façon invisible des voyageurs
    const limit = kind === 'bus' ? sub.plan.maxBuses : sub.plan.maxRoutes;
    if (limit == null) return;
    const count = kind === 'bus'
      ? await this.prisma.bus.count({ where: { agencyId, isActive: true } })
      : await this.prisma.route.count({ where: { agencyId, isActive: true } });
    if (count >= limit)
      throw new BadRequestException(`Palier atteint : votre plan « ${sub.plan.name} » autorise ${limit} ${kind === 'bus' ? 'bus' : 'ligne(s)'} actif(s). Passez à un plan supérieur.`);
  }

  // ---------------------------- PARAMÈTRES AGENCE ----------------------------

  getSettings(user: JwtUser) {
    return this.prisma.agency.findUnique({ where: { id: this.agencyId(user) }, select: { id: true, name: true, slug: true, phone: true, email: true, requireIdNumber: true } });
  }

  updateSettings(dto: UpdateAgencySettingsDto, user: JwtUser) {
    return this.prisma.agency.update({ where: { id: this.agencyId(user) }, data: dto, select: { id: true, name: true, requireIdNumber: true } });
  }

  // ------------------------------- VILLES -------------------------------

  listCities(q?: string) {
    return this.prisma.city.findMany({
      where: q ? { name: { contains: q, mode: 'insensitive' } } : undefined,
      orderBy: { name: 'asc' },
    });
  }

  async createCity(dto: CreateCityDto) {
    const existing = await this.prisma.city.findFirst({
      where: { name: { equals: dto.name.trim(), mode: 'insensitive' }, region: dto.region ?? null },
    });
    if (existing) return existing; // idempotent : on ne duplique pas une ville existante
    return this.prisma.city.create({ data: { name: dto.name.trim(), region: dto.region } });
  }

  // ------------------------- POINTS D'EMBARQUEMENT -------------------------

  listBoardingPoints(user: JwtUser) {
    return this.prisma.boardingPoint.findMany({
      where: { agencyId: this.agencyId(user) },
      include: { city: true },
      orderBy: [{ city: { name: 'asc' } }, { name: 'asc' }],
    });
  }

  async createBoardingPoint(dto: CreateBoardingPointDto, user: JwtUser) {
    const city = await this.prisma.city.findUnique({ where: { id: dto.cityId } });
    if (!city) throw new NotFoundException('Ville introuvable');
    return this.prisma.boardingPoint.create({
      data: { agencyId: this.agencyId(user), cityId: dto.cityId, name: dto.name, address: dto.address },
      include: { city: true },
    });
  }

  async updateBoardingPoint(id: string, dto: UpdateBoardingPointDto, user: JwtUser) {
    await this.ownBoardingPoint(id, user);
    return this.prisma.boardingPoint.update({ where: { id }, data: dto, include: { city: true } });
  }

  private async ownBoardingPoint(id: string, user: JwtUser) {
    const bp = await this.prisma.boardingPoint.findUnique({ where: { id } });
    if (!bp || bp.agencyId !== this.agencyId(user)) throw new NotFoundException('Point d\'embarquement introuvable');
    return bp;
  }

  // ------------------------------- LIGNES -------------------------------

  listRoutes(user: JwtUser) {
    return this.prisma.route.findMany({
      where: { agencyId: this.agencyId(user) },
      include: { originCity: true, destinationCity: true, schedules: { where: { isActive: true } } },
      orderBy: [{ originCity: { name: 'asc' } }, { destinationCity: { name: 'asc' } }],
    });
  }

  async createRoute(dto: CreateRouteDto, user: JwtUser) {
    const agencyId = this.agencyId(user);
    if (dto.originCityId === dto.destinationCityId) throw new BadRequestException('Origine et destination identiques');
    await this.assertQuota(agencyId, 'route');
    try {
      return await this.prisma.route.create({
        data: { agencyId, originCityId: dto.originCityId, destinationCityId: dto.destinationCityId },
        include: { originCity: true, destinationCity: true },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('Cette ligne existe déjà pour votre agence');
      if (e?.code === 'P2003') throw new NotFoundException('Ville introuvable');
      throw e;
    }
  }

  async updateRoute(id: string, dto: UpdateRouteDto, user: JwtUser) {
    await this.ownRoute(id, user);
    if (dto.isActive === true) await this.assertQuota(this.agencyId(user), 'route');
    return this.prisma.route.update({ where: { id }, data: dto, include: { originCity: true, destinationCity: true } });
  }

  private async ownRoute(id: string, user: JwtUser) {
    const r = await this.prisma.route.findUnique({ where: { id } });
    if (!r || r.agencyId !== this.agencyId(user)) throw new NotFoundException('Ligne introuvable');
    return r;
  }

  // ---------------------------- GRILLE HORAIRE ----------------------------

  async listSchedules(routeId: string, user: JwtUser) {
    await this.ownRoute(routeId, user);
    return this.prisma.schedule.findMany({ where: { routeId }, orderBy: { departureTime: 'asc' } });
  }

  async createSchedule(routeId: string, dto: CreateScheduleDto, user: JwtUser) {
    await this.ownRoute(routeId, user);
    return this.prisma.schedule.create({
      data: { routeId, departureTime: dto.departureTime, daysOfWeek: [...new Set(dto.daysOfWeek)].sort(), priceFcfa: dto.priceFcfa },
    });
  }

  async updateSchedule(id: string, dto: UpdateScheduleDto, user: JwtUser) {
    const s = await this.prisma.schedule.findUnique({ where: { id }, include: { route: true } });
    if (!s || s.route.agencyId !== this.agencyId(user)) throw new NotFoundException('Horaire introuvable');
    return this.prisma.schedule.update({
      where: { id },
      data: { ...dto, daysOfWeek: dto.daysOfWeek ? [...new Set(dto.daysOfWeek)].sort() : undefined },
    });
  }

  // ---------------------------- PLANS DE SIÈGES ----------------------------

  listSeatMaps(user: JwtUser) {
    return this.prisma.seatMap.findMany({ where: { agencyId: this.agencyId(user) }, orderBy: { name: 'asc' } });
  }

  async createSeatMap(dto: CreateSeatMapDto, user: JwtUser) {
    // Validation du plan : numéros de sièges uniques, non vides
    const seen = new Set<string>();
    for (const row of dto.layout) {
      for (const s of row.seats) {
        if (s === null) continue;
        if (typeof s !== 'string' || !s.trim()) throw new BadRequestException('Numéro de siège invalide');
        if (seen.has(s)) throw new BadRequestException(`Siège en double : ${s}`);
        seen.add(s);
      }
    }
    if (seen.size === 0) throw new BadRequestException('Le plan doit contenir au moins un siège');
    return this.prisma.seatMap.create({
      data: { agencyId: this.agencyId(user), name: dto.name, capacity: seen.size, layout: dto.layout as any },
    });
  }

  // -------------------------------- BUS --------------------------------

  listBuses(user: JwtUser) {
    return this.prisma.bus.findMany({
      where: { agencyId: this.agencyId(user) },
      include: { seatMap: { select: { id: true, name: true, capacity: true } } },
      orderBy: { plateNumber: 'asc' },
    });
  }

  async createBus(dto: CreateBusDto, user: JwtUser) {
    const agencyId = this.agencyId(user);
    const sm = await this.prisma.seatMap.findUnique({ where: { id: dto.seatMapId } });
    if (!sm || sm.agencyId !== agencyId) throw new NotFoundException('Plan de sièges introuvable');
    await this.assertQuota(agencyId, 'bus');
    try {
      return await this.prisma.bus.create({
        data: { agencyId, plateNumber: dto.plateNumber.trim().toUpperCase(), seatMapId: dto.seatMapId },
        include: { seatMap: { select: { id: true, name: true, capacity: true } } },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('Un bus avec cette immatriculation existe déjà');
      throw e;
    }
  }

  async updateBus(id: string, dto: UpdateBusDto, user: JwtUser) {
    const agencyId = this.agencyId(user);
    const bus = await this.prisma.bus.findUnique({ where: { id } });
    if (!bus || bus.agencyId !== agencyId) throw new NotFoundException('Bus introuvable');
    if (dto.seatMapId) {
      const sm = await this.prisma.seatMap.findUnique({ where: { id: dto.seatMapId } });
      if (!sm || sm.agencyId !== agencyId) throw new NotFoundException('Plan de sièges introuvable');
    }
    if (dto.isActive === true && !bus.isActive) await this.assertQuota(agencyId, 'bus');
    return this.prisma.bus.update({
      where: { id },
      data: { ...dto, plateNumber: dto.plateNumber?.trim().toUpperCase() },
      include: { seatMap: { select: { id: true, name: true, capacity: true } } },
    });
  }

  // ------------------------------- DÉPARTS -------------------------------

  listTrips(user: JwtUser, from?: string, to?: string) {
    const agencyId = this.agencyId(user);
    const gte = from ? new Date(`${from}T00:00:00Z`) : new Date();
    const lte = to ? new Date(`${to}T23:59:59Z`) : new Date(gte.getTime() + 14 * DAY);
    return this.prisma.trip.findMany({
      where: { agencyId, departureAt: { gte, lte } },
      include: {
        route: { include: { originCity: true, destinationCity: true } },
        boardingPoint: true,
        bus: { select: { plateNumber: true, seatMap: { select: { capacity: true } } } },
        _count: { select: { bookings: { where: { status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] } } } } },
      },
      orderBy: { departureAt: 'asc' },
    });
  }

  /**
   * Génère les départs concrets d'une ligne à partir de sa grille horaire,
   * sur une plage de dates. Idempotent : n'écrase pas un départ déjà existant
   * (même ligne, même date-heure).
   */
  async generateTrips(routeId: string, dto: GenerateTripsDto, user: JwtUser) {
    const agencyId = this.agencyId(user);
    const route = await this.ownRoute(routeId, user);
    await this.ownBoardingPoint(dto.boardingPointId, user);
    if (dto.busId) {
      const bus = await this.prisma.bus.findUnique({ where: { id: dto.busId } });
      if (!bus || bus.agencyId !== agencyId) throw new NotFoundException('Bus introuvable');
    }
    const from = new Date(`${dto.fromDate.slice(0, 10)}T00:00:00Z`);
    const to = new Date(`${dto.toDate.slice(0, 10)}T00:00:00Z`);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) throw new BadRequestException('Plage de dates invalide');
    if ((to.getTime() - from.getTime()) / DAY > 60) throw new BadRequestException('Plage maximale : 60 jours');

    const schedules = await this.prisma.schedule.findMany({ where: { routeId: route.id, isActive: true } });
    if (schedules.length === 0) throw new BadRequestException('Aucun horaire actif sur cette ligne');

    let created = 0, skipped = 0;
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + DAY)) {
      const isoDow = ((d.getUTCDay() + 6) % 7) + 1; // 1 = lundi ... 7 = dimanche
      for (const s of schedules) {
        if (!s.daysOfWeek.includes(isoDow)) continue;
        const departureAt = new Date(`${d.toISOString().slice(0, 10)}T${s.departureTime}:00Z`);
        const exists = await this.prisma.trip.findFirst({ where: { routeId: route.id, departureAt } });
        if (exists) { skipped++; continue; }
        await this.prisma.trip.create({
          data: {
            agencyId, routeId: route.id, scheduleId: s.id, boardingPointId: dto.boardingPointId,
            busId: dto.busId ?? null, departureAt, priceFcfa: s.priceFcfa, status: 'SCHEDULED',
          },
        });
        created++;
      }
    }
    return { created, skipped };
  }

  /** Départ ponctuel hors grille (renfort, départ exceptionnel). */
  async createTrip(dto: CreateTripDto, user: JwtUser) {
    const agencyId = this.agencyId(user);
    await this.ownRoute(dto.routeId, user);
    await this.ownBoardingPoint(dto.boardingPointId, user);
    if (dto.busId) {
      const bus = await this.prisma.bus.findUnique({ where: { id: dto.busId } });
      if (!bus || bus.agencyId !== agencyId) throw new NotFoundException('Bus introuvable');
    }
    return this.prisma.trip.create({
      data: { agencyId, routeId: dto.routeId, boardingPointId: dto.boardingPointId, busId: dto.busId ?? null, departureAt: new Date(dto.departureAt), priceFcfa: dto.priceFcfa },
    });
  }

  async updateTrip(id: string, dto: UpdateTripDto, user: JwtUser) {
    const agencyId = this.agencyId(user);
    const trip = await this.prisma.trip.findUnique({ where: { id } });
    if (!trip || trip.agencyId !== agencyId) throw new NotFoundException('Départ introuvable');
    if (trip.status !== 'SCHEDULED') throw new BadRequestException(`Départ non modifiable au statut ${trip.status}`);
    if (dto.busId) {
      const bus = await this.prisma.bus.findUnique({ where: { id: dto.busId }, include: { seatMap: true } });
      if (!bus || bus.agencyId !== agencyId) throw new NotFoundException('Bus introuvable');
      // Interdit de rétrécir sous le nombre de sièges déjà vendus
      const sold = await this.prisma.booking.count({ where: { tripId: id, status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] } } });
      if (sold > bus.seatMap.capacity) throw new BadRequestException(`Ce bus (${bus.seatMap.capacity} places) est trop petit : ${sold} sièges déjà réservés`);
    }
    return this.prisma.trip.update({
      where: { id },
      data: { busId: dto.busId, priceFcfa: dto.priceFcfa, departureAt: dto.departureAt ? new Date(dto.departureAt) : undefined },
    });
  }

  /** Annulation d'un départ : les réservations passent en CANCELLED (remboursement : itération suivante). */
  async cancelTrip(id: string, user: JwtUser) {
    const trip = await this.prisma.trip.findUnique({ where: { id } });
    if (!trip || trip.agencyId !== this.agencyId(user)) throw new NotFoundException('Départ introuvable');
    if (trip.status === 'DEPARTED' || trip.status === 'ARRIVED') throw new BadRequestException('Départ déjà effectué');
    const [, bookings] = await this.prisma.$transaction([
      this.prisma.trip.update({ where: { id }, data: { status: 'CANCELLED' } }),
      this.prisma.booking.updateMany({ where: { tripId: id, status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] } }, data: { status: 'CANCELLED' } }),
      this.prisma.ticket.updateMany({ where: { booking: { tripId: id } }, data: { status: 'CANCELLED' } }),
    ]);
    return { tripId: id, status: 'CANCELLED', cancelledBookings: bookings.count, note: 'Remboursements à traiter (module à venir)' };
  }
}
