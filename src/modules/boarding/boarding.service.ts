import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtUser } from '../auth/auth.service';

/**
 * Format du jeton QR (émis par PaymentsService.issueTicket) :
 *   WKG.<bookingId>.<nonce>.<signature HMAC 16 hex>
 * La signature permet de VÉRIFIER UN BILLET SANS RÉSEAU : le contrôleur peut
 * détecter un QR forgé même hors ligne. Le statut (déjà embarqué / annulé) est
 * quant à lui vérifié en ligne, ou via le manifeste pré-téléchargé.
 */
export function verifyQrSignature(qrToken: string): { ok: boolean; bookingId?: string } {
  const parts = qrToken.split('.');
  if (parts.length !== 4 || parts[0] !== 'WKG') return { ok: false };
  const [, bookingId, nonce, sig] = parts;
  const expected = createHmac('sha256', process.env.JWT_SECRET ?? 'dev')
    .update(`${bookingId}.${nonce}`)
    .digest('hex')
    .slice(0, 16);
  if (expected.length !== sig.length) return { ok: false };
  const ok = timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  return ok ? { ok: true, bookingId } : { ok: false };
}

export type ScanResult =
  | { result: 'BOARDED'; passengerName: string; seatNumber: string; alreadyBoarded?: false }
  | { result: 'ALREADY_BOARDED'; passengerName: string; seatNumber: string; boardedAt: Date }
  | { result: 'REJECTED'; reason: string };

