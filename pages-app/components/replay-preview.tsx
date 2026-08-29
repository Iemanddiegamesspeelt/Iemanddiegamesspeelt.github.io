import { ExternalLink, PlayCircle } from 'lucide-react';
import { useMemo } from 'react';
import type { CanonicalReplayV1 } from '../../lib/replay/types';
import { parsePreviewVideoUrl } from '../lib/preview-video';

type PositionPoint = { x: number; y: number; tick: string; player: 1 | 2 };

function sampled(points: PositionPoint[], limit = 1400) {
  if (points.length <= limit) return points;
  const step = (points.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => points[Math.round(index * step)]!);
}

export function ReplayPathPreview({ replay }: { replay: CanonicalReplayV1 }) {
  const preview = useMemo(() => {
    const points = replay.events.flatMap((event): PositionPoint[] => event.kind === 'player-state' && Number.isFinite(event.x) && Number.isFinite(event.y)
      ? [{ x: event.x!, y: event.y!, tick: event.tick, player: event.player }]
      : []);
    if (!points.length) return null;

    const players = {
      1: sampled(points.filter((point) => point.player === 1)),
      2: sampled(points.filter((point) => point.player === 2)),
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
    const xRange = Math.max(maxX - minX, 1);
    const yRange = Math.max(maxY - minY, 1);
    const width = 1000;
    const height = 360;
    const padding = 34;
    const project = (point: PositionPoint) => `${padding + ((point.x - minX) / xRange) * (width - padding * 2)},${height - padding - ((point.y - minY) / yRange) * (height - padding * 2)}`;
    return { players, pointCount: points.length, minX, maxX, minY, maxY, width, height, project };
  }, [replay]);

  if (!preview) return null;
  return <section className="overflow-hidden rounded-[24px] border border-white/[.075] bg-[#0e1118]">
    <div className="flex flex-wrap items-start justify-between gap-3 p-6 pb-4"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-cyan-300">Position data found</p><h2 className="mt-2 text-lg font-semibold">Movement path</h2></div><div className="flex items-center gap-3 text-[10px] text-zinc-500">{preview.players[1].length > 0 && <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-violet-300" />Player 1</span>}{preview.players[2].length > 0 && <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-cyan-300" />Player 2</span>}</div></div>
    <div className="border-y border-white/[.055] bg-[#090c12] p-3 sm:p-5"><svg role="img" aria-label={`Replay movement path with ${preview.pointCount} position samples`} viewBox={`0 0 ${preview.width} ${preview.height}`} className="aspect-[2.78/1] w-full overflow-visible rounded-xl">
      <defs><pattern id="macro-path-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(255,255,255,.055)" strokeWidth="1" /></pattern><linearGradient id="macro-p1-path" x1="0" x2="1"><stop offset="0" stopColor="#8b5cf6" /><stop offset="1" stopColor="#c4b5fd" /></linearGradient><linearGradient id="macro-p2-path" x1="0" x2="1"><stop offset="0" stopColor="#0891b2" /><stop offset="1" stopColor="#67e8f9" /></linearGradient></defs>
      <rect width={preview.width} height={preview.height} rx="16" fill="url(#macro-path-grid)" />
      {([1, 2] as const).map((player) => { const path = preview.players[player]; if (!path.length) return null; const start = preview.project(path[0]!); const end = preview.project(path.at(-1)!); return <g key={player}><polyline points={path.map(preview.project).join(' ')} fill="none" stroke={player === 1 ? 'url(#macro-p1-path)' : 'url(#macro-p2-path)'} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity=".9" /><circle cx={start.split(',')[0]} cy={start.split(',')[1]} r="7" fill="#090c12" stroke={player === 1 ? '#a78bfa' : '#22d3ee'} strokeWidth="3" /><circle cx={end.split(',')[0]} cy={end.split(',')[1]} r="8" fill={player === 1 ? '#c4b5fd' : '#67e8f9'} /></g>; })}
    </svg></div>
    <div className="flex flex-wrap justify-between gap-2 px-6 py-4 text-[10px] text-zinc-600"><span>{preview.pointCount.toLocaleString()} recorded positions</span><span>X {preview.minX.toFixed(1)}–{preview.maxX.toFixed(1)} · Y {preview.minY.toFixed(1)}–{preview.maxY.toFixed(1)}</span></div>
  </section>;
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
