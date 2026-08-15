import { IsBoolean, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const PHONE_RULE = /^6\d{8}$/;

export class CreateAgencyDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() slug: string;
  @Matches(PHONE_RULE) phone: string;
  @IsOptional() @IsEmail() email?: string;
  @IsString() @IsNotEmpty() ownerName: string;
  @Matches(PHONE_RULE) ownerPhone: string;
}

export class AgencyStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'PENDING']) status: 'ACTIVE' | 'SUSPENDED' | 'PENDING';
}

export class UpsertPlanDto {
  @IsString() @IsNotEmpty() code: string;
  @IsString() @IsNotEmpty() name: string;
  @IsIn(['MONTHLY', 'QUARTERLY', 'YEARLY']) period: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  @IsInt() @Min(0) priceFcfa: number;
  @IsOptional() @IsInt() @Min(1) maxBuses?: number | null;
  @IsOptional() @IsInt() @Min(1) maxRoutes?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(365) trialDays?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class ExtensionDto {
  @IsInt() @Min(1) @Max(60) extraDays: number;
}

export class ManualActivationDto {
  @IsString() @IsNotEmpty() reference: string; // ex. numéro de virement / reçu
}
