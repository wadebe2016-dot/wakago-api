import { Controller, Get, Query } from '@nestjs/common';
import { TripsService } from './trips.service';

@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  /**
   * Recherche voyageur : GET /api/v1/trips/search?from=<cityId>&to=<cityId>&date=YYYY-MM-DD
   * Retourne les départs de toutes les agences actives, triés par heure,
   * avec le nombre de places restantes.
   */
  @Get('search')
  search(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('date') date: string,
  ) {
    return this.trips.search(from, to, date);
  }
}
