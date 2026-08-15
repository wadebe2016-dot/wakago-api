import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { TripsModule } from './modules/trips/trips.module';
import { BoardingModule } from './modules/boarding/boarding.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { CatalogModule } from './modules/catalog/catalog.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    TripsModule,
    BookingsModule,
    PaymentsModule,
    BoardingModule,
    SubscriptionsModule,
    CatalogModule,
    // À venir : AgenciesModule (admin plateforme)
  ],
})
export class AppModule {}
