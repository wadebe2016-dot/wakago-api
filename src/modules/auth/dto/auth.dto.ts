import { IsNotEmpty, IsString, Length, Matches, MinLength } from 'class-validator';

const PHONE_RULE = /^6\d{8}$/;
const PHONE_MSG = 'Numéro camerounais attendu : 6XXXXXXXX';

export class RequestOtpDto {
  @Matches(PHONE_RULE, { message: PHONE_MSG })
  phone: string;
}

export class VerifyOtpDto {
  @Matches(PHONE_RULE, { message: PHONE_MSG })
  phone: string;

  @IsString() @Length(6, 6, { message: 'Code à 6 chiffres attendu' })
  code: string;
}

export class AgencyLoginDto {
  /** Identifiant public de l'agence (ex. express-littoral). */
  @IsString() @IsNotEmpty()
  agencySlug: string;

  @Matches(PHONE_RULE, { message: PHONE_MSG })
  phone: string;

  @IsString() @MinLength(8)
  password: string;
}
