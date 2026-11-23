import { FLIGHT, PLANES, validateLaunch } from './config.js';
import type { PlaneId } from './config.js';
import {
  DEFAULT_TARGET, evaluateTarget, evaluateTargetTrajectory, intersectHorizontalPlane,
  validateTarget, validateVector,
} from './target.js';
import type { Target, TargetResult, Vector3 } from './target.js';

export interface FlightState {
  readonly dx: number;
  readonly dy: number;
  readonly horizontalDistance: number;
  readonly verticalDistance: number;
  readonly stepCount: number;
}

export function createFlightState(angle: number, speed: number): FlightState {
  validateLaunch('BasicPlane', angle, speed);
  const radians = angle * (Math.PI / 180);
  return {
    dx: speed * Math.cos(radians), dy: speed * Math.sin(radians),
    horizontalDistance: 0, verticalDistance: 0, stepCount: 0,
  };
}

/** One original FlightModel.Step + FlightSimulator.Step, with no variable dt. */
export function stepFlight(state: FlightState, planeId: PlaneId): FlightState {
  const plane = PLANES[planeId];
  if (!Object.hasOwn(PLANES, planeId)) throw new RangeError('Unknown plane');
  const lift = FLIGHT.liftCoefficient * plane.liftMultiplier;
  const drag = FLIGHT.dragCoefficient * plane.dragMultiplier;
  let { dx, dy } = state;
  // Preserve BOTH operation order and subtractive drag from the Luau implementation.
  dx = dx - dy * lift;
  dy = dy + dx * lift;
  dx = dx - dx * drag;
  dy = dy - dy * drag;
  dy = dy - FLIGHT.gravity;
  return {
    dx, dy,
    horizontalDistance: state.horizontalDistance + dx * FLIGHT.positionScale,
    verticalDistance: state.verticalDistance + dy * FLIGHT.positionScale,
    stepCount: state.stepCount + 1,
  };
}

// Explicit MVP decision: no avatar/hand offsets. Fixed launch point above the ground.
export const DEFAULT_START: Vector3 = Object.freeze({ x: 16, y: 7, z: 0 });

export interface FlightInput {
  readonly planeId: PlaneId;
  readonly angle: number;
  /** Model units (2..30); UI values (1..15) use displayToModelSpeed first. */
  readonly speed: number;
}

export interface FlightScene {
  readonly start?: Vector3;
  readonly target?: Target;
  readonly groundY?: number;
}

export interface FlightPoint extends Vector3 {
  readonly time: number;
}

export interface FlightResult {
  readonly points: readonly FlightPoint[];
  readonly termination: 'target' | 'ground' | 'timeout';
  readonly result: TargetResult;
  readonly duration: number;
  /** Horizontal displacement from release, not the arc length of the flight. */
  readonly distance: number;
}

/** Server and browser call the same bounded simulation, independent of frame rate. */
export function simulateFlight(input: FlightInput, scene: FlightScene = {}): FlightResult {
  validateLaunch(input.planeId, input.angle, input.speed);
  const start = scene.start ?? DEFAULT_START;
  const target = scene.target ?? DEFAULT_TARGET;
  const groundY = scene.groundY ?? 0;
  validateVector(start);
  validateTarget(target);
  if (!Number.isFinite(groundY) || start.y <= groundY || target.center.y < groundY) {
    throw new RangeError('Start must be above ground and target must not be below it');
  }
  const offsetX = target.center.x - start.x;
  const offsetZ = target.center.z - start.z;
  const length = Math.sqrt(offsetX * offsetX + offsetZ * offsetZ);
  if (!Number.isFinite(length)) throw new RangeError('Scene dimensions overflow');
  const forward = length < 0.001
    ? { x: 0, z: -1 }
    : { x: offsetX / length, z: offsetZ / length };
  let state = createFlightState(input.angle, input.speed);
  const points: FlightPoint[] = [{ ...start, time: 0 }];
  let termination: FlightResult['termination'] = 'timeout';

  for (let i = 1; i <= FLIGHT.maxSteps; i++) {
    state = stepFlight(state, input.planeId);
    const next: FlightPoint = {
      x: start.x + forward.x * state.horizontalDistance,
      y: start.y + state.verticalDistance,
      z: start.z + forward.z * state.horizontalDistance,
      time: i * FLIGHT.stepSeconds,
    };
    const previous = points[points.length - 1]!;
    const planeHit = intersectHorizontalPlane(previous, next, target.center.y);
    const targetHit = planeHit && evaluateTarget(target, planeHit.point).distanceFromCenter! <= target.size / 2
      ? planeHit : null;
    const groundHit = intersectHorizontalPlane(previous, next, groundY);
    // Prefer target on an equal-time contact when the disc lies directly on the ground.
    const hit = targetHit && (!groundHit || targetHit.alpha <= groundHit.alpha)
      ? targetHit : groundHit;
    if (hit) {
      termination = hit === targetHit ? 'target' : 'ground';
      points.push({ ...hit.point, time: ((i - 1) + hit.alpha) * FLIGHT.stepSeconds });
      break;
    }
    points.push(next);
  }

  const last = points[points.length - 1]!;
  // Score the actual first physical target contact, never an invisible continuation.
  const result = termination === 'target'
    ? evaluateTarget(target, last)
    : { ...evaluateTargetTrajectory(target, points), success: false, score: 0 as const };
  return {
    points, termination, result, duration: last.time,
    distance: Math.sqrt((last.x - start.x) ** 2 + (last.z - start.z) ** 2),
  };
}
