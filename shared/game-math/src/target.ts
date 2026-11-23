export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** MVP target lies in the horizontal X/Z plane. Size is its outer diameter. */
export interface Target {
  readonly center: Vector3;
  readonly size: number;
}

export type Score = 0 | 10 | 25 | 50 | 100;

export interface TargetResult {
  readonly success: boolean;
  readonly score: Score;
  /** Null means that the trajectory did not reach the target plane. */
  readonly distanceFromCenter: number | null;
}

// These factors are relative to size / 2, NOT to size.
export const TARGET_ZONES = Object.freeze([
  Object.freeze({ radiusFactor: 0.5, score: 10 as const }),
  Object.freeze({ radiusFactor: 0.375, score: 25 as const }),
  Object.freeze({ radiusFactor: 0.25, score: 50 as const }),
  Object.freeze({ radiusFactor: 0.125, score: 100 as const }),
]);

export const DEFAULT_TARGET: Target = Object.freeze({
  center: Object.freeze({ x: 80, y: 0.2, z: 0 }),
  size: 50,
});

export function validateVector(value: Vector3): void {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new RangeError('Coordinates must be finite numbers');
  }
}

export function validateTarget(target: Target): void {
  validateVector(target.center);
  if (!Number.isFinite(target.size) || target.size <= 0) {
    throw new RangeError('Target size must be positive and finite');
  }
}

/** MissionMath.FindTargetIntersection, specialized to a horizontal plane. */
export function intersectHorizontalPlane(a: Vector3, b: Vector3, y: number):
  { readonly point: Vector3; readonly alpha: number } | null {
  validateVector(a);
  validateVector(b);
  if (!Number.isFinite(y)) throw new RangeError('Plane height must be finite');
  const ay = a.y - y;
  const by = b.y - y;
  if (!((ay >= 0 && by <= 0) || (ay <= 0 && by >= 0))) return null;
  const denominator = ay - by;
  if (Math.abs(denominator) <= 0.0001) return null;
  const alpha = ay / denominator;
  if (alpha < 0 || alpha > 1) return null;
  return {
    point: { x: a.x + (b.x - a.x) * alpha, y, z: a.z + (b.z - a.z) * alpha },
    alpha,
  };
}

/** MissionMath.EvaluateTarget: radial scoring; caller supplies a plane intersection. */
export function evaluateTarget(target: Target, point: Vector3): TargetResult {
  validateTarget(target);
  validateVector(point);
  const x = point.x - target.center.x;
  const z = point.z - target.center.z;
  const distanceFromCenter = Math.sqrt(x * x + z * z);
  let score: Score = 0;
  for (const zone of TARGET_ZONES) {
    if (distanceFromCenter <= target.size / 2 * zone.radiusFactor && zone.score > score) {
      score = zone.score;
    }
  }
  return { success: score > 0, score, distanceFromCenter };
}

/** Original first-plane-crossing semantics, for an already bounded trajectory. */
export function evaluateTargetTrajectory(target: Target, points: readonly Vector3[]): TargetResult {
  validateTarget(target);
  points.forEach(validateVector);
  for (let i = 1; i < points.length; i++) {
    const hit = intersectHorizontalPlane(points[i - 1]!, points[i]!, target.center.y);
    if (hit) return evaluateTarget(target, hit.point);
  }
  return { success: false, score: 0, distanceFromCenter: null };
}
