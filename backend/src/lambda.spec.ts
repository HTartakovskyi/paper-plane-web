import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { simulateFlight } from '@paper-plane/game-math';
import { AppModule } from './app.module.js';
import { configureApplication } from './application.js';
import { PrismaService } from './prisma/prisma.service.js';
import { createLambdaHandler, type HttpApiEvent } from './lambda.js';

const sessionId = randomUUID();
const input = { planeId: 'BasicPlane' as const, angle: 30, speed: 14 };
function event(method: string, path: string, body?: string, ip = '192.0.2.1'): HttpApiEvent {
  return {
    version: '2.0', rawPath: path, rawQueryString: '',
    headers: { 'content-type': 'application/json' }, body, isBase64Encoded: false,
    requestContext: { requestId: randomUUID(), http: { method, path, sourceIp: ip } },
  };
}

describe('HTTP API Lambda and local HTTP with isolated Prisma mocks', () => {
  let app: NestExpressApplication;
  let invoke: ReturnType<typeof createLambdaHandler>;
  let factory: ReturnType<typeof vi.fn<() => Promise<NestExpressApplication>>>;
  const db = {
    gameSession: { create: vi.fn(), findUnique: vi.fn() },
    flightAttempt: { create: vi.fn(), findMany: vi.fn() },
  };
  beforeEach(async () => {
    vi.stubEnv('API_RATE_LIMIT', '60');
    db.gameSession.create.mockReset().mockResolvedValue({ id: sessionId });
    db.gameSession.findUnique.mockReset().mockResolvedValue({ id: sessionId });
    db.flightAttempt.create.mockReset().mockImplementation(async ({ data }) => ({
      ...data, id: randomUUID(), createdAt: new Date('2026-01-01T00:00:00Z'),
    }));
    db.flightAttempt.findMany.mockReset().mockResolvedValue([]);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(db).compile();
    app = module.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    await app.init();
    factory = vi.fn(async () => app);
    invoke = createLambdaHandler(factory);
  });
  afterEach(async () => { await app.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  async function call(e: HttpApiEvent) {
    return await invoke(e, {}) as { statusCode: number; body: string; headers: Record<string, string> };
  }

  it('reuses one initialization for concurrent and warm invocations', async () => {
    const context = { callbackWaitsForEmptyEventLoop: true };
    const results = await Promise.all([invoke(event('GET', '/'), context), invoke(event('GET', '/'), {})]);
    expect(results).toEqual(expect.arrayContaining([expect.objectContaining({ statusCode: 200, body: 'Hello World!' })]));
    await invoke(event('GET', '/'), {});
    expect(factory).toHaveBeenCalledTimes(1);
    expect(context.callbackWaitsForEmptyEventLoop).toBe(false);
  });
  it('returns sanitized initialization errors and retries on the next invocation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    factory.mockRejectedValueOnce(new Error('SECRET_CONNECTION_STRING'));
    expect(await call(event('GET', '/'))).toMatchObject({ statusCode: 503 });
    expect(JSON.stringify(await call(event('GET', '/')))).not.toContain('SECRET');
    expect(factory).toHaveBeenCalledTimes(2);
  });
  it('creates sessions through Lambda and preserves the local HTTP endpoint', async () => {
    expect(await call(event('POST', '/sessions'))).toMatchObject({ statusCode: 201, body: JSON.stringify({ id: sessionId }) });
    await request(app.getHttpServer()).post('/sessions').expect(201).expect({ id: sessionId });
    await request(app.getHttpServer()).post(`/sessions/${sessionId}/attempts`).send(input).expect(201);
    await request(app.getHttpServer()).get(`/sessions/${sessionId}/attempts`).expect(200).expect([]);
  });
  it('rejects payload format 1.0 before initializing', async () => {
    const invalid = { ...event('GET', '/'), version: '1.0' } as unknown as HttpApiEvent;
    expect((await call(invalid)).statusCode).toBe(400);
    expect(factory).not.toHaveBeenCalled();
  });
  it.each(['BasicPlane', 'Glider', 'Dart'] as const)('runs %s through a base64 HTTP API body', async planeId => {
    const launch = { ...input, planeId };
    const e = event('POST', `/sessions/${sessionId}/attempts`, Buffer.from(JSON.stringify(launch)).toString('base64'));
    e.isBase64Encoded = true;
    const result = await call(e);
    const expected = simulateFlight(launch);
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body)).toMatchObject({ ...launch, points: expected.points,
      score: expected.result.score, success: expected.result.success, distance: expected.distance });
    expect(db.flightAttempt.create).toHaveBeenCalledTimes(1);
  });
  it.each(['{', JSON.stringify({ ...input, score: 100 }), JSON.stringify({ ...input, speed: 31 }),
    JSON.stringify({ ...input, planeId: 'unknown' }), JSON.stringify({ ...input, angle: '30' })])('rejects invalid launch %s', async body => {
    expect((await call(event('POST', `/sessions/${sessionId}/attempts`, body))).statusCode).toBe(400);
    expect(db.flightAttempt.create).not.toHaveBeenCalled();
  });
  it('rejects oversized bodies before persistence', async () => {
    expect((await call(event('POST', '/sessions', JSON.stringify({ padding: 'a'.repeat(9000) })))).statusCode).toBe(413);
    expect(db.gameSession.create).not.toHaveBeenCalled();
  });
  it('handles missing sessions, invalid UUIDs and persistence errors', async () => {
    db.gameSession.findUnique.mockResolvedValue(null);
    expect((await call(event('GET', `/sessions/${sessionId}/attempts`))).statusCode).toBe(404);
    expect((await call(event('GET', '/sessions/invalid/attempts'))).statusCode).toBe(400);
    db.gameSession.create.mockRejectedValue(new Error('SECRET_DRIVER_DETAILS'));
    const result = await call(event('POST', '/sessions'));
    expect(result.statusCode).toBe(503);
    expect(result.body).not.toContain('SECRET');
  });
  it('bounds history in SQL and returns the latest rows chronologically', async () => {
    const row = { ...input, sessionId, score: 0, success: false, distance: 10 };
    db.flightAttempt.findMany.mockResolvedValue([
      { ...row, id: 'newer', createdAt: new Date('2026-01-02') },
      { ...row, id: 'older', createdAt: new Date('2026-01-01') },
    ]);
    const result = await call(event('GET', `/sessions/${sessionId}/attempts`));
    expect(JSON.parse(result.body).map((r: { id: string }) => r.id)).toEqual(['older', 'newer']);
    expect(db.flightAttempt.findMany).toHaveBeenCalledWith({ where: { sessionId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
  });
  it('limits requests across routes, ignores forged forwarding headers, isolates source IPs', async () => {
    for (let i = 0; i < 60; i++) expect((await call(event('GET', '/'))).statusCode).toBe(200);
    const blocked = event('POST', '/sessions');
    blocked.headers['x-forwarded-for'] = '198.51.100.1';
    const result = await call(blocked);
    expect(result.statusCode).toBe(429);
    expect(Number(result.headers['retry-after'])).toBeGreaterThan(0);
    expect(db.gameSession.create).not.toHaveBeenCalled();
    expect((await call(event('POST', '/sessions', undefined, '192.0.2.2'))).statusCode).toBe(201);
  });
});
