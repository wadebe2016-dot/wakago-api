import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtUser } from '../auth/auth.service';
import { PaymentProvider, PushProvider } from '../payments/payment-provider';
import { NotificationsService } from './notifications.service';

export const SUBSCRIPTION_PAYMENT_PROVIDER = 'SUBSCRIPTION_PAYMENT_PROVIDER';

/** Paramètres du cycle — modifiables via .env sans changement de code. */
const cfg = () => ({
  graceDays: Number(process.env.SUB_GRACE_DAYS ?? 7),
  reminder1Days: Number(process.env.SUB_REMINDER1_DAYS ?? 7),   // J-7
  reminder2Days: Number(process.env.SUB_REMINDER2_DAYS ?? 2),   // J-2
  secondNoticeDay: Number(process.env.SUB_SECOND_NOTICE_DAY ?? 4), // J+4
});

const DAY = 24 * 60 * 60 * 1000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotificationsService,
    @Inject(SUBSCRIPTION_PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  // ------------------------------ PLANS ------------------------------

  listPlans() {
    return this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { priceFcfa: 'asc' }],
    });
  }

  private periodDays(period: 'MONTHLY' | 'QUARTERLY' | 'YEARLY') {
    return period === 'MONTHLY' ? 30 : period === 'QUARTERLY' ? 90 : 365;
  }

  // ---------------------------- SOUSCRIPTION ---------------------------

  /** Abonnement "courant" d'une agence : le plus récent non annulé. */
  async current(agencyId: string) {
    return this.prisma.subscription.findFirst({
      where: { agencyId, status: { not: 'CANCELLED' } },
      include: { plan: true, notices: { orderBy: { sentAt: 'desc' }, take: 5 } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Vue back-office : statut + bandeau à afficher (mise en demeure). */
  async status(user: JwtUser) {
    if (user.type !== 'agency') throw new ForbiddenException();
    const sub = await this.current(user.agencyId!);
    if (!sub) return { subscription: null, banner: { level: 'info', message: 'Aucun abonnement : choisissez un plan pour activer votre agence.' } };

    let banner: { level: 'none' | 'info' | 'warning' | 'danger'; message: string } = { level: 'none', message: '' };
    const now = new Date();
    if (sub.status === 'GRACE' && sub.graceEndsAt)
      banner = { level: 'danger', message: `MISE EN DEMEURE : abonnement échu le ${fmt(sub.endsAt!)}. Sans paiement avant le ${fmt(sub.graceEndsAt)}, votre agence sera suspendue.` };
    else if (sub.status === 'SUSPENDED')
      banner = { level: 'danger', message: 'Agence SUSPENDUE pour abonnement impayé. Réglez votre abonnement pour réactiver immédiatement.' };
    else if ((sub.status === 'ACTIVE' || sub.status === 'TRIAL') && sub.endsAt && sub.endsAt.getTime() - now.getTime() < cfg().reminder1Days * DAY)
      banner = { level: 'warning', message: `Votre abonnement expire le ${fmt(sub.endsAt)}. Pensez à le renouveler.` };

    return { subscription: sub, banner };
  }

  /**
   * Souscrire ou renouveler. Si un essai est prévu et que l'agence n'a jamais
   * eu d'abonnement : TRIAL immédiat sans paiement. Sinon : PENDING jusqu'au
   * paiement (l'agence est servie APRÈS paiement).
   */
  async subscribe(planCode: string, user: JwtUser) {
    if (user.type !== 'agency' || !['OWNER', 'MANAGER'].includes(user.role ?? ''))
      throw new ForbiddenException('Réservé au gérant ou au gestionnaire');
    const plan = await this.prisma.subscriptionPlan.findUnique({ where: { code: planCode } });
    if (!plan || !plan.isActive) throw new NotFoundException('Plan introuvable');

    const previous = await this.prisma.subscription.count({ where: { agencyId: user.agencyId! } });
    const firstEver = previous === 0;

    if (firstEver && plan.trialDays > 0) {
      const now = new Date();
      const sub = await this.prisma.subscription.create({
        data: {
          agencyId: user.agencyId!, planId: plan.id, status: 'TRIAL',
          startsAt: now, endsAt: addDays(now, plan.trialDays), graceEndsAt: addDays(now, plan.trialDays + cfg().graceDays),
        },
      });
      await this.prisma.agency.update({ where: { id: user.agencyId! }, data: { status: 'ACTIVE' } });
      return { subscriptionId: sub.id, status: sub.status, endsAt: sub.endsAt, message: `Essai gratuit de ${plan.trialDays} jours activé` };
    }

    const sub = await this.prisma.subscription.create({
      data: { agencyId: user.agencyId!, planId: plan.id, status: 'PENDING' },
    });
    return { subscriptionId: sub.id, status: sub.status, amountFcfa: plan.priceFcfa, nextStep: 'POST /subscriptions/pay' };
  }

  /** Déclenche le paiement Mobile Money de l'abonnement (compte Atlastech). */
  async pay(subscriptionId: string, provider: PushProvider, payerPhone: string, user: JwtUser) {
    const sub = await this.prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: true } });
    if (!sub) throw new NotFoundException('Abonnement introuvable');
    if (user.type !== 'agency' || sub.agencyId !== user.agencyId) throw new ForbiddenException();
    if (!['PENDING', 'GRACE', 'SUSPENDED', 'ACTIVE', 'TRIAL'].includes(sub.status))
      throw new BadRequestException(`Paiement impossible au statut ${sub.status}`);

    const payment = await this.prisma.subscriptionPayment.create({
      data: { subscriptionId, provider, status: 'INITIATED', amountFcfa: sub.plan.priceFcfa, payerPhone },
    });
    const res = await this.provider.initiatePush({
      paymentId: payment.id, amountFcfa: sub.plan.priceFcfa, payerPhone, provider,
      description: `Abonnement ReadyGo ${sub.plan.name}`,
    });
    const updated = await this.prisma.subscriptionPayment.update({
      where: { id: payment.id },
      data: { aggregatorRef: res.aggregatorRef, status: res.status === 'FAILED' ? 'FAILED' : 'PENDING', failureReason: res.failureReason ?? null },
    });
    return { paymentId: updated.id, status: updated.status, message: updated.status === 'PENDING' ? 'Validez le paiement sur votre téléphone' : `Paiement refusé : ${updated.failureReason}` };
  }

  /** Webhook / réconciliation : confirme le paiement et ACTIVE (ou réactive) l'abonnement. */
  async settle(paymentId: string) {
    const p = await this.prisma.subscriptionPayment.findUnique({ where: { id: paymentId }, include: { subscription: { include: { plan: true } } } });
    if (!p) throw new NotFoundException('Paiement introuvable');
    if (p.status === 'SUCCESS') return { ok: true, alreadyProcessed: true };

    const sub = p.subscription;
    const now = new Date();
    // Renouvellement anticipé : la nouvelle période démarre à la fin de l'actuelle
    const base = (sub.status === 'ACTIVE' || sub.status === 'TRIAL') && sub.endsAt && sub.endsAt > now ? sub.endsAt : now;
    const endsAt = addDays(base, this.periodDays(sub.plan.period));
    const wasSuspended = sub.status === 'SUSPENDED' || sub.status === 'GRACE';

    await this.prisma.$transaction([
      this.prisma.subscriptionPayment.update({ where: { id: p.id }, data: { status: 'SUCCESS' } }),
      this.prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'ACTIVE', startsAt: sub.startsAt ?? now, endsAt, graceEndsAt: addDays(endsAt, cfg().graceDays), suspendedAt: null },
      }),
      this.prisma.agency.update({ where: { id: sub.agencyId }, data: { status: 'ACTIVE' } }),
      // Un nouveau cycle : on autorise de nouvelles notices (on supprime celles de l'ancien cycle)
      this.prisma.subscriptionNotice.deleteMany({ where: { subscriptionId: sub.id, kind: { in: ['REMINDER_7D', 'REMINDER_2D', 'FORMAL_NOTICE', 'SECOND_NOTICE', 'SUSPENSION'] } } }),
    ]);
    if (wasSuspended) await this.sendNotice(sub.id, 'REACTIVATION', `Votre abonnement ReadyGo est réactivé. Nouvelle échéance : ${fmt(endsAt)}. Merci.`, null);
    return { ok: true, endsAt };
  }

  /** Réconciliation des paiements d'abonnement en attente (cron). */
  async reconcilePending(olderThanSeconds = 60) {
    const cutoff = new Date(Date.now() - olderThanSeconds * 1000);
    const pending = await this.prisma.subscriptionPayment.findMany({ where: { status: 'PENDING', createdAt: { lt: cutoff }, aggregatorRef: { not: null } }, take: 50 });
    let confirmed = 0, failed = 0;
    for (const p of pending) {
      const r = await this.provider.checkStatus(p.aggregatorRef!);
      if (r.status === 'SUCCESS') { await this.settle(p.id); confirmed++; }
      else if (r.status === 'FAILED') { await this.prisma.subscriptionPayment.update({ where: { id: p.id }, data: { status: 'FAILED', failureReason: r.failureReason ?? null } }); failed++; }
    }
    return { checked: pending.length, confirmed, failed };
  }

  // ------------------------- CYCLE DE VIE (CRON) -------------------------

  /**
   * À exécuter au moins une fois par jour. Idempotent (une notice de chaque
   * type par cycle grâce à la contrainte unique). Étapes :
   *  J-7 / J-2 : rappels — J+0 : mise en demeure + passage en GRACE —
   *  J+4 : seconde relance — J+7 : suspension.
   */
  async runLifecycle(now = new Date()) {
    const c = cfg();
    const out = { reminders7d: 0, reminders2d: 0, formalNotices: 0, secondNotices: 0, suspensions: 0 };

    // Rappels préventifs sur abonnements ACTIVE/TRIAL proches de l'échéance
    const upcoming = await this.prisma.subscription.findMany({
      where: { status: { in: ['ACTIVE', 'TRIAL'] }, endsAt: { gt: now, lte: addDays(now, c.reminder1Days) } },
      include: { notices: true },
    });
    for (const s of upcoming) {
      const daysLeft = Math.ceil((s.endsAt!.getTime() - now.getTime()) / DAY);
      const has = (k: string) => s.notices.some((n) => n.kind === k);
      if (daysLeft <= c.reminder2Days && !has('REMINDER_2D')) {
        await this.sendNotice(s.id, 'REMINDER_2D', `Rappel : votre abonnement ReadyGo expire le ${fmt(s.endsAt!)} (dans ${daysLeft} j). Renouvelez-le pour éviter toute interruption.`, s.endsAt);
        out.reminders2d++;
      } else if (!has('REMINDER_7D')) {
        await this.sendNotice(s.id, 'REMINDER_7D', `Votre abonnement ReadyGo expire le ${fmt(s.endsAt!)}. Vous pouvez le renouveler dès maintenant depuis votre espace agence.`, s.endsAt);
        out.reminders7d++;
      }
    }

    // J+0 : échéance dépassée et impayée → MISE EN DEMEURE + GRACE
    const expired = await this.prisma.subscription.findMany({ where: { status: { in: ['ACTIVE', 'TRIAL'] }, endsAt: { lte: now } } });
    for (const s of expired) {
      const graceEndsAt = addDays(s.endsAt!, c.graceDays);
      await this.prisma.subscription.update({ where: { id: s.id }, data: { status: 'GRACE', graceEndsAt } });
      await this.sendNotice(s.id, 'FORMAL_NOTICE',
        `MISE EN DEMEURE — Votre abonnement ReadyGo est échu depuis le ${fmt(s.endsAt!)} et n'a pas été réglé. À défaut de paiement avant le ${fmt(graceEndsAt)}, votre agence sera suspendue de la plateforme (les billets déjà vendus resteront valides). Régularisez depuis votre espace agence.`,
        graceEndsAt);
      out.formalNotices++;
    }

    // J+4 : seconde relance
    const inGrace = await this.prisma.subscription.findMany({ where: { status: 'GRACE', graceEndsAt: { gt: now } }, include: { notices: true } });
    for (const s of inGrace) {
      const daysSinceDue = (now.getTime() - s.endsAt!.getTime()) / DAY;
      if (daysSinceDue >= c.secondNoticeDay && !s.notices.some((n) => n.kind === 'SECOND_NOTICE')) {
        const left = Math.ceil((s.graceEndsAt!.getTime() - now.getTime()) / DAY);
        await this.sendNotice(s.id, 'SECOND_NOTICE', `Dernier rappel — Il vous reste ${left} jour(s) avant la suspension de votre agence ReadyGo (échéance : ${fmt(s.graceEndsAt!)}). Réglez votre abonnement pour l'éviter.`, s.graceEndsAt);
        out.secondNotices++;
      }
    }

    // J+7 : fin de grâce → SUSPENSION
    const toSuspend = await this.prisma.subscription.findMany({ where: { status: 'GRACE', graceEndsAt: { lte: now } } });
    for (const s of toSuspend) {
      await this.prisma.$transaction([
        this.prisma.subscription.update({ where: { id: s.id }, data: { status: 'SUSPENDED', suspendedAt: now } }),
        this.prisma.agency.update({ where: { id: s.agencyId }, data: { status: 'SUSPENDED' } }),
      ]);
      await this.sendNotice(s.id, 'SUSPENSION', `Votre agence ReadyGo est suspendue pour abonnement impayé. Vos départs ne sont plus visibles des voyageurs ; les billets déjà vendus restent valides. Le paiement de votre abonnement réactive immédiatement votre agence.`, null);
      out.suspensions++;
    }
    return out;
  }

  /** Envoi tracé (SMS + email + bandeau) — la preuve de la mise en demeure. */
  private async sendNotice(subscriptionId: string, kind: any, content: string, deadlineAt: Date | null) {
    const sub = await this.prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { agency: true } });
    if (!sub) return;
    const phone = sub.agency.phone, email = sub.agency.email;
    const channels = ['BACKOFFICE', 'SMS', ...(email ? ['EMAIL'] : [])];
    await this.notify.sendSms(phone, content);
    if (email) await this.notify.sendEmail(email, `ReadyGo — ${kind === 'FORMAL_NOTICE' ? 'Mise en demeure' : 'Abonnement'}`, content);
    try {
      await this.prisma.subscriptionNotice.create({
        data: { agencyId: sub.agencyId, subscriptionId, kind, channels, recipientPhone: phone, recipientEmail: email, content, deadlineAt },
      });
    } catch { /* déjà envoyée (contrainte unique) : idempotence du cron */ }
  }

  // ------------------------------ ADMIN ------------------------------

  /** Sursis manuel : prolonge le délai de grâce (l'admin garde la main). */
  async grantExtension(subscriptionId: string, extraDays: number) {
    const sub = await this.prisma.subscription.findUnique({ where: { id: subscriptionId } });
    if (!sub) throw new NotFoundException();
    if (!['GRACE', 'SUSPENDED'].includes(sub.status)) throw new BadRequestException('Sursis possible uniquement en GRACE ou SUSPENDED');
    const graceEndsAt = addDays(sub.graceEndsAt ?? new Date(), extraDays);
    await this.prisma.$transaction([
      this.prisma.subscription.update({ where: { id: sub.id }, data: { status: 'GRACE', graceEndsAt, suspendedAt: null } }),
      this.prisma.agency.update({ where: { id: sub.agencyId }, data: { status: 'ACTIVE' } }),
      this.prisma.subscriptionNotice.deleteMany({ where: { subscriptionId: sub.id, kind: 'SUSPENSION' } }),
    ]);
    return { subscriptionId: sub.id, status: 'GRACE', graceEndsAt };
  }
}
