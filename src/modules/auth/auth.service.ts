import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';

const OTP_TTL_SECONDS = 300; // 5 minutes
const OTP_MAX_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  private readonly redis: Redis;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {
    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  }

  // ------------------------- Voyageur (OTP SMS) -------------------------

  /**
   * Génère un code à 6 chiffres, le stocke dans Redis (TTL 5 min) et
   * l'envoie par SMS. Tant que la passerelle SMS n'est pas contractualisée,
   * le code est journalisé côté serveur ; hors production il est aussi
   * renvoyé dans la réponse (devCode) pour faciliter les tests.
   */
  async requestOtp(phone: string) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.redis.set(`otp:${phone}`, code, 'EX', OTP_TTL_SECONDS);
    await this.redis.set(`otp:${phone}:attempts`, '0', 'EX', OTP_TTL_SECONDS);

    // TODO passerelle SMS réelle : envoyer `Votre code Wakago : ${code}`
    this.logger.log(`OTP pour ${phone} : ${code}`);

    const isProd = process.env.NODE_ENV === 'production';
    return {
      message: 'Code envoyé par SMS',
      expiresInSeconds: OTP_TTL_SECONDS,
      ...(isProd ? {} : { devCode: code }),
    };
  }

  /** Vérifie le code, crée le voyageur si besoin, retourne un JWT. */
  async verifyOtp(phone: string, code: string) {
    const key = `otp:${phone}`;
    const stored = await this.redis.get(key);
    if (!stored)
      throw new UnauthorizedException('Code expiré ou jamais demandé');

    const attempts = await this.redis.incr(`${key}:attempts`);
    if (attempts > OTP_MAX_ATTEMPTS) {
      await this.redis.del(key);
      throw new UnauthorizedException('Trop de tentatives, redemandez un code');
    }
    if (stored !== code) throw new UnauthorizedException('Code incorrect');

    await this.redis.del(key, `${key}:attempts`);

    const traveler = await this.prisma.traveler.upsert({
      where: { phone },
      update: {},
      create: { phone },
    });

    const token = await this.jwt.signAsync(
      { sub: traveler.id, role: 'TRAVELER', phone },
      { expiresIn: '30d' },
    );
    return {
      token,
      traveler: { id: traveler.id, phone: traveler.phone, fullName: traveler.fullName },
    };
  }

  // ---------------------- Comptes agence (password) ---------------------

  /** Login d'un utilisateur agence (gestionnaire, guichetier, contrôleur). */
  async agencyLogin(agencySlug: string, phone: string, password: string) {
    const agency = await this.prisma.agency.findUnique({ where: { slug: agencySlug } });
    if (!agency) throw new UnauthorizedException('Identifiants invalides');
    if (agency.status !== 'ACTIVE')
      throw new UnauthorizedException('Agence inactive ou suspendue');

    const user = await this.prisma.agencyUser.findUnique({
      where: { agencyId_phone: { agencyId: agency.id, phone } },
    });
    if (!user || !user.isActive)
      throw new UnauthorizedException('Identifiants invalides');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Identifiants invalides');

    const token = await this.jwt.signAsync(
      { sub: user.id, role: user.role, agencyId: agency.id, phone },
      { expiresIn: '12h' },
    );
    return {
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        agency: { id: agency.id, name: agency.name, slug: agency.slug },
      },
    };
  }

  /** Utilitaire pour le seed et la création de comptes : hash bcrypt. */
  static async hashPassword(plain: string) {
    if (plain.length < 8)
      throw new BadRequestException('Mot de passe : 8 caractères minimum');
    return bcrypt.hash(plain, 10);
  }
}
