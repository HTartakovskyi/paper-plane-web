// Roblox source pinned at 6a9df0f98e8a690ee6bcec87550dc7d2d40aa560.
export const PLANES = Object.freeze({
  BasicPlane: Object.freeze({ liftMultiplier: 1, dragMultiplier: 1 }),
  Glider: Object.freeze({ liftMultiplier: 1.25, dragMultiplier: 0.8 }),
  Dart: Object.freeze({ liftMultiplier: 0.7, dragMultiplier: 0.6 }),
});

export type PlaneId = keyof typeof PLANES;

export const FLIGHT = Object.freeze({
  liftCoefficient: 0.08,
  dragCoefficient: 0.01,
  gravity: 0.5,
  positionScale: 0.1,
  stepSeconds: 1 / 10,
  maxSeconds: 30,
  maxSteps: 300,
});

export const INPUT = Object.freeze({
  minAngle: -45,
  maxAngle: 80,
  angleStep: 5,
  defaultAngle: 30,
  minDisplaySpeed: 1,
  maxDisplaySpeed: 15,
  speedStep: 1,
  defaultDisplaySpeed: 7,
  speedToModelMultiplier: 2,
});

export function isPlaneId(value: unknown): value is PlaneId {
  return typeof value === 'string' && Object.hasOwn(PLANES, value);
}

export function validateLaunch(planeId: PlaneId, angle: number, speed: number): void {
  if (!isPlaneId(planeId)) throw new RangeError('Unknown plane');
  if (!Number.isFinite(angle) || angle < INPUT.minAngle || angle > INPUT.maxAngle) {
    throw new RangeError('Angle must be between -45 and 80 degrees');
  }
  if (!Number.isFinite(speed) || speed < 2 || speed > 30) {
    throw new RangeError('Model speed must be between 2 and 30');
  }
}

export function displayToModelSpeed(displaySpeed: number): number {
  if (!Number.isFinite(displaySpeed) || displaySpeed < 1 || displaySpeed > 15) {
    throw new RangeError('Display speed must be between 1 and 15');
  }
  return displaySpeed * INPUT.speedToModelMultiplier;
}
