import { displayToModelSpeed } from '@paper-plane/game-math';
import type { FlightPoint, PlaneId } from '@paper-plane/game-math';

// Default same-origin mode remains suitable for CloudFront and local development.
const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

export interface Attempt {
  id: string; sessionId: string; planeId: PlaneId; angle: number; speed: number;
  points: FlightPoint[]; score: number; success: boolean; distance: number;
  duration: number; termination: 'target' | 'ground' | 'timeout';
}

export class ApiError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

async function post(path: string, body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError('The server is not responding. Check your connection and try again.');
  }
  if (!response.ok) {
    const message = response.status === 404 ? 'This session has expired. Your next throw will start a new one.'
      : response.status === 400 ? 'Check your plane, launch angle, and speed.'
      : 'The server is temporarily unavailable. Please try again.';
    throw new ApiError(message, response.status);
  }
  try { return await response.json(); }
  catch { throw new ApiError('The server returned an invalid response. Please try again.'); }
}

export async function createSession(): Promise<string> {
  const data = await post('/sessions') as { id?: unknown };
  if (!data || typeof data.id !== 'string') throw new ApiError('Unable to start a session. Please try again.');
  return data.id;
}

export async function throwPlane(sessionId: string, planeId: PlaneId, angle: number, displaySpeed: number): Promise<Attempt> {
  const data = await post(`/sessions/${encodeURIComponent(sessionId)}/attempts`, {
    planeId, angle, speed: displayToModelSpeed(displaySpeed),
  }) as Attempt;
  // Validate playback data only. No physics, collision detection or scoring here.
  if (!data || !Array.isArray(data.points) || data.points.length < 2 ||
      !data.points.every((p, i) => p && [p.x, p.y, p.z, p.time].every(Number.isFinite) &&
        (i === 0 ? p.time === 0 : p.time > data.points[i - 1].time)) ||
      !Number.isFinite(data.duration) || data.duration !== data.points.at(-1)!.time ||
      !Number.isFinite(data.score) || !Number.isFinite(data.distance) || typeof data.success !== 'boolean') {
    throw new ApiError('Unable to read the flight path. Please try again.');
  }
  return data;
}
