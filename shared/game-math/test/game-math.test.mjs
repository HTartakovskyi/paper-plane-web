import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANES, FLIGHT, INPUT, DEFAULT_TARGET, TARGET_ZONES,
  createFlightState, stepFlight, displayToModelSpeed, validateLaunch, isPlaneId,
  evaluateTarget, evaluateTargetTrajectory, intersectHorizontalPlane, simulateFlight,
} from '@paper-plane/game-math';

function close(actual, expected, tolerance = 1e-11) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test('original plane coefficients and input conversion', () => {
  assert.deepEqual(PLANES, {
    BasicPlane: { liftMultiplier: 1, dragMultiplier: 1 },
    Glider: { liftMultiplier: 1.25, dragMultiplier: 0.8 },
    Dart: { liftMultiplier: 0.7, dragMultiplier: 0.6 },
  });
  assert.equal(FLIGHT.stepSeconds, 0.1);
  assert.equal(FLIGHT.maxSteps * FLIGHT.stepSeconds, FLIGHT.maxSeconds);
  assert.equal(displayToModelSpeed(INPUT.defaultDisplaySpeed), 14);
  assert.equal(displayToModelSpeed(1), 2);
  assert.equal(displayToModelSpeed(15), 30);
  assert.equal(displayToModelSpeed(7.25), 14.5);
  assert.ok(Object.isFrozen(PLANES.Glider));
  assert.ok(Object.isFrozen(TARGET_ZONES[0]));
});

test('initial velocity uses degrees; fractional inputs are valid', () => {
  const state = createFlightState(30, 14);
  close(state.dx, 12.12435565298214);
  close(state.dy, 7);
  assert.doesNotThrow(() => validateLaunch('Dart', 32.25, 14.5));
  assert.doesNotThrow(() => validateLaunch('Glider', -45, 2));
  assert.doesNotThrow(() => validateLaunch('Glider', 80, 30));
});

test('one step uses updated dx in lift and preserves input state', () => {
  const state = Object.freeze({ dx: 10, dy: 5, horizontalDistance: 0, verticalDistance: 0, stepCount: 0 });
  const next = stepFlight(state, 'BasicPlane');
  close(next.dx, 9.504);
  close(next.dy, 5.21032);
  close(next.horizontalDistance, 0.9504);
  close(next.verticalDistance, 0.521032);
  assert.equal(next.stepCount, 1);
  assert.equal(state.dx, 10);
});

// Independently calculated with System.Decimal (28 significant digits) from the
// pinned Luau recurrence, starting at angle=0, speed=14. NOT Roblox runtime captures.
const reference = {
  BasicPlane: [10.795503381478154, 4.788391475778773, 12.538302072794361, 2.901340972145038],
  Glider: [9.508049728882487, 6.807694574965004, 12.089056682573287, 4.197795802600039],
  Dart: [12.549985491750885, 2.3830672594296854, 13.307784844020892, 1.3931776129765385],
};
for (const [planeId, expected] of Object.entries(reference)) {
  test(`${planeId}: ten steps match independent decimal reference`, () => {
    let state = createFlightState(0, 14);
    for (let i = 0; i < 10; i++) state = stepFlight(state, planeId);
    [state.dx, state.dy, state.horizontalDistance, state.verticalDistance]
      .forEach((value, index) => close(value, expected[index]));
    assert.equal(state.stepCount, 10);
  });
}

test('invalid and non-finite user input is rejected before simulation', () => {
  for (const planeId of ['missing', '__proto__', 'constructor', 'toString', null]) {
    assert.equal(isPlaneId(planeId), false);
    assert.throws(() => simulateFlight({ planeId, angle: 30, speed: 14 }), RangeError);
  }
  for (const angle of [NaN, Infinity, -Infinity, -45.01, 80.01, '30']) {
    assert.throws(() => simulateFlight({ planeId: 'BasicPlane', angle, speed: 14 }), RangeError);
  }
  for (const speed of [NaN, Infinity, -Infinity, 0, 1.99, 30.01, '14']) {
    assert.throws(() => simulateFlight({ planeId: 'BasicPlane', angle: 30, speed }), RangeError);
  }
  for (const speed of [0, 16, NaN, Infinity]) {
    assert.throws(() => displayToModelSpeed(speed), RangeError);
  }
});