@Injectable()
export class BoardingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Garantit que l'utilisateur agence agit sur un départ de SA propre agence. */
  private async assertTripOfAgency(tripId: string, user: JwtUser) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        route: { include: { originCity: true, destinationCity: true } },
        bus: { select: { plateNumber: true } },
      },
    });
    if (!trip) throw new NotFoundException('Départ introuvable');
    if (user.type !== 'agency' || trip.agencyId !== user.agencyId)
      throw new ForbiddenException('Ce départ n\'appartient pas à votre agence');
    return trip;
  }

  /**
   * Scan EN LIGNE d'un billet à l'embarquement.
   * Vérifie : signature du QR, existence, appartenance à l'agence, bon départ,
   * statut (VALID / BOARDED / CANCELLED), réservation confirmée.
   * Idempotent : rescanner un billet déjà embarqué renvoie ALREADY_BOARDED
   * (le contrôleur voit tout de suite qu'il y a doublon), sans erreur HTTP.
   */
  async scan(qrToken: string, tripId: string, user: JwtUser): Promise<ScanResult> {
    const trip = await this.assertTripOfAgency(tripId, user);
    if (trip.status !== 'SCHEDULED' && trip.status !== 'BOARDING')
      return { result: 'REJECTED', reason: `Départ au statut ${trip.status}` };

    const sigCheck = verifyQrSignature(qrToken);
    if (!sigCheck.ok) return { result: 'REJECTED', reason: 'QR code invalide (signature)' };

    const ticket = await this.prisma.ticket.findUnique({
      where: { qrToken },
      include: { booking: true },
    });
    if (!ticket) return { result: 'REJECTED', reason: 'Billet inconnu' };
    if (ticket.booking.agencyId !== user.agencyId)
      return { result: 'REJECTED', reason: 'Billet d\'une autre agence' };
    if (ticket.booking.tripId !== tripId)
      return { result: 'REJECTED', reason: 'Billet valable pour un autre départ' };
    if (ticket.status === 'CANCELLED' || ticket.booking.status !== 'CONFIRMED')
      return { result: 'REJECTED', reason: 'Billet annulé ou non payé' };
    if (ticket.status === 'BOARDED')
      return {
        result: 'ALREADY_BOARDED',
        passengerName: ticket.booking.passengerName,
        seatNumber: ticket.booking.seatNumber,
        boardedAt: ticket.boardedAt!,
      };

    await this.prisma.$transaction([
      this.prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'BOARDED', boardedAt: new Date(), controllerId: user.sub },
      }),
      // Le premier scan fait passer le départ en BOARDING
      this.prisma.trip.updateMany({
        where: { id: tripId, status: 'SCHEDULED' },
        data: { status: 'BOARDING' },
      }),
    ]);

    return {
      result: 'BOARDED',
      passengerName: ticket.booking.passengerName,
      seatNumber: ticket.booking.seatNumber,
    };
  }

  /**
   * Manifeste d'un départ : liste des passagers confirmés avec leur statut
   * d'embarquement. Sert à l'écran "liste des passagers" du contrôleur ET
   * de base au MODE HORS LIGNE (téléchargé avant le départ).
   */
  async manifest(tripId: string, user: JwtUser) {
    const trip = await this.assertTripOfAgency(tripId, user);
    const bookings = await this.prisma.booking.findMany({
      where: { tripId, status: 'CONFIRMED' },
      include: { ticket: { select: { qrToken: true, status: true, boardedAt: true } } },
      orderBy: { seatNumber: 'asc' },
    });
    const boarded = bookings.filter((b) => b.ticket?.status === 'BOARDED').length;

    return {
      trip: {
        id: trip.id,
        status: trip.status,
        departureAt: trip.departureAt,
        route: `${trip.route.originCity.name} → ${trip.route.destinationCity.name}`,
        bus: trip.bus?.plateNumber ?? null,
      },
      summary: { confirmed: bookings.length, boarded, remaining: bookings.length - boarded },
      generatedAt: new Date(),
      passengers: bookings.map((b) => ({
        bookingId: b.id,
        seatNumber: b.seatNumber,
        passengerName: b.passengerName,
        passengerPhone: b.passengerPhone,
        passengerIdNumber: b.passengerIdNumber,
        channel: b.channel,
        // qrToken inclus pour permettre la vérification HORS LIGNE
        qrToken: b.ticket?.qrToken ?? null,
        ticketStatus: b.ticket?.status ?? null,
        boardedAt: b.ticket?.boardedAt ?? null,
      })),
    };
  }

  /**
   * SYNCHRONISATION HORS LIGNE : le contrôleur a scanné sans réseau (l'app a
   * validé localement contre le manifeste + la signature HMAC) ; à la
   * reconnexion elle envoie la liste des scans effectués. Chaque scan est
   * rejoué avec les mêmes règles ; le résultat détaille ce qui a été accepté.
   */
  async syncOfflineScans(
    tripId: string,
    scans: { qrToken: string; scannedAt: string }[],
    user: JwtUser,
  ) {
    if (!Array.isArray(scans) || scans.length === 0)
      throw new BadRequestException('Aucun scan à synchroniser');
    if (scans.length > 200)
      throw new BadRequestException('Trop de scans dans une seule synchronisation (max 200)');

    const results: { qrToken: string; result: ScanResult['result']; detail?: string }[] = [];
    for (const s of scans) {
      const r = await this.scanAt(s.qrToken, tripId, user, new Date(s.scannedAt));
      results.push({
        qrToken: s.qrToken,
        result: r.result,
        detail: r.result === 'REJECTED' ? r.reason : undefined,
      });
    }
    const boarded = results.filter((r) => r.result === 'BOARDED').length;
    const already = results.filter((r) => r.result === 'ALREADY_BOARDED').length;
    const rejected = results.filter((r) => r.result === 'REJECTED').length;
    return { total: results.length, boarded, alreadyBoarded: already, rejected, results };
  }

  /** Variante de scan avec horodatage fourni (pour rejouer des scans hors ligne). */
  private async scanAt(qrToken: string, tripId: string, user: JwtUser, at: Date): Promise<ScanResult> {
    const r = await this.scan(qrToken, tripId, user);
    if (r.result === 'BOARDED' && !isNaN(at.getTime())) {
      // On conserve l'heure réelle du scan hors ligne plutôt que l'heure de synchro
      const ticket = await this.prisma.ticket.findUnique({ where: { qrToken } });
      if (ticket) await this.prisma.ticket.update({ where: { id: ticket.id }, data: { boardedAt: at } });
    }
    return r;
  }

  /** Clôture du départ : BOARDING → DEPARTED (le bus est parti). */
  async closeTrip(tripId: string, user: JwtUser) {
    const trip = await this.assertTripOfAgency(tripId, user);
    if (trip.status !== 'SCHEDULED' && trip.status !== 'BOARDING')
      throw new BadRequestException(`Impossible de clôturer un départ au statut ${trip.status}`);
    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: { status: 'DEPARTED' },
    });
    const m = await this.manifest(tripId, user);
    return { tripId: updated.id, status: updated.status, summary: m.summary };
  }
}
