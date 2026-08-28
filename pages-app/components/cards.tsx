import { ArrowRight, Download, Heart, Timer } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { LevelRow, MacroRow } from '../lib/types';
import { Avatar } from './avatar';

export function LevelCard({ level }: { level: LevelRow }) {
  return <article className="card-hover rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5">
    <div className="flex items-center justify-between gap-3"><Difficulty value={level.demon_difficulty ?? level.difficulty} /><span className="text-[10px] text-zinc-600">#{level.id}</span></div>
    <h3 className="mt-5 truncate text-xl font-semibold">{level.name}</h3><p className="mt-1 text-xs text-zinc-500">by {level.creator}</p>
    <div className="mt-5 flex items-center gap-4 text-[11px] text-zinc-500"><span>{level.macro_count} macros</span><span className="flex items-center gap-1"><Download className="h-3 w-3" />{level.total_downloads.toLocaleString()}</span></div>
    <Link to={`/level/${level.id}`} className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-violet-300 hover:text-violet-200">View macros <ArrowRight className="h-3.5 w-3.5" /></Link>
  </article>;
}

export function MacroCard({ macro, showLevel = true }: { macro: MacroRow; showLevel?: boolean }) {
  return <article className="card-hover rounded-[22px] border border-white/[.075] bg-[#0e1118] p-5">
    <div className="flex items-center justify-between gap-3"><Status value={macro.working_status} /><span className="text-[10px] text-zinc-600">{new Date(macro.created_at).toLocaleDateString()}</span></div>
    <h3 className="mt-4 truncate text-lg font-semibold">{macro.title}</h3>
    {showLevel && <p className="mt-1 truncate text-xs text-zinc-500">{macro.level?.name ?? `Level #${macro.level_id}`}</p>}
    <p className="mt-3 flex items-center gap-2 truncate text-[11px] text-zinc-600"><Avatar profile={macro.uploader} className="h-5 w-5 rounded-md text-[8px]" />@{macro.uploader?.username ?? 'player'}</p>
    <div className="mt-5 grid grid-cols-3 gap-2 text-center"><Metric label="Inputs" value={macro.input_count.toLocaleString()} /><Metric label="Rate" value={macro.rate ? `${macro.rate} ${macro.rate_kind.toUpperCase()}` : '—'} /><Metric label="Time" value={`${macro.duration_seconds.toFixed(1)}s`} /></div>
    <div className="mt-5 flex items-center justify-between"><div className="flex gap-3 text-[11px] text-zinc-500"><span className="flex items-center gap-1"><Download className="h-3 w-3" />{macro.download_count}</span><span className="flex items-center gap-1"><Heart className="h-3 w-3" />{macro.like_count}</span></div><Link to={`/macro/${macro.id}`} className="text-xs font-semibold text-violet-300 hover:text-violet-200">View macro</Link></div>
  </article>;
}

export function Difficulty({ value }: { value: string }) { return <span className="rounded-lg border border-violet-400/15 bg-violet-400/[.08] px-2.5 py-1 text-[10px] font-semibold capitalize text-violet-200">{value.replaceAll('_', ' ')}</span>; }
export function Status({ value }: { value: string }) { const good = value === 'working'; const bad = value === 'broken'; return <span className={`rounded-lg border px-2.5 py-1 text-[10px] font-semibold capitalize ${good ? 'border-emerald-400/15 bg-emerald-400/[.07] text-emerald-200' : bad ? 'border-rose-400/15 bg-rose-400/[.07] text-rose-200' : 'border-amber-400/15 bg-amber-400/[.07] text-amber-200'}`}>{value.replaceAll('_', ' ')}</span>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/[.055] bg-white/[.025] p-2.5"><p className="text-[8px] uppercase tracking-wider text-zinc-600">{label}</p><p className="mt-1 truncate text-[11px] font-semibold text-zinc-300">{value}</p></div>; }

export function Empty({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) { return <div className="rounded-[24px] border border-dashed border-white/[.09] bg-white/[.02] px-6 py-14 text-center"><Timer className="mx-auto h-6 w-6 text-zinc-700" /><h3 className="mt-4 font-semibold">{title}</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">{text}</p>{action && <div className="mt-6">{action}</div>}</div>; }
export function Loading() { return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-60 animate-pulse rounded-[24px] border border-white/[.05] bg-white/[.025]" />)}</div>; }
export function ErrorBox({ message }: { message: string }) { return <div role="alert" className="rounded-2xl border border-rose-400/15 bg-rose-400/[.06] p-4 text-sm text-rose-200">{message}</div>; }
