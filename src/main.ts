import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Validation automatique des données entrantes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // ignore les champs non déclarés
      forbidNonWhitelisted: true, // rejette les champs inconnus
      transform: true, // convertit les types automatiquement
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
