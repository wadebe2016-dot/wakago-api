import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';

@Controller()
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  /** Plan de sièges d'un départ (FREE / HELD / TAKEN). */
  @Get('trips/:tripId/seats')
  seatMap(@Param('tripId') tripId: string) {
    return this.bookings.seatMap(tripId);
  }

  /** Bloque un siège 10 min et crée la réservation en attente de paiement. */
  @Post('bookings/hold')
  hold(@Body() dto: CreateBookingDto) {
    return this.bookings.holdSeat(dto);
  }
}
