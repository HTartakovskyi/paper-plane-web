
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';

import { PrismaClient } from '../../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { connectionConfig } from './connection-config.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const { pool, schema } = connectionConfig();
    const adapter = new PrismaPg(pool, { schema });

    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch {
      // Do not expose driver diagnostics or connection settings.
      throw new Error('PostgreSQL connection failed');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