test('all four scoring zones include their exact boundary; outer annulus scores zero', () => {
  const target = { center: { x: 10, y: 2, z: -3 }, size: 16 };
  for (const [distance, score] of [[0, 100], [1, 100], [2, 50], [3, 25], [4, 10], [4.000001, 0], [8, 0], [9, 0]]) {
    const result = evaluateTarget(target, { x: 10 + distance, y: 2, z: -3 });
    assert.equal(result.score, score);
    assert.equal(result.success, score > 0);
    close(result.distanceFromCenter, distance);
  }
  for (const [boundary, score] of [[1, 50], [2, 25], [3, 10]]) {
    assert.equal(evaluateTarget(target, { x: 10, y: 2, z: -3 + boundary + 1e-6 }).score, score);
  }
});

test('segment-plane intersection catches a target between distant samples', () => {
  const target = { center: { x: 10, y: 2, z: 0 }, size: 16 };
  const points = [{ x: 0, y: 12, z: 0 }, { x: 20, y: -8, z: 0 }];
  assert.deepEqual(intersectHorizontalPlane(...points, 2), {
    point: { x: 10, y: 2, z: 0 }, alpha: 0.5,
  });
  assert.equal(evaluateTargetTrajectory(target, points).score, 100);
  assert.equal(evaluateTargetTrajectory(target, [...points].reverse()).score, 100);
});

