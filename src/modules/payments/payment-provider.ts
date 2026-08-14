/**
 * Abstraction de l'agrégateur de paiement Mobile Money.
 * Permet de changer d'agrégateur (CinetPay, Campay, NotchPay...) sans
 * toucher au reste du code : il suffit d'implémenter cette interface.
 */

export type PushProvider = 'MTN_MOMO' | 'ORANGE_MONEY';

export interface InitiatePushInput {
  paymentId: string;      // notre référence interne (Payment.id)
  amountFcfa: number;
  payerPhone: string;     // ex. 6XXXXXXXX
  provider: PushProvider;
  description: string;    // affiché au payeur (ex. "Billet Douala-Yaoundé 12B")
}

export interface InitiatePushResult {
  aggregatorRef: string;              // référence chez l'agrégateur
  status: 'PENDING' | 'FAILED';
  failureReason?: string;
}

export interface StatusResult {
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  failureReason?: string;
}

export interface PaymentProvider {
  /** Déclenche le push USSD/OTP sur le téléphone du payeur. */
  initiatePush(input: InitiatePushInput): Promise<InitiatePushResult>;

  /** Interroge l'agrégateur sur le statut d'une transaction (réconciliation). */
  checkStatus(aggregatorRef: string): Promise<StatusResult>;

  /** Vérifie la signature d'un webhook entrant. */
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}

/**
 * Implémentation Sandbox : simule un agrégateur pour développer et tester
 * toute la chaîne (app → hold → paiement → billet) sans contrat signé.
 *
 * Règles de simulation (basées sur le dernier chiffre du téléphone) :
 *   - se termine par 0 : échec immédiat (solde insuffisant)
 *   - se termine par 9 : reste PENDING (simule un timeout à réconcilier)
 *   - sinon : SUCCESS au bout de ~3 s (via checkStatus ou webhook simulé)
 */
export class SandboxPaymentProvider implements PaymentProvider {
  private readonly transactions = new Map<
    string,
    { status: 'PENDING' | 'SUCCESS' | 'FAILED'; readyAt: number; failureReason?: string }
  >();

  async initiatePush(input: InitiatePushInput): Promise<InitiatePushResult> {
    const ref = `SBX-${input.paymentId}`;
    const last = input.payerPhone.slice(-1);

    if (last === '0') {
      this.transactions.set(ref, {
        status: 'FAILED',
        readyAt: 0,
        failureReason: 'Solde insuffisant (simulation)',
      });
      return { aggregatorRef: ref, status: 'FAILED', failureReason: 'Solde insuffisant (simulation)' };
    }

    this.transactions.set(ref, {
      status: last === '9' ? 'PENDING' : 'SUCCESS',
      readyAt: Date.now() + 3000,
    });
    return { aggregatorRef: ref, status: 'PENDING' };
  }

  async checkStatus(aggregatorRef: string): Promise<StatusResult> {
    const tx = this.transactions.get(aggregatorRef);
    if (!tx) return { status: 'FAILED', failureReason: 'Transaction inconnue' };
    if (tx.status === 'SUCCESS' && Date.now() < tx.readyAt) return { status: 'PENDING' };
    return { status: tx.status, failureReason: tx.failureReason };
  }

  verifyWebhookSignature(_rawBody: string, signature: string): boolean {
    // En sandbox : signature attendue = valeur de PAYMENT_WEBHOOK_SECRET ou "sandbox"
    return signature === (process.env.PAYMENT_WEBHOOK_SECRET || 'sandbox');
  }
}
