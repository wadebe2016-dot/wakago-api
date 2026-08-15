import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AdminService } from './admin.service';
import { Roles } from '../auth/jwt-auth.guard';
import { AgencyStatusDto, CreateAgencyDto, ExtensionDto, ManualActivationDto, UpsertPlanDto } from './dto/admin.dto';

/** Administration de la plateforme — rôle 'platform' (Atlastech) uniquement. */
@Controller('admin')
@Roles('platform')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard')
  dashboard() { return this.admin.dashboard(); }

  // Agences
  @Get('agencies')
  agencies(@Query('status') status?: string) { return this.admin.listAgencies(status); }
  @Get('agencies/:id')
  agency(@Param('id') id: string) { return this.admin.getAgency(id); }
  @Post('agencies')
  createAgency(@Body() dto: CreateAgencyDto) { return this.admin.createAgency(dto); }
  @Patch('agencies/:id/status')
  agencyStatus(@Param('id') id: string, @Body() dto: AgencyStatusDto) { return this.admin.setAgencyStatus(id, dto.status); }
  @Post('agency-users/:id/reset-password')
  resetPassword(@Param('id') id: string) { return this.admin.resetAgencyUserPassword(id); }

  // Plans
  @Get('plans')
  plans() { return this.admin.listPlans(); }
  @Post('plans')
  upsertPlan(@Body() dto: UpsertPlanDto) { return this.admin.upsertPlan(dto); }

  // Abonnements
  @Get('subscriptions')
  subscriptions(@Query('status') status?: string) { return this.admin.listSubscriptions(status); }
  @Post('subscriptions/:id/extension')
  extension(@Param('id') id: string, @Body() dto: ExtensionDto) { return this.admin.grantExtension(id, dto.extraDays); }
  @Post('subscriptions/:id/activate-manually')
  activate(@Param('id') id: string, @Body() dto: ManualActivationDto) { return this.admin.activateManually(id, dto.reference); }
  @Post('subscriptions/lifecycle/run')
  lifecycle() { return this.admin.runLifecycle(); }
}
