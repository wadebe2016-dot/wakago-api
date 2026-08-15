import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AgencyLoginDto, RequestOtpDto, VerifyOtpDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Voyageur — étape 1 : demander un code SMS. */
  @Post('otp/request')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  /** Voyageur — étape 2 : vérifier le code, obtenir le token. */
  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.code);
  }

  /** Comptes agence : gestionnaire, guichetier, contrôleur. */
  @Post('agency/login')
  agencyLogin(@Body() dto: AgencyLoginDto) {
    return this.auth.agencyLogin(dto.agencySlug, dto.phone, dto.password);
  }
}
