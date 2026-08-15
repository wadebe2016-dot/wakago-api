import { IsIn, IsInt, IsNotEmpty, IsString, Matches, Max, Min } from 'class-validator';

export class SubscribeDto {
  @IsString() @IsNotEmpty()
  planCode: string;
}

export class PaySubscriptionDto {
  @IsString() @IsNotEmpty()
  subscriptionId: string;

  @IsIn(['MTN_MOMO', 'ORANGE_MONEY'])
  provider: 'MTN_MOMO' | 'ORANGE_MONEY';

  @Matches(/^6\d{8}$/, { message: 'Numéro camerounais attendu : 6XXXXXXXX' })
  payerPhone: string;
}

export class ExtensionDto {
  @IsInt() @Min(1) @Max(60)
  extraDays: number;
}
