import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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

  @IsOptional() @IsString()
  passengerIdNumber?: string;

  /** Renseignés par le serveur depuis le token — jamais par le client. */
  travelerId?: string;
  cashierId?: string;
}
