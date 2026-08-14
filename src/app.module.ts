import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { TripsModule } from './modules/trips/trips.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    TripsModule,
    BookingsModule,
    PaymentsModule,
    // À venir : AuthModule, AgenciesModule, CatalogModule, FleetModule,
    // PaymentsModule, BoardingModule, PayoutsModule
  ],
})
export class AppModule {}
