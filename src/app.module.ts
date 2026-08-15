import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { TripsModule } from './modules/trips/trips.module';
import { BoardingModule } from './modules/boarding/boarding.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { AdminModule } from './modules/admin/admin.module';
import { JobsModule } from './modules/jobs/jobs.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    NotificationsModule,
    AuthModule,
    TripsModule,
    BookingsModule,
    PaymentsModule,
    BoardingModule,
    SubscriptionsModule,
    CatalogModule,
    AdminModule,
    JobsModule,
  ],
})
export class AppModule {}
