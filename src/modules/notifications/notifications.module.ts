import { Global, Module } from '@nestjs/common';
import { NotificationsService } from '../subscriptions/notifications.service';

/** Module global : NotificationsService injectable partout (auth, paiements, abonnements). */
@Global()
@Module({ providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
