import { ExternalLink, Pause, Play, PlayCircle, RotateCcw } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CanonicalReplayV1 } from '../../lib/replay/types';
import { parsePreviewVideoUrl } from '../lib/preview-video';

type PlayerMode = 'cube' | 'ship' | 'ball' | 'ufo' | 'wave' | 'robot' | 'spider' | 'swing';
type PlayerStateEvent = Extract<CanonicalReplayV1['events'][number], { kind: 'player-state' }>;
type PositionPoint = { x: number; y: number; rotation: number; tick: string; time: number; player: 1 | 2 };
type PlaybackPlayer = { point: PositionPoint; path: PositionPoint[] };

const MODE_NAMES: Record<PlayerMode, string> = {
  cube: 'Cube', ship: 'Ship', ball: 'Ball', ufo: 'UFO', wave: 'Wave', robot: 'Robot', spider: 'Spider', swing: 'Swing',
};

function modeValue(value: unknown): PlayerMode | null {
  if (typeof value === 'string') {
    const normalized = value.toLowerCase().replace(/[^a-z]/g, '');
    if (normalized === 'cube' || normalized === 'ship' || normalized === 'ball' || normalized === 'ufo'
      || normalized === 'wave' || normalized === 'robot' || normalized === 'spider' || normalized === 'swing') return normalized;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return (['cube', 'ship', 'ball', 'ufo', 'wave', 'robot', 'spider', 'swing'] as const)[value] ?? null;
  }
  return null;
}

function modeFromPayload(value: unknown): PlayerMode | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  for (const key of ['gameMode', 'gamemode', 'game_mode', 'playerMode', 'player_mode', 'iconType']) {
    const mode = modeValue(payload[key]);
    if (mode) return mode;
  }
  if (payload.data && typeof payload.data === 'object') return modeFromPayload(payload.data);
  return null;
}

function sampled(points: PositionPoint[], limit = 1400) {
  if (points.length <= limit) return points;
  const step = (points.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => points[Math.round(index * step)]!);
}

function lowerBound(points: PositionPoint[], time: number): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle]!.time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

function interpolate(points: PositionPoint[], time: number): PositionPoint | null {
  if (!points.length) return null;
  const rightIndex = lowerBound(points, time);
  if (rightIndex <= 0) return points[0]!;
  if (rightIndex >= points.length) return points.at(-1)!;
  const left = points[rightIndex - 1]!;
  const right = points[rightIndex]!;
  const span = right.time - left.time;
  const progress = span <= 0 ? 0 : Math.max(0, Math.min(1, (time - left.time) / span));
  return {
    ...left,
    x: left.x + (right.x - left.x) * progress,
    y: left.y + (right.y - left.y) * progress,
    rotation: left.rotation + (right.rotation - left.rotation) * progress,
    time,
  };
}

function playbackPath(points: PositionPoint[], time: number) {
  const start = lowerBound(points, Math.max(0, time - 2.5));
  const end = lowerBound(points, time + 1.25);
  return sampled(points.slice(Math.max(0, start - 1), Math.min(points.length, end + 1)), 900);
}

