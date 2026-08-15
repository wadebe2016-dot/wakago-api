import { Module } from '@nestjs/common';
import { BoardingController } from './boarding.controller';
import { BoardingService } from './boarding.service';

@Module({ controllers: [BoardingController], providers: [BoardingService] })
export class BoardingModule {}
