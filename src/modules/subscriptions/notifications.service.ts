import { Injectable, Logger } from '@nestjs/common';

export type Channel = 'SMS' | 'WHATSAPP';

/**
 * Passerelles de notification : SMS et WhatsApp.
 * Fournisseurs branchés par variables d'environnement ; tant qu'aucune clé n'est
 * renseignée, les messages sont journalisés (mode développement).
 *
 *  SMS_PROVIDER      = log | twilio | http   (twilio : même compte que WhatsApp ;
 *                                             http : passerelle générique POST JSON)
 *  SMS_HTTP_URL, SMS_HTTP_KEY, SMS_SENDER, TWILIO_SMS_FROM
 *  WA_PROVIDER       = log | twilio | meta   (twilio : recommandé — compte Atlastech existant)
 *  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (ex. whatsapp:+14155238886)
 *  WA_PHONE_ID, WA_TOKEN, WA_TEMPLATE_OTP, WA_TEMPLATE_TICKET, WA_LANG (meta uniquement)
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notifications');

  private get smsProvider() { return process.env.SMS_PROVIDER ?? 'log'; }
  private get waProvider() { return process.env.WA_PROVIDER ?? 'log'; }

  /** Numéro camerounais 6XXXXXXXX → format international 2376XXXXXXXX */
  static intl(phone: string) { return phone.startsWith('237') ? phone : `237${phone}`; }

  /** Envoi via l'API REST Twilio (Messages). `from` : "whatsapp:+1..." ou "+1..." pour SMS. */
  private async twilio(to: string, from: string, body: string): Promise<boolean> {
    const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) { this.log.error('Twilio non configuré (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)'); return false; }
    try {
      const params = new URLSearchParams({ To: to, From: from, Body: body });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      if (!res.ok) this.log.error(`Twilio ${to} : HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      return res.ok;
    } catch (e) { this.log.error(`Twilio ${to} : ${(e as Error).message}`); return false; }
  }

  async send(channel: Channel, phone: string, text: string, opts?: { template?: 'otp' | 'ticket'; params?: string[] }) {
    return channel === 'WHATSAPP' ? this.sendWhatsApp(phone, text, opts) : this.sendSms(phone, text);
  }

  async sendSms(phone: string, text: string): Promise<boolean> {
    if (this.smsProvider === 'twilio') {
      return this.twilio(`+${NotificationsService.intl(phone)}`, process.env.TWILIO_SMS_FROM ?? '', text);
    }
    if (this.smsProvider === 'http' && process.env.SMS_HTTP_URL) {
      try {
        const res = await fetch(process.env.SMS_HTTP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SMS_HTTP_KEY ?? ''}` },
          body: JSON.stringify({ to: NotificationsService.intl(phone), from: process.env.SMS_SENDER ?? 'Wakago', message: text }),
        });
        if (!res.ok) this.log.error(`SMS ${phone} : HTTP ${res.status}`);
        return res.ok;
      } catch (e) { this.log.error(`SMS ${phone} : ${(e as Error).message}`); return false; }
    }
    this.log.log(`[SMS stub] → ${phone} : ${text}`);
    return true;
  }

  async sendWhatsApp(phone: string, text: string, opts?: { template?: 'otp' | 'ticket'; params?: string[] }): Promise<boolean> {
    if (this.waProvider === 'twilio') {
      const from = process.env.TWILIO_WHATSAPP_FROM ?? '';
      return this.twilio(`whatsapp:+${NotificationsService.intl(phone)}`, from.startsWith('whatsapp:') ? from : `whatsapp:${from}`, text);
    }
    if (this.waProvider === 'meta' && process.env.WA_PHONE_ID && process.env.WA_TOKEN) {
      try {
        // Meta exige un modèle approuvé pour les messages sortants hors fenêtre de 24 h.
        const tpl = opts?.template === 'ticket' ? process.env.WA_TEMPLATE_TICKET : process.env.WA_TEMPLATE_OTP;
        const body: any = tpl
          ? { messaging_product: 'whatsapp', to: NotificationsService.intl(phone), type: 'template',
              template: { name: tpl, language: { code: process.env.WA_LANG ?? 'fr' },
                components: [{ type: 'body', parameters: (opts?.params ?? [text]).map((p) => ({ type: 'text', text: p })) }] } }
          : { messaging_product: 'whatsapp', to: NotificationsService.intl(phone), type: 'text', text: { body: text } };
        const res = await fetch(`https://graph.facebook.com/v20.0/${process.env.WA_PHONE_ID}/messages`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WA_TOKEN}` }, body: JSON.stringify(body),
        });
        if (!res.ok) this.log.error(`WhatsApp ${phone} : HTTP ${res.status} ${await res.text()}`);
        return res.ok;
      } catch (e) { this.log.error(`WhatsApp ${phone} : ${(e as Error).message}`); return false; }
    }
    this.log.log(`[WhatsApp stub] → ${phone} : ${text}`);
    return true;
  }

  async sendEmail(to: string, subject: string, text: string): Promise<boolean> {
    this.log.log(`[EMAIL stub] → ${to} | ${subject} : ${text}`);
    return true;
  }
}