function clock(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function modulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

export function ReplayPathPreview({ replay }: { replay: CanonicalReplayV1 }) {
  const patternId = useId().replace(/:/g, '');
  const preview = useMemo(() => {
    const raw = replay.events.filter((event): event is PlayerStateEvent => event.kind === 'player-state' && Number.isFinite(event.x) && Number.isFinite(event.y));
    if (!raw.length) return null;
    const firstTick = raw.reduce((minimum, event) => BigInt(event.tick) < minimum ? BigInt(event.tick) : minimum, BigInt(raw[0]!.tick));
    const rate = Number(BigInt(replay.clock.ticksPerSecond.numerator)) / Number(BigInt(replay.clock.ticksPerSecond.denominator));
    const points = raw.flatMap((event): PositionPoint[] => {
      const time = Number(BigInt(event.tick) - firstTick) / rate;
      return Number.isFinite(time) ? [{ x: event.x!, y: event.y!, rotation: event.rotation ?? 0, tick: event.tick, time, player: event.player }] : [];
    });
    if (!points.length || !Number.isFinite(rate) || rate <= 0) return null;

    const players = {
      1: points.filter((point) => point.player === 1),
      2: points.filter((point) => point.player === 2),
    };
    let minX = points[0]!.x;
    let maxX = points[0]!.x;
    let minY = points[0]!.y;
    let maxY = points[0]!.y;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    const rootMode = Object.values(replay.extensions ?? {}).map(modeFromPayload).find((mode) => mode !== null) ?? null;
    const modeChanges = replay.events.flatMap((event) => {
      if (event.kind !== 'extension') return [];
      const mode = modeFromPayload(event.payload);
      if (!mode) return [];
      const time = Number(BigInt(event.tick) - firstTick) / rate;
      return Number.isFinite(time) ? [{ time: Math.max(0, time), mode }] : [];
    }).sort((left, right) => left.time - right.time);
    return {
      players,
      pointCount: points.length,
      minX,
      maxX,
      minY,
      maxY,
      duration: points.reduce((maximum, point) => Math.max(maximum, point.time), 0),
      rootMode,
      modeChanges,
    };
  }, [replay]);

  const [playhead, setPlayhead] = useState(0);
  const playheadRef = useRef(0);
  const [playing, setPlaying] = useState(() => typeof window === 'undefined' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [speed, setSpeed] = useState(1);
  const [playEpoch, setPlayEpoch] = useState(0);

  useEffect(() => {
    if (!preview || !playing || preview.duration <= 0) return;
    const startedAt = performance.now();
    const startingPlayhead = playheadRef.current;
    let frame = 0;
    const animate = (now: number) => {
      const next = startingPlayhead + ((now - startedAt) / 1000) * speed;
      if (next >= preview.duration) {
        playheadRef.current = preview.duration;
        setPlayhead(preview.duration);
        setPlaying(false);
        return;
      }
      playheadRef.current = next;
      setPlayhead(next);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [playEpoch, playing, preview, speed]);

  if (!preview) return null;

  const activePlayers = ([1, 2] as const).flatMap((player): PlaybackPlayer[] => {
    const point = interpolate(preview.players[player], playhead);
    return point ? [{ point, path: playbackPath(preview.players[player], playhead) }] : [];
  });
  const camera = activePlayers[0]?.point ?? preview.players[1][0] ?? preview.players[2][0]!;
  const width = 1000;
  const height = 420;
  const anchorX = 330;
  const worldScale = 0.72;
  const yRange = Math.max(preview.maxY - preview.minY, 1);
  const verticalScale = Math.min(0.9, 310 / yRange);
  const project = (point: Pick<PositionPoint, 'x' | 'y'>) => ({
    x: anchorX + (point.x - camera.x) * worldScale,
    y: yRange <= 1 ? height / 2 : height - 54 - (point.y - preview.minY) * verticalScale,
  });
  const gridSize = 30 * worldScale;
  const gridX = modulo(anchorX - camera.x * worldScale, gridSize);
  const gridY = modulo(camera.y * verticalScale, gridSize);
  const parallaxX = -modulo(camera.x * 0.12, 260);
  const detectedMode = [...preview.modeChanges].reverse().find((change) => change.time <= playhead)?.mode ?? preview.rootMode;
  const mode = detectedMode ?? 'cube';

  const restart = () => {
    playheadRef.current = 0;
    setPlayhead(0);
    setPlaying(true);
    setPlayEpoch((value) => value + 1);
  };
  const toggle = () => {
    if (playheadRef.current >= preview.duration) return restart();
    setPlaying((value) => !value);
  };

  return <section className="overflow-hidden rounded-[24px] border border-white/[.075] bg-[#0e1118]">
    <div className="flex flex-wrap items-start justify-between gap-3 p-6 pb-4"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-300">Replay visualization</p><h2 className="mt-2 text-lg font-semibold">Live movement</h2></div><div className="flex items-center gap-3 text-[10px] text-zinc-500">{preview.players[1].length > 0 && <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-violet-300" />Player 1</span>}{preview.players[2].length > 0 && <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-cyan-300" />Player 2</span>}</div></div>
    <div className="border-y border-white/[.055] bg-[#070a10] p-3 sm:p-5"><div className="relative overflow-hidden rounded-xl border border-white/[.055] bg-[radial-gradient(circle_at_70%_20%,rgba(34,211,238,.08),transparent_34%),linear-gradient(180deg,#090e18,#070910)]">
      <svg role="img" aria-label={`Animated replay with ${preview.pointCount} recorded positions`} viewBox={`0 0 ${width} ${height}`} className="aspect-[2.38/1] w-full">
        <defs>
          <pattern id={`${patternId}-grid`} x={gridX} y={gridY} width={gridSize} height={gridSize} patternUnits="userSpaceOnUse"><path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke="rgba(255,255,255,.045)" strokeWidth="1" /></pattern>
          <linearGradient id={`${patternId}-p1`} x1="0" x2="1"><stop offset="0" stopColor="#6d28d9" stopOpacity="0" /><stop offset="1" stopColor="#c4b5fd" /></linearGradient>
          <linearGradient id={`${patternId}-p2`} x1="0" x2="1"><stop offset="0" stopColor="#0e7490" stopOpacity="0" /><stop offset="1" stopColor="#67e8f9" /></linearGradient>
          <filter id={`${patternId}-glow`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <rect width={width} height={height} fill={`url(#${patternId}-grid)`} />
        <g transform={`translate(${parallaxX} 0)`} opacity=".22">{[-1, 0, 1, 2, 3, 4, 5].map((index) => <g key={index} transform={`translate(${index * 260} 0)`}><path d="M40 322 120 210 200 322Z" fill="#17213a" /><circle cx="188" cy="88" r="3" fill="#67e8f9" /><circle cx="64" cy="140" r="2" fill="#a78bfa" /></g>)}</g>
        {[70, 150, 245, 330].map((y, index) => <line key={y} x1={modulo(-camera.x * (0.32 + index * 0.08), 180) - 180} x2={width + 180} y1={y} y2={y} stroke="rgba(255,255,255,.025)" strokeWidth={index + 1} strokeDasharray="90 110" />)}
        {activePlayers.map(({ point, path }) => {
          const player = point.player;
          const screen = project(point);
          const trail = path.map((item) => { const position = project(item); return `${position.x},${position.y}`; }).join(' ');
          return <g key={player}>
            <polyline points={trail} fill="none" stroke={`url(#${patternId}-${player === 1 ? 'p1' : 'p2'})`} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            <PlayerMarker x={screen.x} y={screen.y} rotation={point.rotation} mode={mode} player={player} glowId={`${patternId}-glow`} />
          </g>;
        })}
        <rect x="0" y={height - 25} width={width} height="25" fill="rgba(8,11,18,.84)" />
        {Array.from({ length: 30 }, (_, index) => <rect key={index} x={modulo(index * 42 - camera.x * worldScale, width + 42) - 42} y={height - 25} width="24" height="3" rx="1.5" fill="rgba(139,92,246,.22)" />)}
      </svg>
      <div className="absolute left-3 top-3 rounded-lg border border-white/[.07] bg-black/35 px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[.14em] text-zinc-400 backdrop-blur">{detectedMode ? MODE_NAMES[mode] : 'Replay marker'} · {speed}×</div>
    </div></div>
    <div className="px-5 py-4 sm:px-6"><div className="flex items-center gap-3"><button type="button" onClick={toggle} aria-label={playing ? 'Pause replay preview' : 'Play replay preview'} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-500 text-white transition hover:bg-violet-400">{playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}</button><button type="button" onClick={restart} aria-label="Restart replay preview" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/[.08] text-zinc-400 transition hover:text-white"><RotateCcw className="h-4 w-4" /></button><span className="w-20 shrink-0 text-center text-[10px] tabular-nums text-zinc-500">{clock(playhead)} / {clock(preview.duration)}</span><input aria-label="Replay preview progress" type="range" min={0} max={preview.duration || 1} step="0.01" value={Math.min(playhead, preview.duration)} onChange={(event) => { const next = Number(event.target.value); playheadRef.current = next; setPlayhead(next); setPlaying(false); }} className="h-1.5 min-w-0 flex-1 accent-violet-400" /><select aria-label="Replay preview speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="h-9 rounded-xl border border-white/[.08] bg-[#11151d] px-2 text-[10px] text-zinc-300 outline-none"><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></div><div className="mt-3 flex flex-wrap justify-between gap-2 text-[10px] text-zinc-600"><span>{preview.pointCount.toLocaleString()} recorded positions</span><span>X {preview.minX.toFixed(1)}–{preview.maxX.toFixed(1)} · Y {preview.minY.toFixed(1)}–{preview.maxY.toFixed(1)}</span></div></div>
  </section>;
}

function PlayerMarker({ x, y, rotation, mode, player, glowId }: { x: number; y: number; rotation: number; mode: PlayerMode; player: 1 | 2; glowId: string }) {
  const color = player === 1 ? '#a78bfa' : '#22d3ee';
  const pale = player === 1 ? '#ddd6fe' : '#cffafe';
  return <g transform={`translate(${x} ${y}) rotate(${rotation})`} filter={`url(#${glowId})`}>
    {mode === 'ship' && <><path d="M-25 10 -14-10 19-5 27 4 12 13Z" fill={color} stroke={pale} strokeWidth="3" /><path d="M-25 1 -38 8 -27 12Z" fill="#fb7185" /><circle cx="7" cy="1" r="5" fill="#071018" stroke={pale} strokeWidth="2" /></>}
    {mode === 'ball' && <><circle r="19" fill={color} stroke={pale} strokeWidth="3" /><path d="M-15 0H15M0-15V15" stroke="#111827" strokeWidth="5" /></>}
    {mode === 'ufo' && <><path d="M-24 5Q0 23 24 5L17 15H-17Z" fill={color} stroke={pale} strokeWidth="3" /><path d="M-13 4Q-10-15 0-15T13 4Z" fill="#111827" stroke={pale} strokeWidth="3" /></>}
    {mode === 'wave' && <><path d="M-24 0 2-18 24 0 2 18Z" fill={color} stroke={pale} strokeWidth="3" /><path d="M-7-7 8 0-7 7Z" fill="#111827" /></>}
    {mode === 'robot' && <><rect x="-18" y="-20" width="36" height="34" rx="6" fill={color} stroke={pale} strokeWidth="3" /><rect x="-12" y="-12" width="7" height="7" rx="2" fill="#111827" /><rect x="5" y="-12" width="7" height="7" rx="2" fill="#111827" /><path d="M-12 14V23M12 14V23" stroke={pale} strokeWidth="6" strokeLinecap="round" /></>}
    {mode === 'spider' && <><circle r="16" fill={color} stroke={pale} strokeWidth="3" /><path d="M-12-10-25-19M12-10 25-19M-15 0-29 0M15 0 29 0M-12 10-25 19M12 10 25 19" stroke={pale} strokeWidth="4" strokeLinecap="round" /></>}
    {mode === 'swing' && <><circle r="19" fill="none" stroke={color} strokeWidth="6" /><circle r="7" fill={pale} /><path d="M-26 0H-19M19 0H26" stroke={pale} strokeWidth="4" /></>}
    {mode === 'cube' && <><rect x="-19" y="-19" width="38" height="38" rx="6" fill={color} stroke={pale} strokeWidth="3" /><rect x="-10" y="-10" width="7" height="7" rx="1.5" fill="#111827" /><rect x="4" y="-10" width="7" height="7" rx="1.5" fill="#111827" /><path d="M-9 8Q0 14 9 8" fill="none" stroke="#111827" strokeWidth="4" strokeLinecap="round" /></>}
  </g>;
}

export function MacroVideoPreview({ url }: { url?: string | null }) {
  const video = useMemo(() => {
    if (!url) return null;
    try { return parsePreviewVideoUrl(url); } catch { return null; }
  }, [url]);
  if (!video) return null;

  return <section className="overflow-hidden rounded-[24px] border border-white/[.075] bg-[#0e1118]"><div className="flex items-center justify-between gap-4 p-6 pb-4"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">Gameplay</p><h2 className="mt-2 flex items-center gap-2 text-lg font-semibold"><PlayCircle className="h-5 w-5 text-violet-300" />Video preview</h2></div><a href={video.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-zinc-500 hover:text-white">Open video<ExternalLink className="h-3 w-3" /></a></div>
    <div className="border-t border-white/[.055] bg-black"><iframe title="Macro gameplay preview" src={video.embedUrl} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" className="aspect-video w-full border-0" /></div>
  </section>;
}
