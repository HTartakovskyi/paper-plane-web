
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';

import { PrismaClient } from '../../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL is not configured');
    }

    let schema: string;
    try {
      schema = new URL(connectionString).searchParams.get('schema') ?? 'public';
    } catch {
      throw new Error('DATABASE_URL is invalid');
    }
    const adapter = new PrismaPg({
      connectionString,
      connectionTimeoutMillis: 3000,
    }, { schema });

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
