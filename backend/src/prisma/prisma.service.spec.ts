import { PrismaService } from './prisma.service.js';

describe('Prisma lifecycle without database access', () => {
  let service: PrismaService;
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test');
    service = new PrismaService();
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  it('connects on initialization and disconnects on app close', async () => {
    const connect = vi.spyOn(service, '$connect').mockResolvedValue();
    const disconnect = vi.spyOn(service, '$disconnect').mockResolvedValue();
    await service.onModuleInit();
    await service.onModuleDestroy();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
  it('does not expose connection errors', async () => {
    vi.spyOn(service, '$connect').mockRejectedValue(new Error('PRIVATE_PASSWORD'));
    await expect(service.onModuleInit()).rejects.toThrow('PostgreSQL connection failed');
  });
});
