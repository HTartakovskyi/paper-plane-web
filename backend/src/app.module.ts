import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from './throttling.js';
import { integerSetting } from './config.js';

@Module({
  imports: [PrismaModule, SessionsModule, ThrottlerModule.forRootAsync({
    useFactory: () => ({
      throttlers: [{ ttl: 60000, limit: integerSetting(process.env, 'API_RATE_LIMIT', 60, 1000) }],
      // Shared budget across routes within one process. Never trust client X-Forwarded-For.
      generateKey: (_context, tracker, name) => `${name}:${tracker}`,
    }),
  })],
  controllers: [AppController],
  providers: [AppService, ThrottlerGuard, { provide: APP_GUARD, useExisting: ThrottlerGuard }],
})
export class AppModule {}
