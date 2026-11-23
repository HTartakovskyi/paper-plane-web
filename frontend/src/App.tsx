import { Component, useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { INPUT } from '@paper-plane/game-math';
import type { PlaneId } from '@paper-plane/game-math';
import { ApiError, createSession, throwPlane } from './api';
import type { Attempt } from './api';
import { AIRCRAFT, Scene, ZONE_COLORS } from './Scene';

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="scene-error">Unable to load the 3D scene. Refresh the page and check your browser's hardware acceleration.</div> : this.props.children; }
}

function PlaneIcon({ variant = 'BasicPlane' }: { variant?: PlaneId }) {
  return <svg viewBox="0 0 64 40" aria-hidden="true" className={`plane-icon ${variant}`}>
    <path d="M4 8 60 18 20 35 25 22Z" fill="currentColor" />
    <path d="m4 8 21 14 35-4M25 22l-5 13" fill="none" stroke="#10232c" strokeWidth="1.5" />
  </svg>;
}

export function App() {
  const [planeId, setPlaneId] = useState<PlaneId>('BasicPlane');
  const [angle, setAngle] = useState<number>(INPUT.defaultAngle);
  const [speed, setSpeed] = useState<number>(INPUT.defaultDisplaySpeed);
  const [phase, setPhase] = useState<'ready'|'loading'|'flying'|'result'>('ready');
  const [attempt, setAttempt] = useState<Attempt|null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [count, setCount] = useState(0);
  const session = useRef<string|null>(null), requestBusy = useRef(false);
  const busy = phase !== 'ready';
  const finish = useCallback(() => setPhase('result'), []);

  async function launch() {
    if (requestBusy.current || phase !== 'ready') return;
    requestBusy.current = true;
    setError(''); setPhase('loading'); setProgress(0);
    try {
      if (!session.current) session.current = await createSession();
      const result = await throwPlane(session.current, planeId, angle, speed);
      setAttempt(result); setCount(value => value + 1); setPhase('flying');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) session.current = null;
      setError(cause instanceof Error ? cause.message : 'Unable to launch. Please try again.');
      setPhase('ready');
    } finally { requestBusy.current = false; }
  }

  return <main className="app">
    <header className="topbar"><a className="brand" href="/" aria-label="Paper Plane — Home"><PlaneIcon /><span>PAPER PLANE<small>FLIGHT LAB</small></span></a>
      <div className="mission-label">TARGET PRACTICE <span>One target. The perfect throw.</span></div>
      <span className="edition">WEB EDITION</span></header>
    <div className="workspace">
      <aside className="controls">
        <div className="controls-scroll"><div className="eyebrow">SET UP YOUR FLIGHT</div><h1>Paper.<br/>A little physics.</h1>
        <p className="intro">Pick a plane and find your way to the bullseye.</p>
        <fieldset disabled={busy}><legend>Your plane</legend>
          <div className="aircraft-list">{(Object.keys(AIRCRAFT) as PlaneId[]).map(id => <button type="button" key={id} aria-pressed={planeId === id}
            className={`aircraft ${planeId === id ? 'selected' : ''}`} onClick={() => setPlaneId(id)} aria-label={id}>
            <span style={{color:AIRCRAFT[id].color}}><PlaneIcon variant={id} /></span><span><strong>{AIRCRAFT[id].name}</strong><small>{AIRCRAFT[id].subtitle}</small></span><span className="selection-mark">{planeId === id ? '✓' : ''}</span>
          </button>)}</div>
          <div className="setting"><label htmlFor="angle">Launch angle</label><output htmlFor="angle">{angle > 0 ? '+' : ''}{angle}°</output></div>
          <input id="angle" aria-label="Launch angle" type="range" min={INPUT.minAngle} max={INPUT.maxAngle} step={1} value={angle} onChange={e => setAngle(Number(e.target.value))} />
          <div className="range-labels"><span>−45°</span><span>+80°</span></div>
          <div className="setting"><label htmlFor="speed">Speed</label><output htmlFor="speed">{speed}<small> / 15</small></output></div>
          <input id="speed" aria-label="Speed" type="range" min={1} max={15} step={1} value={speed} onChange={e => setSpeed(Number(e.target.value))} />
          <div className="range-labels"><span>Gentle</span><span>Powerful</span></div>
        </fieldset>
        {error && <div role="alert" className="error">{error}</div>}
        </div><div className="controls-action"><button className="throw-button" disabled={busy} onClick={launch}>{phase === 'loading' ? 'PREPARING…' : phase === 'flying' ? 'IN FLIGHT' : phase === 'result' ? 'FLIGHT COMPLETE' : 'THROW'}<PlaneIcon /></button>
        <p className="controls-note">Precision over power.</p></div>
      </aside>
      <section className="arena" aria-label="3D flight scene">
        <div className="arena-heading"><span className="eyebrow">FLIGHT RANGE</span><h2>Aim for the bullseye</h2><p>The closer to the center, the higher the score.</p></div>
        <div className="attempt-badge">{count ? `THROW ${String(count).padStart(2,'0')}` : 'READY TO FLY'}</div>
        <SceneBoundary><Scene planeId={planeId} angle={angle} attempt={attempt} onFinish={finish} onProgress={setProgress} /></SceneBoundary>
        <div className="legend" aria-label="Target zones"><span>ZONES</span>{[10,25,50,100].map((score,i) => <span key={score}><i style={{background:ZONE_COLORS[i]}} />{score}</span>)}<small>Outer edge: 0</small></div>
        <div className="flight-status" aria-live="polite">{phase === 'flying' ? 'Watch your plane fly' : phase === 'loading' ? 'Preparing your flight…' : phase === 'result' ? 'Flight complete' : 'Set your controls and press THROW'}</div>
        {phase === 'flying' && <div className="flight-progress" role="progressbar" aria-label="Flight progress" aria-valuenow={Math.round(progress*100)} aria-valuemin={0} aria-valuemax={100}><div style={{width:`${progress*100}%`}} /></div>}
        {phase === 'result' && attempt && <div className="result-card" role="status" data-testid="result">
          <div className="eyebrow">FLIGHT RESULT</div><h2>{attempt.success ? 'Target hit!' : 'Give it another try?'}</h2>
          <div className="score"><strong>{attempt.score}</strong><span>points</span></div>
          <div className="result-details"><span>{AIRCRAFT[attempt.planeId].name}</span><span>Distance <b>{attempt.distance.toFixed(1)}</b></span></div>
          <button autoFocus className="retry-button" onClick={() => { setAttempt(null); setPhase('ready'); setProgress(0); }}>TRY AGAIN</button>
        </div>}
      </section>
    </div>
    <footer><span>Folded from paper. Made to fly.</span><span>Basic · Glider · Dart</span></footer>
  </main>;
}
