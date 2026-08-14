import { Body, Controller, Get, Headers, Param, Post, Req } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Déclenche le push Mobile Money après un /bookings/hold. */
  @Post('initiate')
  initiate(@Body() dto: InitiatePaymentDto) {
    return this.payments.initiate(dto.bookingId, dto.provider, dto.payerPhone);
  }

  /** Webhook de l'agrégateur (signature vérifiée). */
  @Post('webhook')
  webhook(
    @Req() req: any,
    @Headers('x-signature') signature: string,
    @Body() body: { aggregatorRef: string; status: 'SUCCESS' | 'FAILED'; reason?: string },
  ) {
    const raw = req.rawBody ? req.rawBody.toString() : JSON.stringify(body);
    return this.payments.handleWebhook(raw, signature ?? '', body);
  }

  /** Polling du statut côté app voyageur (retourne le billet si émis). */
  @Get(':id/status')
  status(@Param('id') id: string) {
    return this.payments.getStatus(id);
  }

  /** Réconciliation manuelle (sera aussi appelée par un cron). */
  @Post('reconcile')
  reconcile() {
    return this.payments.reconcilePending();
  }
}
