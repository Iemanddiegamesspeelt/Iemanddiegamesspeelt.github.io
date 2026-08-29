import { Download, Heart, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatGeometryDashVersion } from '../../lib/utils';
import { Difficulty, Empty, ErrorBox, Loading, MacroCard } from '../components/cards';
import { getLevel, listLevelMacros } from '../lib/catalog';
import { isSupabaseConfigured } from '../lib/supabase';
import { useAsync } from '../lib/use-async';

export function LevelPage() {
  const { id = '' } = useParams();
  const [sort, setSort] = useState('downloads');
  const { data, error, loading } = useAsync(async () => {
    if (!isSupabaseConfigured()) return { level: null, macros: [] };
    const [level, macros] = await Promise.all([getLevel(id), listLevelMacros(id)]);
    return { level, macros };
  }, [id]);
  const macros = useMemo(() => [...(data?.macros ?? [])].sort((a, b) => sort === 'likes' ? b.like_count - a.like_count : sort === 'newest' ? Date.parse(b.created_at) - Date.parse(a.created_at) : sort === 'oldest' ? Date.parse(a.created_at) - Date.parse(b.created_at) : b.download_count - a.download_count), [data, sort]);
  if (loading) return <main className="mx-auto max-w-7xl px-5 py-12 lg:px-8"><Loading /></main>;
  if (error) return <main className="mx-auto max-w-4xl px-5 py-12"><ErrorBox message={error} /></main>;
  if (!data?.level) return <main className="mx-auto max-w-4xl px-5 py-12"><Empty title="Level not found" text="This level has no published macros, or it does not exist." /></main>;
  const level = data.level;
  return <main className="mx-auto min-h-[75vh] max-w-7xl px-5 py-12 lg:px-8"><section className="relative overflow-hidden rounded-[28px] border border-white/[.075] bg-[#0e1118] p-6 sm:p-9"><div className="surface-grid pointer-events-none absolute inset-0 opacity-35" /><div className="relative"><div className="flex flex-wrap items-center gap-3"><Difficulty value={level.demon_difficulty ?? level.difficulty} /><span className="text-xs text-zinc-600">Level #{level.id}</span></div><h1 className="mt-5 text-4xl font-semibold tracking-[-.05em] sm:text-6xl">{level.name}</h1><p className="mt-2 text-sm text-zinc-500">by {level.creator}</p><div className="mt-7 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Macros" value={String(macros.length)} /><Metric icon={Download} label="Downloads" value={level.total_downloads.toLocaleString()} /><Metric icon={Star} label="Stars" value={level.stars?.toString() ?? 'Unknown'} /><Metric label="Length" value={level.length} /></div>{level.gd_version && <p className="mt-5 text-xs text-zinc-600">Geometry Dash {formatGeometryDashVersion(level.gd_version)}</p>}</div></section>
    <section className="mt-10"><div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-semibold">Macros for this level</h2><p className="mt-1 text-xs text-zinc-600">Choose a replay and download the format you want.</p></div><label className="flex items-center gap-2 text-xs text-zinc-500">Sort<select value={sort} onChange={(event) => setSort(event.target.value)} className="h-10 rounded-xl border border-white/[.075] bg-[#11151d] px-3 text-xs text-zinc-300"><option value="downloads">Most downloaded</option><option value="likes">Most liked</option><option value="newest">Newest</option><option value="oldest">Oldest</option></select></label></div>{macros.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{macros.map((macro) => <MacroCard key={macro.id} macro={macro} showLevel={false} />)}</div> : <Empty title="No macros yet" text="No macro is currently published for this level." />}</section>
  </main>;
}

function Metric({ icon: Icon, label, value }: { icon?: typeof Heart; label: string; value: string }) { return <div className="rounded-xl border border-white/[.06] bg-white/[.025] p-3"><p className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-zinc-600">{Icon && <Icon className="h-3 w-3" />}{label}</p><p className="mt-1.5 truncate text-sm font-semibold text-zinc-200">{value}</p></div>; }
