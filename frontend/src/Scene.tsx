import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { DEFAULT_START, DEFAULT_TARGET, TARGET_ZONES } from '@paper-plane/game-math';
import type { PlaneId } from '@paper-plane/game-math';
import type { Attempt } from './api';

export const AIRCRAFT = {
  BasicPlane: { name: 'Basic', subtitle: 'Классическая складка', color: '#f5f7f3', width: 2, length: 1 },
  Glider: { name: 'Glider', subtitle: 'Широкое крыло', color: '#f4b766', width: 3.3, length: 0.85 },
  Dart: { name: 'Dart', subtitle: 'Узкий, стремительный', color: '#64bab4', width: 1.2, length: 1.4 },
};
export const ZONE_COLORS = ['#a1c8bd', '#54a9a1', '#236e77', '#f4b766'];

function PaperPlane({ planeId }: { planeId: PlaneId }) {
  const config = AIRCRAFT[planeId];
  const geometry = useMemo(() => {
    const w = config.width, l = config.length;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      3*l,0,0, -2*l,0,-w, -l,0.65,0,
      3*l,0,0, -l,0.65,0, -2*l,0,w,
      3*l,0,0, -l,-0.55,0, -l,0.65,0,
    ], 3));
    g.computeVertexNormals();
    return g;
  }, [config]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} castShadow><meshStandardMaterial color={config.color} side={THREE.DoubleSide} roughness={0.82} /></mesh>;
}

function Framing({ attempt }: { attempt: Attempt | null }) {
  const { camera, size } = useThree();
  useLayoutEffect(() => {
    const bounds = new THREE.Box3();
    const r = DEFAULT_TARGET.size / 2;
    bounds.expandByPoint(new THREE.Vector3(DEFAULT_START.x - 8, 0, -r));
    bounds.expandByPoint(new THREE.Vector3(DEFAULT_TARGET.center.x + r + 6, 16, r));
    for (const p of attempt?.points ?? []) bounds.expandByPoint(new THREE.Vector3(p.x, p.y, p.z));
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const perspective = camera as THREE.PerspectiveCamera;
    const vertical = THREE.MathUtils.degToRad(perspective.fov) / 2;
    const horizontal = Math.atan(Math.tan(vertical) * size.width / size.height);
    const distance = sphere.radius / Math.sin(Math.min(vertical, horizontal)) * 1.12;
    camera.position.copy(sphere.center).add(new THREE.Vector3(-0.18, 0.8, 1.25).normalize().multiplyScalar(distance));
    camera.lookAt(sphere.center);
    camera.updateProjectionMatrix();
  }, [attempt, camera, size.width, size.height]);
  return null;
}

function Flight({ attempt, onFinish, onProgress }: {
  attempt: Attempt; onFinish: () => void; onProgress: (fraction: number) => void;
}) {
  const plane = useRef<THREE.Group>(null);
  const elapsed = useRef(0), segment = useRef(0), finished = useRef(false), lastUpdate = useRef(-1);
  const trail = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((attempt.points.length + 1) * 3), 3));
    geometry.setDrawRange(0, 0);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#c56535' }));
    line.frustumCulled = false;
    return line;
  }, [attempt]);
  useEffect(() => () => { trail.geometry.dispose(); trail.material.dispose(); }, [trail]);
  useFrame((_, delta) => {
    if (!plane.current || finished.current) return;
    elapsed.current = Math.min(attempt.duration, elapsed.current + delta);
    const points = attempt.points;
    while (segment.current < points.length - 2 && points[segment.current + 1].time <= elapsed.current) segment.current++;
    const i = segment.current, a = points[i], b = points[i + 1];
    const t = Math.max(0, Math.min(1, (elapsed.current - a.time) / (b.time - a.time)));
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
    plane.current.position.set(x, y, z);
    plane.current.rotation.set(0, -Math.atan2(b.z - a.z, b.x - a.x), Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z)), 'YXZ');
    const buffer = trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let j = 0; j <= i; j++) buffer.setXYZ(j, points[j].x, points[j].y, points[j].z);
    buffer.setXYZ(i + 1, x, y, z);
    buffer.needsUpdate = true;
    trail.geometry.setDrawRange(0, i + 2);
    if (elapsed.current - lastUpdate.current > 0.1) {
      lastUpdate.current = elapsed.current;
      onProgress(elapsed.current / attempt.duration);
    }
    if (elapsed.current >= attempt.duration) {
      finished.current = true;
      onProgress(1);
      onFinish();
    }
  });
  return <><group ref={plane} position={[DEFAULT_START.x, DEFAULT_START.y, DEFAULT_START.z]}><PaperPlane planeId={attempt.planeId} /></group><primitive object={trail} /></>;
}

export function Scene({ planeId, angle, attempt, onFinish, onProgress }: {
  planeId: PlaneId; angle: number; attempt: Attempt | null;
  onFinish: () => void; onProgress: (fraction: number) => void;
}) {
  const target = DEFAULT_TARGET;
  return <Canvas shadows dpr={[1, 1.5]} camera={{ fov: 42, near: 0.1, far: 1500 }}
    fallback={<div className="scene-error">Для 3D-сцены нужен браузер с поддержкой WebGL.</div>}>
    <color attach="background" args={['#e6efeb']} />
    <ambientLight intensity={1.6} />
    <directionalLight position={[35, 100, 35]} intensity={2.8} castShadow shadow-mapSize={[2048, 2048]}
      shadow-camera-left={-120} shadow-camera-right={120} shadow-camera-top={100} shadow-camera-bottom={-100} shadow-camera-far={250} shadow-bias={-0.001} />
    <Framing attempt={attempt} />
    <mesh rotation={[-Math.PI/2, 0, 0]} position={[50,-0.035,0]} receiveShadow>
      <planeGeometry args={[800,800]} /><meshStandardMaterial color="#d6e3db" roughness={1} />
    </mesh>
    <gridHelper args={[400, 40, '#b9ccc0', '#c4d5ca']} position={[40,0.005,0]} />
    <mesh rotation={[-Math.PI/2,0,0]} position={[DEFAULT_START.x,0.025,0]}>
      <ringGeometry args={[3.8,4,64]} /><meshBasicMaterial color="#6e9184" />
    </mesh>
    <mesh position={[DEFAULT_START.x,3.45,0]}>
      <cylinderGeometry args={[0.04,0.04,6.9,8]} /><meshBasicMaterial color="#8ca698" transparent opacity={0.4} />
    </mesh>
    <group position={[target.center.x,target.center.y,target.center.z]} rotation={[-Math.PI/2,0,0]}>
      <mesh receiveShadow><circleGeometry args={[target.size/2,128]} /><meshStandardMaterial color="#c0c9b8" /></mesh>
      {TARGET_ZONES.map((zone,i) => <mesh key={zone.score} position={[0,0,0.012*(i+1)]} receiveShadow>
        <circleGeometry args={[target.size/2*zone.radiusFactor,96]} />
        <meshStandardMaterial color={ZONE_COLORS[i]} roughness={0.9} />
      </mesh>)}
    </group>
    {attempt ? <Flight key={attempt.id} attempt={attempt} onFinish={onFinish} onProgress={onProgress} />
      : <group position={[DEFAULT_START.x,DEFAULT_START.y,DEFAULT_START.z]} rotation={[0,0,angle*Math.PI/180]}><PaperPlane planeId={planeId} /></group>}
  </Canvas>;
}
