import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { simulateFlight } from '@paper-plane/game-math';
import type { PlaneId } from '@paper-plane/game-math';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Sessions API with real PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('PostgreSQL DATABASE_URL is required for API tests');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      // Delete ONLY sessions created by this suite; FK cascade removes their attempts.
      if (prisma && createdSessionIds.length) {
        await prisma.gameSession.deleteMany({ where: { id: { in: createdSessionIds } } });
      }
    } finally {
      if (app) await app.close();
    }
  });

  async function createSession(): Promise<string> {
    const response = await request(app.getHttpServer()).post('/sessions').expect(201);
    createdSessionIds.push(response.body.id as string);
    expect(response.body.id).toMatch(/^[a-f0-9-]{36}$/);
    return response.body.id as string;
  }

  it('keeps the existing root endpoint', async () => {
    await request(app.getHttpServer()).get('/').expect(200).expect('Hello World!');
  });

  it('creates a persisted session with an empty history', async () => {
    const id = await createSession();
    expect(await prisma.gameSession.findUnique({ where: { id } })).not.toBeNull();
    await request(app.getHttpServer()).get(`/sessions/${id}/attempts`).expect(200).expect([]);
  });

  it.each<PlaneId>(['BasicPlane', 'Glider', 'Dart'])('calculates, persists and reads %s', async planeId => {
    const sessionId = await createSession();
    const input = { planeId, angle: 30, speed: 14 };
    const expected = simulateFlight(input);
    const { body } = await request(app.getHttpServer())
      .post(`/sessions/${sessionId}/attempts`).send(input).expect(201);
    expect(body).toMatchObject({
      ...input, sessionId, points: expected.points, score: expected.result.score,
      success: expected.result.success, distance: expected.distance,
      duration: expected.duration, termination: expected.termination,
    });
    const stored = await prisma.flightAttempt.findUniqueOrThrow({ where: { id: body.id } });
    expect(stored).toMatchObject({ ...input, sessionId, score: body.score, success: body.success, distance: body.distance });
    expect(stored).not.toHaveProperty('points');
    const history = await request(app.getHttpServer()).get(`/sessions/${sessionId}/attempts`).expect(200);
    expect(history.body).toEqual([{
      id: body.id, sessionId, ...input, score: body.score, success: body.success,
      distance: body.distance, createdAt: body.createdAt,
    }]);
  });

  it('records both success and failure, preserves order and isolates sessions', async () => {
    const id = await createSession();
    const other = await createSession();
    const hit = await request(app.getHttpServer()).post(`/sessions/${id}/attempts`)
      .send({ planeId: 'BasicPlane', angle: -30, speed: 10 }).expect(201);
    expect(hit.body.score).toBe(100);
    expect(hit.body.success).toBe(true);
    const miss = await request(app.getHttpServer()).post(`/sessions/${id}/attempts`)
      .send({ planeId: 'Dart', angle: -45, speed: 2 }).expect(201);
    expect(miss.body.score).toBe(0);
    expect(miss.body.success).toBe(false);
    const history = await request(app.getHttpServer()).get(`/sessions/${id}/attempts`).expect(200);
    expect(history.body.map((entry: { id: string }) => entry.id)).toEqual([hit.body.id, miss.body.id]);
    await request(app.getHttpServer()).get(`/sessions/${other}/attempts`).expect(200).expect([]);
  });

  it.each([
    {}, { planeId: 'missing', angle: 30, speed: 14 },
    { planeId: 'constructor', angle: 30, speed: 14 },
    { planeId: 'BasicPlane', angle: '30', speed: 14 },
    { planeId: 'BasicPlane', angle: null, speed: 14 },
    { planeId: 'BasicPlane', angle: 81, speed: 14 },
    { planeId: 'BasicPlane', angle: -46, speed: 14 },
    { planeId: 'BasicPlane', angle: 30, speed: 1 },
    { planeId: 'BasicPlane', angle: 30, speed: 31 },
    { planeId: 'BasicPlane', angle: 30, speed: '14' },
    { planeId: 'BasicPlane', angle: 30, speed: 14, score: 100, success: true },
    { planeId: 'BasicPlane', angle: 30, speed: 14, target: { size: 9999 } },
    [],
  ])('rejects invalid input without saving: %j', async body => {
    const id = await createSession();
    await request(app.getHttpServer()).post(`/sessions/${id}/attempts`).send(body).expect(400);
    expect(await prisma.flightAttempt.count({ where: { sessionId: id } })).toBe(0);
  });

  it('accepts fractional launch settings', async () => {
    const id = await createSession();
    await request(app.getHttpServer()).post(`/sessions/${id}/attempts`)
      .send({ planeId: 'Glider', angle: 32.25, speed: 14.5 }).expect(201);
  });

  it('returns 404 for missing sessions and 400 for malformed IDs', async () => {
    for (const [id, status] of [[randomUUID(), 404], ['not-a-uuid', 400]] as const) {
      await request(app.getHttpServer()).get(`/sessions/${id}/attempts`).expect(status);
      await request(app.getHttpServer()).post(`/sessions/${id}/attempts`)
        .send({ planeId: 'BasicPlane', angle: 30, speed: 14 }).expect(status);
    }
  });

  it('rejects malformed JSON and non-finite numeric overflow', async () => {
    const id = await createSession();
    for (const body of ['{', '{"planeId":"BasicPlane","angle":1e400,"speed":14}']) {
      await request(app.getHttpServer()).post(`/sessions/${id}/attempts`)
        .set('Content-Type', 'application/json').send(body).expect(400);
    }
  });

  it('returns a sanitized 503 when persistence fails, without pretending it saved', async () => {
    const id = await createSession();
    const spy = vi.spyOn(prisma.flightAttempt, 'create').mockRejectedValueOnce(new Error('PRIVATE_DRIVER_DETAILS'));
    try {
      const response = await request(app.getHttpServer()).post(`/sessions/${id}/attempts`)
        .send({ planeId: 'BasicPlane', angle: 30, speed: 14 }).expect(503);
      expect(JSON.stringify(response.body)).not.toContain('PRIVATE_DRIVER_DETAILS');
      expect(await prisma.flightAttempt.count({ where: { sessionId: id } })).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});
