import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const ACTIVE_BOOKING_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED'] as const;

@Injectable()
export class TripsService {
  constructor(private readonly prisma: PrismaService) {}

  async search(fromCityId: string, toCityId: string, dateISO: string) {
    if (!fromCityId || !toCityId || !dateISO) {
      throw new BadRequestException('Paramètres requis : from, to, date');
    }
    const dayStart = new Date(`${dateISO}T00:00:00Z`);
    const dayEnd = new Date(`${dateISO}T23:59:59Z`);

    const trips = await this.prisma.trip.findMany({
      where: {
        status: 'SCHEDULED',
        departureAt: { gte: dayStart, lte: dayEnd },
        route: { originCityId: fromCityId, destinationCityId: toCityId },
        agency: { status: 'ACTIVE' },
      },
      include: {
        agency: { select: { id: true, name: true, requireIdNumber: true } },
        boardingPoint: { select: { name: true, address: true } },
        bus: { include: { seatMap: { select: { capacity: true } } } },
        _count: {
          select: {
            bookings: { where: { status: { in: [...ACTIVE_BOOKING_STATUSES] } } },
          },
        },
      },
      orderBy: { departureAt: 'asc' },
    });

    return trips.map((t) => ({
      id: t.id,
      agency: t.agency.name,
      requireIdNumber: t.agency.requireIdNumber,
      departureAt: t.departureAt,
      boardingPoint: t.boardingPoint,
      priceFcfa: t.priceFcfa,
      capacity: t.bus?.seatMap.capacity ?? null,
      seatsLeft: t.bus ? t.bus.seatMap.capacity - t._count.bookings : null,
    }));
  }
}
