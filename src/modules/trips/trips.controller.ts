import { Controller, Get, Query } from '@nestjs/common';
import { TripsService } from './trips.service';
import { Public } from '../auth/jwt-auth.guard';

@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  /** Recherche publique des départs (pas besoin de compte pour consulter). */
  @Public()
  @Get('search')
  search(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('date') date: string,
  ) {
    return this.trips.search(from, to, date);
  }
}
