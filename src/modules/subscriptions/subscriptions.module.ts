import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService, SUBSCRIPTION_PAYMENT_PROVIDER } from './subscriptions.service';
import { NotificationsService } from './notifications.service';
import { SandboxPaymentProvider } from '../payments/payment-provider';

@Module({
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsService,
    NotificationsService,
    {
      // Compte Campay ATLASTECH (abonnements). Bascule : remplacer par CampayPaymentProvider.
      provide: SUBSCRIPTION_PAYMENT_PROVIDER,
      useFactory: () => new SandboxPaymentProvider(),
    },
  ],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
