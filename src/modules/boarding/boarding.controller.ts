import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BoardingService } from './boarding.service';
import { ScanDto, SyncOfflineDto } from './dto/boarding.dto';
import { CurrentUser, Roles } from '../auth/jwt-auth.guard';
import { JwtUser } from '../auth/auth.service';

/**
 * Embarquement — réservé au personnel d'agence (contrôleur, gestionnaire, gérant).
 * Toutes les routes vérifient que le départ appartient à l'agence du jeton.
 */
@Controller('boarding')
@Roles('CONTROLLER', 'MANAGER', 'OWNER')
export class BoardingController {
  constructor(private readonly boarding: BoardingService) {}

  /** Manifeste (liste des passagers + qrTokens) — aussi utilisé pour le mode hors ligne. */
  @Get('trips/:tripId/manifest')
  manifest(@Param('tripId') tripId: string, @CurrentUser() user: JwtUser) {
    return this.boarding.manifest(tripId, user);
  }

  /** Scan en ligne d'un billet. */
  @Post('trips/:tripId/scan')
  scan(@Param('tripId') tripId: string, @Body() dto: ScanDto, @CurrentUser() user: JwtUser) {
    return this.boarding.scan(dto.qrToken, tripId, user);
  }

  /** Synchronisation des scans effectués hors ligne. */
  @Post('trips/:tripId/sync')
  sync(@Param('tripId') tripId: string, @Body() dto: SyncOfflineDto, @CurrentUser() user: JwtUser) {
    return this.boarding.syncOfflineScans(tripId, dto.scans, user);
  }

  /** Clôture du départ (le bus part). */
  @Post('trips/:tripId/close')
  close(@Param('tripId') tripId: string, @CurrentUser() user: JwtUser) {
    return this.boarding.closeTrip(tripId, user);
  }
}
