import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { simulateFlight } from '@paper-plane/game-math';
import type { FlightInput } from '@paper-plane/game-math';
import { PrismaService } from '../prisma/prisma.service.js';
import type { FlightAttempt } from '../../generated/prisma/client.js';

function attemptResponse(row: FlightAttempt) {
  return {
    id: row.id, sessionId: row.sessionId, planeId: row.planeId,
    angle: row.angle, speed: row.speed, score: row.score, success: row.success,
    distance: row.distance, createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class SessionsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async database<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      // The session can disappear between lookup and insert (foreign key violation).
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2003') {
        throw new NotFoundException('Session not found');
      }
      throw new ServiceUnavailableException('Database operation unavailable');
    }
  }

  private async requireSession(id: string): Promise<void> {
    const session = await this.database(() => this.prisma.gameSession.findUnique({ where: { id }, select: { id: true } }));
    if (!session) throw new NotFoundException('Session not found');
  }

  async createSession() {
    const session = await this.database(() => this.prisma.gameSession.create({ data: {}, select: { id: true } }));
    return { id: session.id };
  }

  async createAttempt(sessionId: string, input: FlightInput) {
    await this.requireSession(sessionId);
    const flight = simulateFlight(input); // Fixed scene from the shared package.
    const row = await this.database(() => this.prisma.flightAttempt.create({
      data: {
        sessionId, planeId: input.planeId, angle: input.angle, speed: input.speed,
        score: flight.result.score, success: flight.result.success, distance: flight.distance,
      },
    }));
    return {
      ...attemptResponse(row), points: flight.points, duration: flight.duration,
      termination: flight.termination, distanceFromCenter: flight.result.distanceFromCenter,
    };
  }

  async getAttempts(sessionId: string) {
    await this.requireSession(sessionId);
    const rows = await this.database(() => this.prisma.flightAttempt.findMany({
      // Return the latest 100, still in chronological order in the API response.
      where: { sessionId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100,
    }));
    return rows.reverse().map(attemptResponse);
  }
}
