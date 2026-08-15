import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './jwt-auth.guard';
import { AgencyLoginDto, PlatformLoginDto, RequestOtpDto, VerifyOtpDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Voyageur — étape 1 : demander un code OTP par SMS. */
  @Public()
  @Post('otp/request')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone, dto.channel ?? 'SMS');
  }

  /** Voyageur — étape 2 : vérifier le code et recevoir le JWT. */
  @Public()
  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.code);
  }

  /** Personnel d'agence : connexion téléphone + mot de passe. */
  @Public()
  @Post('agency/login')
  agencyLogin(@Body() dto: AgencyLoginDto) {
    return this.auth.agencyLogin(dto.agencySlug, dto.phone, dto.password);
  }

  /** Administrateur plateforme (Atlastech) : email + mot de passe. */
  @Public()
  @Post('platform/login')
  platformLogin(@Body() dto: PlatformLoginDto) {
    return this.auth.platformLogin(dto.email, dto.password);
  }
}
