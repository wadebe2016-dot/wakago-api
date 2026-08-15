import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CurrentUser, Public, Roles } from '../auth/jwt-auth.guard';
import { JwtUser } from '../auth/auth.service';
import {
  CreateBoardingPointDto, CreateBusDto, CreateCityDto, CreateRouteDto, CreateScheduleDto,
  CreateSeatMapDto, CreateTripDto, GenerateTripsDto, UpdateBoardingPointDto, UpdateBusDto,
  UpdateRouteDto, UpdateScheduleDto, UpdateTripDto,
} from './dto/catalog.dto';

/** Back-office agence : paramétrage du réseau, de la flotte et des départs. */
@Controller('agency')
@Roles('OWNER', 'MANAGER')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // Villes (référentiel partagé) — lecture publique (utile à l'app voyageur)
  @Public() @Get('cities')
  cities(@Query('q') q?: string) { return this.catalog.listCities(q); }
  @Post('cities')
  createCity(@Body() dto: CreateCityDto) { return this.catalog.createCity(dto); }

  // Points d'embarquement
  @Get('boarding-points')
  boardingPoints(@CurrentUser() u: JwtUser) { return this.catalog.listBoardingPoints(u); }
  @Post('boarding-points')
  createBoardingPoint(@Body() dto: CreateBoardingPointDto, @CurrentUser() u: JwtUser) { return this.catalog.createBoardingPoint(dto, u); }
  @Patch('boarding-points/:id')
  updateBoardingPoint(@Param('id') id: string, @Body() dto: UpdateBoardingPointDto, @CurrentUser() u: JwtUser) { return this.catalog.updateBoardingPoint(id, dto, u); }

  // Lignes
  @Get('routes')
  routes(@CurrentUser() u: JwtUser) { return this.catalog.listRoutes(u); }
  @Post('routes')
  createRoute(@Body() dto: CreateRouteDto, @CurrentUser() u: JwtUser) { return this.catalog.createRoute(dto, u); }
  @Patch('routes/:id')
  updateRoute(@Param('id') id: string, @Body() dto: UpdateRouteDto, @CurrentUser() u: JwtUser) { return this.catalog.updateRoute(id, dto, u); }

  // Grille horaire
  @Get('routes/:routeId/schedules')
  schedules(@Param('routeId') routeId: string, @CurrentUser() u: JwtUser) { return this.catalog.listSchedules(routeId, u); }
  @Post('routes/:routeId/schedules')
  createSchedule(@Param('routeId') routeId: string, @Body() dto: CreateScheduleDto, @CurrentUser() u: JwtUser) { return this.catalog.createSchedule(routeId, dto, u); }
  @Patch('schedules/:id')
  updateSchedule(@Param('id') id: string, @Body() dto: UpdateScheduleDto, @CurrentUser() u: JwtUser) { return this.catalog.updateSchedule(id, dto, u); }

  // Génération des départs à partir de la grille
  @Post('routes/:routeId/generate-trips')
  generateTrips(@Param('routeId') routeId: string, @Body() dto: GenerateTripsDto, @CurrentUser() u: JwtUser) { return this.catalog.generateTrips(routeId, dto, u); }

  // Plans de sièges
  @Get('seat-maps')
  seatMaps(@CurrentUser() u: JwtUser) { return this.catalog.listSeatMaps(u); }
  @Post('seat-maps')
  createSeatMap(@Body() dto: CreateSeatMapDto, @CurrentUser() u: JwtUser) { return this.catalog.createSeatMap(dto, u); }

  // Bus
  @Get('buses')
  buses(@CurrentUser() u: JwtUser) { return this.catalog.listBuses(u); }
  @Post('buses')
  createBus(@Body() dto: CreateBusDto, @CurrentUser() u: JwtUser) { return this.catalog.createBus(dto, u); }
  @Patch('buses/:id')
  updateBus(@Param('id') id: string, @Body() dto: UpdateBusDto, @CurrentUser() u: JwtUser) { return this.catalog.updateBus(id, dto, u); }

  // Départs
  @Get('trips')
  trips(@CurrentUser() u: JwtUser, @Query('from') from?: string, @Query('to') to?: string) { return this.catalog.listTrips(u, from, to); }
  @Post('trips')
  createTrip(@Body() dto: CreateTripDto, @CurrentUser() u: JwtUser) { return this.catalog.createTrip(dto, u); }
  @Patch('trips/:id')
  updateTrip(@Param('id') id: string, @Body() dto: UpdateTripDto, @CurrentUser() u: JwtUser) { return this.catalog.updateTrip(id, dto, u); }
  @Delete('trips/:id')
  cancelTrip(@Param('id') id: string, @CurrentUser() u: JwtUser) { return this.catalog.cancelTrip(id, u); }
}