test('parallel, coplanar, empty and non-crossing trajectories have no hit', () => {
  const target = { center: { x: 0, y: 0, z: 0 }, size: 16 };
  for (const points of [[], [{ x: 0, y: 0, z: 0 }],
    [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
    [{ x: 0, y: 2, z: 0 }, { x: 0, y: 1, z: 0 }]]) {
    assert.deepEqual(evaluateTargetTrajectory(target, points), {
      success: false, score: 0, distanceFromCenter: null,
    });
  }
});

test('original geometry: endpoint hit, epsilon guard and first crossing', () => {
  const target = { center: { x: 0, y: 0, z: 0 }, size: 16 };
  assert.equal(evaluateTargetTrajectory(target, [{ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }]).score, 100);
  assert.equal(intersectHorizontalPlane({ x: 0, y: 0.00001, z: 0 }, { x: 0, y: -0.00001, z: 0 }, 0), null);
  const result = evaluateTargetTrajectory(target, [
    { x: 20, y: 1, z: 0 }, { x: 20, y: -1, z: 0 }, { x: -20, y: 1, z: 0 },
  ]);
  assert.equal(result.score, 0); // A later crossing through the centre does not replace the first.
  assert.equal(result.distanceFromCenter, 20);
});

test('a missed target falls to ground; output is deterministic and JSON serializable', () => {
  const input = Object.freeze({ planeId: 'BasicPlane', angle: -45, speed: 2 });
  const result = simulateFlight(input);
  assert.deepEqual(simulateFlight(input), result);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.equal(result.termination, 'ground');
  assert.equal(result.points.at(-1).y, 0);
  assert.equal(result.result.score, 0);
  assert.equal(result.result.success, false);
  assert.ok(result.duration > 0 && result.duration <= 30);
});

test('target contact terminates scoring and playback at the same point', () => {
  const target = Object.freeze({ center: Object.freeze({ x: 16, y: 6.9, z: 0 }), size: 16 });
  const scene = Object.freeze({ target });
  const result = simulateFlight({ planeId: 'BasicPlane', angle: -45, speed: 2 }, scene);
  assert.equal(result.termination, 'target');
  assert.equal(result.result.score, 100);
  assert.equal(result.points.length, 2);
  assert.equal(result.points.at(-1).y, 6.9);
  assert.ok(result.duration < FLIGHT.stepSeconds);
  assert.deepEqual(result.result, evaluateTarget(target, result.points.at(-1)));
});

test('ground-level target wins simultaneous contact; outer disc remains a miss', () => {
  const input = { planeId: 'BasicPlane', angle: -45, speed: 2 };
  const landing = simulateFlight(input).points.at(-1);
  const target = { center: { ...landing }, size: 16 };
  const hit = simulateFlight(input, { target });
  // Aiming toward the new target changes heading, but the default shot already heads +X.
  assert.equal(hit.termination, 'target');
  assert.equal(hit.result.score, 100);
  const outer = simulateFlight(input, { target: { center: { x: 16, y: 6.9, z: 0 }, size: 0.25 } });
  assert.equal(outer.termination, 'target');
  assert.equal(outer.result.score, 0);
});

test('simulation cannot run beyond 300 steps; timestamps preserve the fixed step', () => {
  const result = simulateFlight({ planeId: 'Glider', angle: 80, speed: 30 }, {
    start: { x: 16, y: 100000, z: 0 },
  });
  assert.equal(result.termination, 'timeout');
  assert.equal(result.points.length, 301);
  assert.equal(result.duration, 30);
  assert.equal(result.result.score, 0);
  result.points.forEach((point, i) => assert.equal(point.time, i * 0.1));
});

test('invalid geometry is rejected', () => {
  const input = { planeId: 'BasicPlane', angle: 30, speed: 14 };
  for (const scene of [
    { groundY: NaN }, { start: { x: 0, y: 0, z: 0 } },
    { start: { x: Infinity, y: 7, z: 0 } },
    { target: { ...DEFAULT_TARGET, size: 0 } },
    { target: { ...DEFAULT_TARGET, size: Infinity } },
    { target: { center: { x: 80, y: -1, z: 0 }, size: 50 } },
  ]) assert.throws(() => simulateFlight(input, scene), RangeError);
});

test('all planes and boundary launch inputs produce finite bounded trajectories', () => {
  for (const planeId of Object.keys(PLANES)) {
    for (const angle of [-45, 0, 30, 80]) {
      for (const speed of [2, 14, 30]) {
        const flight = simulateFlight({ planeId, angle, speed });
        assert.ok(flight.points.length >= 2 && flight.points.length <= 301);
        assert.ok(flight.points.every(p => [p.x, p.y, p.z, p.time].every(Number.isFinite)));
        flight.points.slice(1).forEach((point, i) => assert.ok(point.time > flight.points[i].time));
        assert.ok([0, 10, 25, 50, 100].includes(flight.result.score));
      }
    }
  }
});

test('default MVP mission allows all four scores with every plane and UI button steps', () => {
  for (const planeId of Object.keys(PLANES)) {
    const reachable = new Set();
    for (let angle = INPUT.minAngle; angle <= INPUT.maxAngle; angle += INPUT.angleStep) {
      for (let displaySpeed = 1; displaySpeed <= 15; displaySpeed++) {
        reachable.add(simulateFlight({
          planeId, angle, speed: displayToModelSpeed(displaySpeed),
        }).result.score);
      }
    }
    assert.deepEqual([...reachable].sort((a, b) => a - b), [0, 10, 25, 50, 100], planeId);
  }
});

test('changing horizontal heading preserves the flight and scoring', () => {
  const input = { planeId: 'BasicPlane', angle: -30, speed: 10 };
  const original = simulateFlight(input);
  const turned = simulateFlight(input, {
    start: { x: 0, y: 7, z: 16 },
    target: { center: { x: 0, y: 0.2, z: 80 }, size: 50 },
  });
  assert.deepEqual(turned.result, original.result);
  close(turned.distance, original.distance);
  original.points.forEach((p, i) => {
    close(turned.points[i].z, p.x);
    close(turned.points[i].x, p.z);
    close(turned.points[i].y, p.y);
  });
});
