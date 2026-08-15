import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, createHmac } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { BookingsService } from '../bookings/bookings.service';
import { PaymentProvider, PushProvider } from './payment-provider';
import { NotificationsService } from '../subscriptions/notifications.service';

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly notify: NotificationsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * Étape 2 du parcours (après /bookings/hold) : déclenche le push
   * Mobile Money sur le téléphone du payeur.
   */
  async initiate(bookingId: string, provider: PushProvider, payerPhone: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { trip: { include: { route: { include: { originCity: true, destinationCity: true } } } } },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable');
    if (booking.status !== 'PENDING_PAYMENT')
      throw new BadRequestException(`Réservation au statut ${booking.status} : paiement impossible`);
    if (booking.expiresAt && booking.expiresAt < new Date())
      throw new BadRequestException('Blocage de siège expiré, recommencez la réservation');

    const payment = await this.prisma.payment.create({
      data: {
        bookingId,
        provider,
        status: 'INITIATED',
        amountFcfa: booking.amountFcfa,
        payerPhone,
      },
    });

    const description = `Billet ${booking.trip.route.originCity.name}-${booking.trip.route.destinationCity.name} siège ${booking.seatNumber}`;
    const res = await this.provider.initiatePush({
      paymentId: payment.id,
      amountFcfa: booking.amountFcfa,
      payerPhone,
      provider,
      description,
    });

    const updated = await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        aggregatorRef: res.aggregatorRef,
        status: res.status === 'FAILED' ? 'FAILED' : 'PENDING',
        failureReason: res.failureReason ?? null,
      },
    });

    return {
      paymentId: updated.id,
      status: updated.status,
      message:
        updated.status === 'PENDING'
          ? 'Validez le paiement sur votre téléphone (push Mobile Money envoyé)'
          : `Paiement refusé : ${updated.failureReason}`,
    };
  }

  /**
   * Webhook de l'agrégateur. Vérifie la signature, met à jour le paiement
   * et, en cas de succès, confirme la réservation et émet le billet QR.
   * Idempotent : un webhook rejoué ne crée pas de second billet.
   */
  async handleWebhook(rawBody: string, signature: string, payload: { aggregatorRef: string; status: 'SUCCESS' | 'FAILED'; reason?: string }) {
    if (!this.provider.verifyWebhookSignature(rawBody, signature))
      throw new UnauthorizedException('Signature de webhook invalide');

    const payment = await this.prisma.payment.findUnique({
      where: { aggregatorRef: payload.aggregatorRef },
    });
    if (!payment) throw new NotFoundException('Paiement inconnu');

    // Idempotence : déjà traité
    if (payment.status === 'SUCCESS' || payment.status === 'FAILED')
      return { ok: true, alreadyProcessed: true };

    if (payload.status === 'FAILED') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failureReason: payload.reason ?? 'Refusé par l\'opérateur' },
      });
      return { ok: true };
    }

    return this.settleSuccess(payment.id, payment.bookingId);
  }

  /** Marque le paiement réussi, confirme le booking, émet le billet. */
  private async settleSuccess(paymentId: string, bookingId: string) {
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'SUCCESS' },
    });
    await this.bookings.confirm(bookingId);
    const ticket = await this.issueTicket(bookingId);
    await this.sendTicket(bookingId, ticket.qrToken).catch(() => undefined);
    return { ok: true, ticketId: ticket.id };
  }

  /** Envoie le billet au voyageur sur le canal qu'il a choisi (SMS ou WhatsApp). */
  private async sendTicket(bookingId: string, qrToken: string) {
    const b = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { agency: { select: { name: true } }, trip: { include: { route: { include: { originCity: true, destinationCity: true } }, boardingPoint: true } } },
    });
    if (!b) return;
    const d = b.trip.departureAt;
    const date = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
    const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    const ref = qrToken.split('.')[1]?.slice(-8).toUpperCase() ?? '';
    const route = `${b.trip.route.originCity.name} → ${b.trip.route.destinationCity.name}`;
    const text = `Bonjour ${b.passengerName}, votre billet ${b.agency.name} est confirmé : ${route}, le ${date} à ${time}, siège ${b.seatNumber}. Embarquement : ${b.trip.boardingPoint.name}. Réf. ${ref}. Présentez ce message ou le QR de l'application Wakago au contrôleur. Bon voyage !`;
    const channel = (b.ticketChannel === 'WHATSAPP' ? 'WHATSAPP' : 'SMS') as 'SMS' | 'WHATSAPP';
    // Modèle Meta wakago_billet : {{1}} nom, {{2}} agence, {{3}} trajet, {{4}} date heure, {{5}} siège, {{6}} référence
    const ok = await this.notify.send(channel, b.passengerPhone, text, { template: 'ticket', params: [b.passengerName, b.agency.name, route, `${date} ${time}`, b.seatNumber, ref] });
    if (!ok && channel === 'WHATSAPP') await this.notify.sendSms(b.passengerPhone, text);
  }

  /** Émet le billet avec un jeton QR signé (HMAC), idempotent. */
  private async issueTicket(bookingId: string) {
    const existing = await this.prisma.ticket.findUnique({ where: { bookingId } });
    if (existing) return existing;

    const nonce = randomBytes(12).toString('hex');
    const sig = createHmac('sha256', process.env.JWT_SECRET ?? 'dev')
      .update(`${bookingId}.${nonce}`)
      .digest('hex')
      .slice(0, 16);
    const qrToken = `WKG.${bookingId}.${nonce}.${sig}`;

    return this.prisma.ticket.create({
      data: { bookingId, qrToken, status: 'VALID' },
    });
  }

  /**
   * Réconciliation (cron toutes les 1-2 min) : interroge l'agrégateur pour
   * les paiements PENDING trop anciens. Traite le cas "débité mais
   * webhook jamais reçu" — critique pour la confiance des voyageurs.
   */
  async reconcilePending(olderThanSeconds = 60) {
    const cutoff = new Date(Date.now() - olderThanSeconds * 1000);
    const pending = await this.prisma.payment.findMany({
      where: { status: 'PENDING', createdAt: { lt: cutoff }, aggregatorRef: { not: null } },
      take: 50,
    });

    let confirmed = 0, failed = 0, timedOut = 0;
    for (const p of pending) {
      const res = await this.provider.checkStatus(p.aggregatorRef!);
      if (res.status === 'SUCCESS') {
        await this.settleSuccess(p.id, p.bookingId);
        confirmed++;
      } else if (res.status === 'FAILED') {
        await this.prisma.payment.update({
          where: { id: p.id },
          data: { status: 'FAILED', failureReason: res.failureReason ?? null },
        });
        failed++;
      } else if (p.createdAt < new Date(Date.now() - 15 * 60 * 1000)) {
        // Toujours PENDING après 15 min : on marque TIMEOUT, le siège sera
        // libéré par expireStaleHolds ; si l'argent a été débité, le
        // rapprochement manuel côté admin tranchera (remboursement).
        await this.prisma.payment.update({ where: { id: p.id }, data: { status: 'TIMEOUT' } });
        timedOut++;
      }
    }
    return { checked: pending.length, confirmed, failed, timedOut };
  }

  /** Statut d'un paiement (polling côté app voyageur). */
  async getStatus(paymentId: string) {
    const p = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { include: { ticket: true } } },
    });
    if (!p) throw new NotFoundException('Paiement introuvable');
    return {
      status: p.status,
      failureReason: p.failureReason,
      ticket: p.booking.ticket ? { id: p.booking.ticket.id, qrToken: p.booking.ticket.qrToken } : null,
    };
  }
}
