import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateBookingDto {
  @IsString() @IsNotEmpty()
  tripId: string;

  @IsString() @IsNotEmpty()
  seatNumber: string;

  @IsIn(['APP', 'COUNTER'])
  channel: 'APP' | 'COUNTER';

  @IsString() @IsNotEmpty()
  passengerName: string;

  @IsString() @IsNotEmpty()
  passengerPhone: string;

  @IsOptional() @IsString()
  passengerIdNumber?: string;

  @IsOptional() @IsString()
  travelerId?: string;
}
