import { IsIn, IsNotEmpty, IsString, Matches } from 'class-validator';

export class InitiatePaymentDto {
  @IsString() @IsNotEmpty()
  bookingId: string;

  @IsIn(['MTN_MOMO', 'ORANGE_MONEY'])
  provider: 'MTN_MOMO' | 'ORANGE_MONEY';

  @Matches(/^6\d{8}$/, { message: 'Numéro camerounais attendu : 6XXXXXXXX' })
  payerPhone: string;
}
