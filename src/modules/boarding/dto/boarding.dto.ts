import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsISO8601, IsNotEmpty, IsString, ValidateNested } from 'class-validator';

export class ScanDto {
  @IsString() @IsNotEmpty()
  qrToken: string;
}

export class OfflineScanItemDto {
  @IsString() @IsNotEmpty()
  qrToken: string;

  @IsISO8601()
  scannedAt: string;
}

export class SyncOfflineDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OfflineScanItemDto)
  scans: OfflineScanItemDto[];
}
