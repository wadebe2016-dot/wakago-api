import { Body, Controller, Get, Headers, Param, Post, Req } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { Public } from '../auth/jwt-auth.guard';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Déclenche le push Mobile Money après un /bookings/hold. */
  @Post('initiate')
  initiate(@Body() dto: InitiatePaymentDto) {
    return this.payments.initiate(dto.bookingId, dto.provider, dto.payerPhone);
  }

  /**
   * Sonde de vérification : Campay (et d'autres agrégateurs) testent l'URL en
   * GET ou en POST vide avant de l'enregistrer. On répond 200 sans rien traiter.
   */
  @Public()
  @Get('webhook')
  webhookProbe() {
    return { ok: true, service: 'wakago-payments-webhook' };
  }

  /** Webhook de l'agrégateur (signature vérifiée) — public par nature. */
  @Public()
  @Post('webhook')
  webhook(
    @Req() req: any,
    @Headers('x-signature') signature: string,
    @Body() body: { aggregatorRef?: string; status?: 'SUCCESS' | 'FAILED'; reason?: string },
  ) {
    // Sonde / ping sans transaction : accusé de réception, aucun traitement.
    if (!body || !body.aggregatorRef) return { ok: true, probe: true };
    const raw = req.rawBody ? req.rawBody.toString() : JSON.stringify(body);
    return this.payments.handleWebhook(raw, signature ?? '', body as any);
  }

  /** Polling du statut côté app voyageur (retourne le billet si émis). */
  @Get(':id/status')
  status(@Param('id') id: string) {
    return this.payments.getStatus(id);
  }

  /** Réconciliation manuelle (cron à venir). TODO restreindre à l'admin plateforme. */
  @Public()
  @Post('reconcile')
  reconcile() {
    return this.payments.reconcilePending();
  }
}
