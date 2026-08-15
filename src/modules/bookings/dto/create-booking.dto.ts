import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export const ID_TYPES = ['CNI', 'RECEPISSE', 'PASSEPORT', 'CARTE_SEJOUR', 'AUTRE'] as const;

export class CreateBookingDto {
  @IsString() @IsNotEmpty()
  tripId: string;

  @IsString() @IsNotEmpty()
  seatNumber: string;

  /** Imposé côté serveur selon le rôle du token (APP ou COUNTER). */
  @IsOptional() @IsIn(['APP', 'COUNTER'])
  channel?: 'APP' | 'COUNTER';

  @IsString() @IsNotEmpty()
  passengerName: string;

  @IsString() @IsNotEmpty()
  passengerPhone: string;

  @IsOptional() @IsIn(['SMS', 'WHATSAPP'])
  ticketChannel?: 'SMS' | 'WHATSAPP';

  @IsOptional() @IsIn(ID_TYPES as any)
  passengerIdType?: (typeof ID_TYPES)[number];

  @IsOptional() @IsString()
  passengerIdNumber?: string;

  /** Renseignés par le serveur depuis le token — jamais par le client. */
  travelerId?: string;
  cashierId?: string;
}
