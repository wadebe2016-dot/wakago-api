import { Injectable, Logger } from '@nestjs/common';

/**
 * Passerelles SMS / email. Pour l'instant : journalisation (stub).
 * Branchement réel : SMS_GATEWAY_URL / SMS_GATEWAY_KEY (à choisir) et un
 * service email (SES, Brevo...). L'interface ne changera pas.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notifications');

  async sendSms(phone: string, text: string) {
    this.log.log(`[SMS stub] → ${phone} : ${text}`);
    return true;
  }

  async sendEmail(to: string, subject: string, text: string) {
    this.log.log(`[EMAIL stub] → ${to} | ${subject} : ${text}`);
    return true;
  }
}
