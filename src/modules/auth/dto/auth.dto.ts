import { IsNotEmpty, IsString, Length, Matches, MinLength } from 'class-validator';

export class RequestOtpDto {
  @Matches(/^6\d{8}$/, { message: 'Numéro camerounais attendu : 6XXXXXXXX' })
  phone: string;
}

export class VerifyOtpDto {
  @Matches(/^6\d{8}$/, { message: 'Numéro camerounais attendu : 6XXXXXXXX' })
  phone: string;

  @Length(6, 6, { message: 'Code à 6 chiffres attendu' })
  code: string;
}

export class AgencyLoginDto {
  @IsString() @IsNotEmpty()
  agencySlug: string;

  @Matches(/^6\d{8}$/, { message: 'Numéro camerounais attendu : 6XXXXXXXX' })
  phone: string;

  @IsString() @MinLength(8)
  password: string;
}
