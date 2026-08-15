import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles } from '../../common/auth.guard';

@Controller()
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /** Plan de sièges d'un départ (FREE / HELD / TAKEN) — public. */
  @Get('trips/:tripId/seats')
  seatMap(@Param('tripId') tripId: string) {
    return this.bookings.seatMap(tripId);
  }

  /**
   * Bloque un siège 10 min. Authentifié :
   * - voyageur (app) : channel forcé APP, travelerId pris du token
   * - guichetier : channel forcé COUNTER, cashierId pris du token
   */
  @Post('bookings/hold')
  @UseGuards(JwtAuthGuard)
  @Roles('TRAVELER', 'CASHIER', 'MANAGER', 'OWNER')
  hold(@Body() dto: CreateBookingDto, @CurrentUser() user: AuthUser) {
    if (user.role === 'TRAVELER') {
      dto.channel = 'APP';
      dto.travelerId = user.sub;
      dto.cashierId = undefined;
    } else {
      dto.channel = 'COUNTER';
      dto.cashierId = user.sub;
      dto.travelerId = undefined;
    }
    return this.bookings.holdSeat(dto);
  }
}
