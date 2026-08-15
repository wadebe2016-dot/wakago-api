import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { JwtAuthGuard, Roles } from '../../common/auth.guard';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Déclenche le push Mobile Money après un /bookings/hold. Authentifié. */
  @Post('initiate')
  @UseGuards(JwtAuthGuard)
  initiate(@Body() dto: InitiatePaymentDto) {
    return this.payments.initiate(dto.bookingId, dto.provider, dto.payerPhone);
  }

  /** Webhook de l'agrégateur — public, protégé par signature. */
  @Post('webhook')
  webhook(
    @Req() req: any,
    @Headers('x-signature') signature: string,
    @Body() body: { aggregatorRef: string; status: 'SUCCESS' | 'FAILED'; reason?: string },
  ) {
    const raw = req.rawBody ? req.rawBody.toString() : JSON.stringify(body);
    return this.payments.handleWebhook(raw, signature ?? '', body);
  }

  /** Polling du statut côté app voyageur. Authentifié. */
  @Get(':id/status')
  @UseGuards(JwtAuthGuard)
  status(@Param('id') id: string) {
    return this.payments.getStatus(id);
  }

  /** Réconciliation manuelle — gestionnaires uniquement (un cron l'automatisera). */
  @Post('reconcile')
  @UseGuards(JwtAuthGuard)
  @Roles('OWNER', 'MANAGER')
  reconcile() {
    return this.payments.reconcilePending();
  }
}
