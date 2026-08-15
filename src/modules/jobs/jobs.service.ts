import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingsService } from '../bookings/bookings.service';
import { PaymentsService } from '../payments/payments.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

/**
 * Tâches planifiées internes (une seule instance de l'API doit les exécuter ;
 * si l'API est un jour répliquée, désactiver via JOBS_ENABLED=false sur les
 * réplicas). Toutes sont idempotentes.
 */
@Injectable()
export class JobsService {
  private readonly log = new Logger('Jobs');
  private readonly enabled = (process.env.JOBS_ENABLED ?? 'true') !== 'false';

  constructor(
    private readonly bookings: BookingsService,
    private readonly payments: PaymentsService,
    private readonly subs: SubscriptionsService,
  ) {}

  /** Chaque minute : libère les sièges dont le paiement n'a pas abouti dans le délai. */
  @Cron(CronExpression.EVERY_MINUTE)
  async expireHolds() {
    if (!this.enabled) return;
    try {
      const r = await this.bookings.expireStaleHolds();
      if (r.expired > 0) this.log.log(`Sièges libérés : ${r.expired}`);
    } catch (e) { this.log.error(`expireHolds : ${(e as Error).message}`); }
  }

  /** Toutes les 2 min : réconcilie les paiements (billets + abonnements) restés en attente. */
  @Cron('*/2 * * * *')
  async reconcile() {
    if (!this.enabled) return;
    try {
      const a = await this.payments.reconcilePending();
      const b = await this.subs.reconcilePending();
      if (a.checked || b.checked) this.log.log(`Réconciliation billets ${JSON.stringify(a)} | abonnements ${JSON.stringify(b)}`);
    } catch (e) { this.log.error(`reconcile : ${(e as Error).message}`); }
  }

  /** Chaque jour à 06:00 (heure serveur) : rappels, mise en demeure, seconde relance, suspension. */
  @Cron('0 6 * * *')
  async subscriptionLifecycle() {
    if (!this.enabled) return;
    try {
      const r = await this.subs.runLifecycle();
      this.log.log(`Cycle abonnements : ${JSON.stringify(r)}`);
    } catch (e) { this.log.error(`lifecycle : ${(e as Error).message}`); }
  }
}
