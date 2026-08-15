import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

/** Opérations réservées à Atlastech (rôle 'platform'). */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subs: SubscriptionsService,
  ) {}

  // ----------------------------- TABLEAU DE BORD -----------------------------

  async dashboard() {
    const now = new Date();
    const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [agenciesByStatus, subsByStatus, bookingsToday, bookingsMonth, revenueMonth, travelers, upcomingTrips] = await Promise.all([
      this.prisma.agency.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.subscription.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.booking.count({ where: { status: 'CONFIRMED', createdAt: { gte: dayStart } } }),
      this.prisma.booking.count({ where: { status: 'CONFIRMED', createdAt: { gte: monthStart } } }),
      this.prisma.subscriptionPayment.aggregate({ _sum: { amountFcfa: true }, where: { status: 'SUCCESS', createdAt: { gte: monthStart } } }),
      this.prisma.traveler.count(),
      this.prisma.trip.count({ where: { status: 'SCHEDULED', departureAt: { gte: now } } }),
    ]);
    const toMap = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
    return {
      agencies: toMap(agenciesByStatus),
      subscriptions: toMap(subsByStatus),
      tickets: { today: bookingsToday, thisMonth: bookingsMonth },
      subscriptionRevenueFcfaThisMonth: revenueMonth._sum.amountFcfa ?? 0,
      travelers,
      upcomingTrips,
    };
  }

  // -------------------------------- AGENCES --------------------------------

  listAgencies(status?: string) {
    return this.prisma.agency.findMany({
      where: status ? { status: status as any } : undefined,
      select: {
        id: true, name: true, slug: true, status: true, phone: true, email: true, createdAt: true,
        _count: { select: { users: true, routes: true, buses: true, bookings: true } },
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 1, include: { plan: { select: { code: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAgency(id: string) {
    const a = await this.prisma.agency.findUnique({
      where: { id },
      include: {
        users: { select: { id: true, fullName: true, phone: true, role: true, isActive: true } },
        subscriptions: { orderBy: { createdAt: 'desc' }, include: { plan: true, payments: { orderBy: { createdAt: 'desc' }, take: 5 } } },
        notices: { orderBy: { sentAt: 'desc' }, take: 10 },
        _count: { select: { routes: true, buses: true, trips: true, bookings: true } },
      },
    });
    if (!a) throw new NotFoundException('Agence introuvable');
    // On ne renvoie jamais les identifiants Campay
    const { campayAppPassword, campayAppUsername, ...safe } = a as any;
    return { ...safe, campayConfigured: !!(campayAppUsername && campayAppPassword) };
  }

  /**
   * Onboarding d'une agence par la plateforme : crée l'agence + le compte gérant.
   * Le mot de passe initial est renvoyé UNE FOIS pour être transmis au gérant.
   */
  async createAgency(dto: { name: string; slug: string; phone: string; email?: string; ownerName: string; ownerPhone: string }) {
    const slug = dto.slug.trim().toLowerCase();
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) throw new BadRequestException('Slug invalide (a-z, 0-9, tirets, 3 à 40 caractères)');
    const exists = await this.prisma.agency.findUnique({ where: { slug } });
    if (exists) throw new ConflictException('Ce slug est déjà utilisé');

    const tempPassword = 'Wk-' + Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6).toUpperCase();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const agency = await this.prisma.agency.create({
      data: {
        name: dto.name.trim(), slug, phone: dto.phone, email: dto.email ?? null, status: 'PENDING',
        users: { create: { role: 'OWNER', fullName: dto.ownerName, phone: dto.ownerPhone, passwordHash } },
      },
      include: { users: true },
    });
    return {
      agency: { id: agency.id, name: agency.name, slug: agency.slug, status: agency.status },
      owner: { phone: dto.ownerPhone, temporaryPassword: tempPassword },
      note: 'Transmettre le mot de passe au gérant ; l\'agence sera ACTIVE dès sa souscription (essai ou paiement).',
    };
  }

  async setAgencyStatus(id: string, status: 'ACTIVE' | 'SUSPENDED' | 'PENDING') {
    const a = await this.prisma.agency.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Agence introuvable');
    return this.prisma.agency.update({ where: { id }, data: { status }, select: { id: true, name: true, status: true } });
  }

  async resetAgencyUserPassword(agencyUserId: string) {
    const u = await this.prisma.agencyUser.findUnique({ where: { id: agencyUserId } });
    if (!u) throw new NotFoundException('Utilisateur introuvable');
    const tempPassword = 'Wk-' + Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6).toUpperCase();
    await this.prisma.agencyUser.update({ where: { id: agencyUserId }, data: { passwordHash: await bcrypt.hash(tempPassword, 10) } });
    return { userId: agencyUserId, phone: u.phone, temporaryPassword: tempPassword };
  }

  // --------------------------------- PLANS ---------------------------------

  listPlans() {
    return this.prisma.subscriptionPlan.findMany({ orderBy: [{ sortOrder: 'asc' }, { priceFcfa: 'asc' }], include: { _count: { select: { subscriptions: true } } } });
  }

  async upsertPlan(dto: { code: string; name: string; period: 'MONTHLY' | 'QUARTERLY' | 'YEARLY'; priceFcfa: number; maxBuses?: number | null; maxRoutes?: number | null; trialDays?: number; isActive?: boolean; sortOrder?: number }) {
    const code = dto.code.trim().toUpperCase();
    return this.prisma.subscriptionPlan.upsert({
      where: { code },
      update: { name: dto.name, period: dto.period, priceFcfa: dto.priceFcfa, maxBuses: dto.maxBuses ?? null, maxRoutes: dto.maxRoutes ?? null, trialDays: dto.trialDays ?? 0, isActive: dto.isActive ?? true, sortOrder: dto.sortOrder ?? 0 },
      create: { code, name: dto.name, period: dto.period, priceFcfa: dto.priceFcfa, maxBuses: dto.maxBuses ?? null, maxRoutes: dto.maxRoutes ?? null, trialDays: dto.trialDays ?? 0, isActive: dto.isActive ?? true, sortOrder: dto.sortOrder ?? 0 },
    });
  }

  // ------------------------------ ABONNEMENTS ------------------------------

  listSubscriptions(status?: string) {
    return this.prisma.subscription.findMany({
      where: status ? { status: status as any } : undefined,
      include: { agency: { select: { id: true, name: true, slug: true, phone: true } }, plan: { select: { code: true, name: true, priceFcfa: true } } },
      orderBy: [{ status: 'asc' }, { endsAt: 'asc' }],
    });
  }

  grantExtension(subscriptionId: string, extraDays: number) {
    return this.subs.grantExtension(subscriptionId, extraDays);
  }

  /** Activation manuelle (ex. paiement reçu hors ligne / virement) : même effet qu'un paiement confirmé. */
  async activateManually(subscriptionId: string, reference: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: true } });
    if (!sub) throw new NotFoundException('Abonnement introuvable');
    const payment = await this.prisma.subscriptionPayment.create({
      data: { subscriptionId, provider: 'CASH', status: 'PENDING', amountFcfa: sub.plan.priceFcfa, aggregatorRef: `MANUAL-${reference}-${Date.now()}` },
    });
    return this.subs.settle(payment.id);
  }

  runLifecycle() { return this.subs.runLifecycle(); }
}
