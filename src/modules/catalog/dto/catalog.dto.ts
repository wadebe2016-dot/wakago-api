import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsISO8601, IsNotEmpty,
  IsOptional, IsString, Matches, Max, Min, ValidateNested,
} from 'class-validator';

// ---- Villes (référentiel partagé entre agences) ----
export class CreateCityDto {
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() region?: string;
}

// ---- Points d'embarquement ----
export class CreateBoardingPointDto {
  @IsString() @IsNotEmpty() cityId: string;
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() address?: string;
}
export class UpdateBoardingPointDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() address?: string;
}

// ---- Lignes ----
export class CreateRouteDto {
  @IsString() @IsNotEmpty() originCityId: string;
  @IsString() @IsNotEmpty() destinationCityId: string;
}
export class UpdateRouteDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---- Grille horaire ----
export class CreateScheduleDto {
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Heure attendue au format HH:mm' })
  departureTime: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7)
  @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true })
  daysOfWeek: number[]; // 1 = lundi ... 7 = dimanche

  @IsInt() @Min(0) priceFcfa: number;
}
export class UpdateScheduleDto {
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) departureTime?: string;
  @IsOptional() @IsArray() @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) daysOfWeek?: number[];
  @IsOptional() @IsInt() @Min(0) priceFcfa?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---- Plans de sièges ----
export class SeatRowDto {
  @IsInt() @Min(1) row: number;
  @IsArray() seats: (string | null)[]; // null = allée
}
export class CreateSeatMapDto {
  @IsString() @IsNotEmpty() name: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SeatRowDto)
  layout: SeatRowDto[];
}

// ---- Bus ----
export class CreateBusDto {
  @IsString() @IsNotEmpty() plateNumber: string;
  @IsString() @IsNotEmpty() seatMapId: string;
}
export class UpdateBusDto {
  @IsOptional() @IsString() @IsNotEmpty() plateNumber?: string;
  @IsOptional() @IsString() @IsNotEmpty() seatMapId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---- Départs ----
export class GenerateTripsDto {
  @IsISO8601() fromDate: string; // YYYY-MM-DD
  @IsISO8601() toDate: string;   // YYYY-MM-DD (max 60 jours)
  @IsString() @IsNotEmpty() boardingPointId: string;
  @IsOptional() @IsString() busId?: string;
}
export class CreateTripDto {
  @IsString() @IsNotEmpty() routeId: string;
  @IsString() @IsNotEmpty() boardingPointId: string;
  @IsOptional() @IsString() busId?: string;
  @IsISO8601() departureAt: string;
  @IsInt() @Min(0) priceFcfa: number;
}
export class UpdateTripDto {
  @IsOptional() @IsString() busId?: string;
  @IsOptional() @IsISO8601() departureAt?: string;
  @IsOptional() @IsInt() @Min(0) priceFcfa?: number;
}
