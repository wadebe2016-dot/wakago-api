import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { JwtUser } from '../auth/auth.service';

/**
 * Cœur anti-double-vente. Trois lignes de défense :
 *  1. Verrou Redis SET NX EX sur (tripId, seatNumber) — rapide, TTL 10 min.
 *  2. Vérification en transaction Prisma qu'aucun booking actif n'existe.
 *  3. Contrainte unique PARTIELLE PostgreSQL (filet de sécurité ultime) :
 *     CREATE UNIQUE INDEX booking_active_seat_uq
 *       ON "Booking"("tripId","seatNumber")
 *       WHERE status IN ('PENDING_PAYMENT','CONFIRMED');
 */
@Injectable()
export class BookingsService {
  private readonly redis: Redis;
  private readonly lockTtl: number;

  constructor(private readonly prisma: PrismaService) {
    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    this.lockTtl = Number(process.env.SEAT_LOCK_TTL_SECONDS ?? 600);
  }

  private lockKey(tripId: string, seat: string) {
    return `seatlock:${tripId}:${seat}`;
  }

  /**
   * Étape 1 du parcours : bloquer un siège pendant que le voyageur paie.
   * Crée un Booking PENDING_PAYMENT avec expiresAt = now + TTL.
   */
  async holdSeat(dto: CreateBookingDto, user?: JwtUser) {
    // Cohérence profil/canal : un voyageur réserve via APP, un compte agence via COUNTER
    if (user?.type === 'traveler' && dto.channel !== 'APP')
      throw new BadRequestException('Canal invalide pour un compte voyageur');
    if (user?.type === 'agency' && dto.channel !== 'COUNTER')
      throw new BadRequestException('Canal invalide pour un compte agence');
    const trip = await this.prisma.trip.findUnique({
      where: { id: dto.tripId },
      include: { agency: true, bus: { include: { seatMap: true } } },
    });
    if (!trip) throw new NotFoundException('Départ introuvable');
    if (trip.status !== 'SCHEDULED')
      throw new BadRequestException('Ce départ n\'est plus ouvert à la vente');
    if (trip.agency.status !== 'ACTIVE')
      throw new BadRequestException('Agence inactive');
    if (!trip.bus)
      throw new BadRequestException('Aucun bus affecté à ce départ');

    // Le siège demandé existe-t-il dans le plan du bus ?
    const layout = trip.bus.seatMap.layout as { seats: (string | null)[] }[];
    const allSeats = layout.flatMap((r) => r.seats).filter(Boolean);
    if (!allSeats.includes(dto.seatNumber))
      throw new BadRequestException(`Siège ${dto.seatNumber} inexistant sur ce bus`);

    // Défense 1 : verrou Redis
    const key = this.lockKey(dto.tripId, dto.seatNumber);
    const locked = await this.redis.set(key, dto.passengerPhone, 'EX', this.lockTtl, 'NX');
    if (!locked)
      throw new ConflictException('Siège en cours de réservation par un autre voyageur');

    try {
      // Défenses 2 et 3 : transaction + contrainte unique partielle en base
      const expiresAt = new Date(Date.now() + this.lockTtl * 1000);
      const commission = Math.round(
        (trip.priceFcfa * Number(trip.agency.commissionRate)) / 100,
      );

      const booking = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.booking.findFirst({
          where: {
            tripId: dto.tripId,
            seatNumber: dto.seatNumber,
            status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] },
          },
        });
        if (existing) throw new ConflictException('Siège déjà réservé');

        return tx.booking.create({
          data: {
            agencyId: trip.agencyId,
            tripId: dto.tripId,
            seatNumber: dto.seatNumber,
            travelerId: user?.type === 'traveler' ? user.sub : null,
            cashierId: user?.type === 'agency' ? user.sub : null,
            channel: dto.channel ?? 'APP',
            status: 'PENDING_PAYMENT',
            passengerName: dto.passengerName,
            passengerIdNumber: dto.passengerIdNumber ?? null,
            passengerPhone: dto.passengerPhone,
            amountFcfa: trip.priceFcfa,
            commissionFcfa: commission,
            expiresAt,
          },
        });
      });

      return {
        bookingId: booking.id,
        amountFcfa: booking.amountFcfa,
        expiresAt: booking.expiresAt,
        nextStep: 'Initier le paiement via POST /payments/initiate',
      };
    } catch (e) {
      // Échec en base : on libère immédiatement le verrou Redis
      await this.redis.del(key);
      throw e;
    }
  }

  /**
   * Appelé par le module Payments à la confirmation du paiement.
   * Passe le booking en CONFIRMED et libère le verrou (le siège est
   * désormais protégé par la contrainte unique partielle).
   */
  async confirm(bookingId: string) {
    const booking = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'CONFIRMED', expiresAt: null },
    });
    await this.redis.del(this.lockKey(booking.tripId, booking.seatNumber));
    return booking;
  }

  /**
   * Tâche planifiée (cron) : expire les bookings dont le paiement n'a
   * jamais été confirmé, pour remettre les sièges en vente.
   */
  async expireStaleHolds() {
    const stale = await this.prisma.booking.findMany({
      where: { status: 'PENDING_PAYMENT', expiresAt: { lt: new Date() } },
      select: { id: true, tripId: true, seatNumber: true },
    });
    for (const b of stale) {
      await this.prisma.booking.update({
        where: { id: b.id },
        data: { status: 'EXPIRED' },
      });
      await this.redis.del(this.lockKey(b.tripId, b.seatNumber));
    }
    return { expired: stale.length };
  }

  /** Plan de sièges d'un départ avec statut de chaque siège. */
  async seatMap(tripId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        bus: { include: { seatMap: true } },
        bookings: {
          where: { status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] } },
          select: { seatNumber: true, status: true },
        },
      },
    });
    if (!trip || !trip.bus) throw new NotFoundException('Départ ou bus introuvable');

    const taken = new Map(trip.bookings.map((b) => [b.seatNumber, b.status]));
    const layout = trip.bus.seatMap.layout as { row: number; seats: (string | null)[] }[];

    return layout.map((row) => ({
      row: row.row,
      seats: row.seats.map((s) =>
        s === null
          ? null
          : { number: s, status: taken.get(s) === 'CONFIRMED' ? 'TAKEN' : taken.has(s) ? 'HELD' : 'FREE' },
      ),
    }));
  }
}
