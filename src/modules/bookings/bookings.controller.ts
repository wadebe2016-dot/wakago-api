import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CurrentUser, Public, Roles } from '../auth/jwt-auth.guard';
import { JwtUser } from '../auth/auth.service';

@Controller()
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /** Plan de sièges d'un départ — public (consultation avant connexion). */
  @Public()
  @Get('trips/:tripId/seats')
  seatMap(@Param('tripId') tripId: string) {
    return this.bookings.seatMap(tripId);
  }

  /**
   * Bloque un siège : voyageur connecté (app) ou guichetier/gestionnaire (comptoir).
   * Le travelerId provient du jeton, jamais du corps de la requête.
   */
  @Roles('traveler', 'CASHIER', 'MANAGER', 'OWNER')
  @Post('bookings/hold')
  hold(@Body() dto: CreateBookingDto, @CurrentUser() user: JwtUser) {
    return this.bookings.holdSeat(dto, user);
  }
}
