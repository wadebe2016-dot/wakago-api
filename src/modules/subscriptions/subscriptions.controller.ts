import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { ExtensionDto, PaySubscriptionDto, SubscribeDto } from './dto/subscriptions.dto';
import { CurrentUser, Public, Roles } from '../auth/jwt-auth.guard';
import { JwtUser } from '../auth/auth.service';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  /** Plans disponibles (public : affichés sur la page de souscription). */
  @Public()
  @Get('plans')
  plans() {
    return this.subs.listPlans();
  }

  /** Statut de l'abonnement de MON agence + bandeau (mise en demeure). */
  @Roles('OWNER', 'MANAGER', 'CASHIER', 'CONTROLLER')
  @Get('me')
  me(@CurrentUser() user: JwtUser) {
    return this.subs.status(user);
  }

  /** Souscrire / renouveler (gérant, gestionnaire). */
  @Roles('OWNER', 'MANAGER')
  @Post()
  subscribe(@Body() dto: SubscribeDto, @CurrentUser() user: JwtUser) {
    return this.subs.subscribe(dto.planCode, user);
  }

  /** Payer l'abonnement par Mobile Money. */
  @Roles('OWNER', 'MANAGER')
  @Post('pay')
  pay(@Body() dto: PaySubscriptionDto, @CurrentUser() user: JwtUser) {
    return this.subs.pay(dto.subscriptionId, dto.provider, dto.payerPhone, user);
  }

  // ---- Opérations plateforme (rôle 'platform') ; les crons utilisent un jeton plateforme ----

  /** Réconciliation des paiements d'abonnement (cron). */
  @Roles('platform')
  @Post('reconcile')
  reconcile() {
    return this.subs.reconcilePending();
  }

  /** Cycle de vie quotidien : rappels, mise en demeure, seconde relance, suspension. */
  @Roles('platform')
  @Post('lifecycle/run')
  lifecycle() {
    return this.subs.runLifecycle();
  }

  /** Sursis manuel accordé par la plateforme. */
  @Roles('platform')
  @Post(':id/extension')
  extension(@Param('id') id: string, @Body() dto: ExtensionDto) {
    return this.subs.grantExtension(id, dto.extraDays);
  }
}
