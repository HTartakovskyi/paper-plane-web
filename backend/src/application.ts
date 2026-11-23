import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

export function configureApplication(app: NestExpressApplication): void {
  // Launch requests contain only three scalar fields. Also bounds malformed input.
  app.useBodyParser('json', { limit: '8kb' });
}

export async function createApplication(): Promise<NestExpressApplication> {
  // Do not terminate the Lambda runtime on a recoverable initialization failure.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { abortOnError: false, logger: false });
  try {
    configureApplication(app);
    await app.init();
    return app;
  } catch {
    await app.close().catch(() => undefined);
    throw new Error('Application initialization failed');
  }
}
