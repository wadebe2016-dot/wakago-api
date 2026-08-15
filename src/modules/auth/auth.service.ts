import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService, Channel } from '../subscriptions/notifications.service';

export interface JwtUser {
  sub: string;                 // travelerId, agencyUserId ou platformAdminId
  type: 'traveler' | 'agency' | 'platform';
  agencyId?: string;
  role?: 'OWNER' | 'MANAGER' | 'CASHIER' | 'CONTROLLER';
}

const OTP_TTL_SECONDS = 300;      // code valable 5 min
const OTP_MAX_ATTEMPTS = 5;       // essais de vérification par code
const OTP_REQUEST_COOLDOWN = 60;  // 1 demande de code par minute et par numéro

@Injectable()
export class AuthService {
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly notify: NotificationsService,
  ) {
    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  }

  // ------------------------- VOYAGEUR (OTP) -------------------------

  /** Étape 1 : demande d'un code OTP par SMS ou WhatsApp (au choix du voyageur). */
  async requestOtp(phone: string, channel: Channel = 'SMS') {
    const cooldownKey = `otp:cooldown:${phone}`;
    if (await this.redis.get(cooldownKey))
      throw new BadRequestException('Patientez une minute avant de redemander un code');

    const code = String(randomInt(100000, 999999));
    await this.redis.set(`otp:code:${phone}`, code, 'EX', OTP_TTL_SECONDS);
    await this.redis.set(`otp:tries:${phone}`, '0', 'EX', OTP_TTL_SECONDS);
    await this.redis.set(cooldownKey, '1', 'EX', OTP_REQUEST_COOLDOWN);

    const text = `Wakago : votre code de vérification est ${code}. Valable 5 minutes.`;
    let sent = await this.notify.send(channel, phone, text, { template: 'otp', params: [code] });
    let used: Channel = channel;
    if (!sent && channel === 'WHATSAPP') { sent = await this.notify.sendSms(phone, text); used = 'SMS'; } // repli
    if (!sent) throw new BadRequestException('Envoi du code impossible, réessayez');

    const isProd = process.env.NODE_ENV === 'production';
    return {
      message: used === 'WHATSAPP' ? 'Code envoyé par WhatsApp' : 'Code envoyé par SMS',
      channel: used,
      expiresInSeconds: OTP_TTL_SECONDS,
      // Facilité de dev/test uniquement — jamais exposé en production :
      ...(isProd ? {} : { devCode: code }),
    };
  }

  /** Étape 2 : vérification du code, création du voyageur si besoin, JWT. */
  async verifyOtp(phone: string, code: string) {
    const triesKey = `otp:tries:${phone}`;
    const tries = Number((await this.redis.get(triesKey)) ?? 0);
    if (tries >= OTP_MAX_ATTEMPTS)
      throw new UnauthorizedException('Trop de tentatives, redemandez un code');

    const stored = await this.redis.get(`otp:code:${phone}`);
    if (!stored || stored !== code) {
      await this.redis.incr(triesKey);
      throw new UnauthorizedException('Code invalide ou expiré');
    }

    // Code correct : usage unique
    await this.redis.del(`otp:code:${phone}`, triesKey);

    const traveler = await this.prisma.traveler.upsert({
      where: { phone },
      update: {},
      create: { phone },
    });

    const payload: JwtUser = { sub: traveler.id, type: 'traveler' };
    return {
      accessToken: await this.jwt.signAsync(payload),
      traveler: { id: traveler.id, phone: traveler.phone, fullName: traveler.fullName },
    };
  }

  // --------------------- ADMIN PLATEFORME (email + mot de passe) ---------------------

  async platformLogin(email: string, password: string) {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email: email.toLowerCase() } });
    if (!admin || !admin.isActive || !(await bcrypt.compare(password, admin.passwordHash)))
      throw new UnauthorizedException('Identifiants invalides');
    const payload: JwtUser = { sub: admin.id, type: 'platform' };
    return {
      accessToken: await this.jwt.signAsync(payload, { expiresIn: '12h' }),
      admin: { id: admin.id, email: admin.email, fullName: admin.fullName },
    };
  }

  // ------------------------- AGENCE (mot de passe) -------------------------

  async agencyLogin(agencySlug: string, phone: string, password: string) {
    const user = await this.prisma.agencyUser.findFirst({
      where: { phone, isActive: true, agency: { slug: agencySlug } },
      include: { agency: { select: { id: true, name: true, status: true } } },
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
      throw new UnauthorizedException('Identifiants invalides');
    if (user.agency.status !== 'ACTIVE')
      throw new UnauthorizedException('Agence inactive ou suspendue');

    const payload: JwtUser = {
      sub: user.id,
      type: 'agency',
      agencyId: user.agencyId,
      role: user.role,
    };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: {
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        agency: { id: user.agency.id, name: user.agency.name },
      },
    };
  }
}
