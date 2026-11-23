import { createApplication } from './application.js';
import { integerSetting } from './config.js';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

if (existsSync('.env')) loadEnvFile('.env');

async function bootstrap() {
  const app = await createApplication();
  app.enableShutdownHooks();
  await app.listen(integerSetting(process.env, 'PORT', 3000, 65535));
}
await bootstrap();
