import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Origines autorisées (back-office web, dev local). Les apps mobiles ne sont pas soumises au CORS.
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3100')
    .split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin: origins, credentials: false });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
