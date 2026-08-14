import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService, PAYMENT_PROVIDER } from './payments.service';
import { SandboxPaymentProvider } from './payment-provider';

@Module({
  imports: [BookingsModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_PROVIDER,
      // Un seul point de bascule quand l'agrégateur réel sera contractualisé :
      useFactory: () => new SandboxPaymentProvider(),
    },
  ],
})
export class PaymentsModule {}
