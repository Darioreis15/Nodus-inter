import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors();

  // Log toda requisicao que chega -- ajuda a ver nos logs do Render se um
  // webhook (Evolution/Meta) ou uma chamada do Postman esta de fato batendo
  // no servidor.
  app.use((req: any, _res: any, next: () => void) => {
    // eslint-disable-next-line no-console
    console.log(`[REQUEST] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
    next();
  });

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Nodus WhatsApp SaaS API rodando na porta ${port}`);
}
bootstrap();
