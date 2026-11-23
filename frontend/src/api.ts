import { displayToModelSpeed } from '@paper-plane/game-math';
import type { FlightPoint, PlaneId } from '@paper-plane/game-math';

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
    response = await fetch(`/api${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError('Нет ответа от сервера. Проверьте подключение и запуск backend.');
  }
  if (!response.ok) {
    const message = response.status === 404 ? 'Сессия больше не существует. Следующий бросок создаст новую.'
      : response.status === 400 ? 'Проверьте самолёт, угол и скорость запуска.'
      : 'Сервер временно недоступен. Попробуйте ещё раз.';
    throw new ApiError(message, response.status);
  }
  try { return await response.json(); }
  catch { throw new ApiError('Сервер вернул некорректный ответ.'); }
}

export async function createSession(): Promise<string> {
  const data = await post('/sessions') as { id?: unknown };
  if (!data || typeof data.id !== 'string') throw new ApiError('Не удалось создать сессию.');
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
    throw new ApiError('Не удалось прочитать траекторию сервера. Повторите попытку.');
  }
  return data;
}
