import { Search, SlidersHorizontal, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Empty, ErrorBox, LevelCard, Loading } from '../components/cards';
import { listMacros } from '../lib/catalog';
import { formatGeometryDashVersion } from '../../lib/utils';
import { isSupabaseConfigured } from '../lib/supabase';
import { useAsync } from '../lib/use-async';

export function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const { data: macros, error, loading } = useAsync(() => isSupabaseConfigured() ? listMacros(500) : Promise.resolve([]), []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const status = params.get('status') ?? '';
    const difficulty = params.get('difficulty') ?? '';
    const length = params.get('length') ?? '';
    const rate = params.get('rate') ?? '';
    const gdVersion = params.get('gd') ?? '';
    const sort = params.get('sort') ?? 'newest';
    const result = (macros ?? []).filter((macro) => {
      if (q && ![macro.title, macro.level?.name, macro.level?.id, macro.level?.creator, macro.uploader?.username, macro.uploader?.display_name].some((value) => value?.toLowerCase().includes(q))) return false;
      if (status && macro.working_status !== status) return false;
      if (difficulty && (macro.level?.demon_difficulty ?? macro.level?.difficulty)?.toLowerCase() !== difficulty) return false;
      if (length && macro.level?.length.toLowerCase() !== length) return false;
      if (rate && `${macro.rate_kind}:${macro.rate}` !== rate) return false;
      if (gdVersion && (macro.recorded_gd_version ?? macro.level?.gd_version) !== gdVersion) return false;
      return true;
    });
    result.sort((a, b) => sort === 'oldest' ? Date.parse(a.created_at) - Date.parse(b.created_at) : sort === 'downloads' ? b.download_count - a.download_count : sort === 'likes' ? b.like_count - a.like_count : Date.parse(b.created_at) - Date.parse(a.created_at));
    return result;
  }, [macros, query, params]);
  const grouped = useMemo(() => {
    const byLevel = new Map<string, typeof filtered>();
    for (const macro of filtered) {
      const group = byLevel.get(macro.level_id) ?? [];
      group.push(macro);
      byLevel.set(macro.level_id, group);
    }
    return [...byLevel.values()].flatMap((group) => {
      const level = group[0]?.level;
      if (!level) return [];
      return [{ ...level, macro_count: group.length, total_downloads: group.reduce((total, macro) => total + macro.download_count, 0) }];
    });
  }, [filtered]);
  function set(name: string, value: string) { const next = new URLSearchParams(params); if (value) next.set(name, value); else next.delete(name); if (name === 'q') setQuery(value); setParams(next); }
  return <main className="mx-auto min-h-[75vh] max-w-7xl px-5 py-12 lg:px-8"><header className="max-w-3xl"><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-300">Macro database</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">Browse macros</h1><p className="mt-3 text-sm text-zinc-500">Search the catalog and narrow results by level or replay details.</p></header>
    <div className="mt-8 grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]"><aside className="space-y-4 rounded-[24px] border border-white/[.075] bg-[#0e1118] p-4 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto"><p className="flex items-center gap-2 text-xs font-semibold"><SlidersHorizontal className="h-4 w-4 text-violet-300" />Filters</p><Select label="Difficulty" value={params.get('difficulty') ?? ''} onChange={(v) => set('difficulty', v)} options={[...new Set((macros ?? []).flatMap((m) => m.level ? [(m.level.demon_difficulty ?? m.level.difficulty).toLowerCase()] : []))].sort().map((v) => [v, v.replaceAll('_', ' ')])} /><Select label="Level length" value={params.get('length') ?? ''} onChange={(v) => set('length', v)} options={[...new Set((macros ?? []).flatMap((m) => m.level ? [m.level.length.toLowerCase()] : []))].sort().map((v) => [v, v])} /><Select label="TPS / FPS" value={params.get('rate') ?? ''} onChange={(v) => set('rate', v)} options={[...new Set((macros ?? []).flatMap((m) => m.rate ? [`${m.rate_kind}:${m.rate}`] : []))].sort().map((v) => { const [kind, number] = v.split(':'); return [v, `${number} ${kind.toUpperCase()}`]; })} /><Select label="GD version" value={params.get('gd') ?? ''} onChange={(v) => set('gd', v)} options={[...new Set((macros ?? []).flatMap((m) => m.recorded_gd_version ?? m.level?.gd_version ? [m.recorded_gd_version ?? m.level!.gd_version!] : []))].sort().map((v) => [v, formatGeometryDashVersion(v)])} /><Select label="Status" value={params.get('status') ?? ''} onChange={(v) => set('status', v)} options={['working','unverified','possibly_outdated','broken'].map((v) => [v, v.replaceAll('_',' ')])} /><Select label="Sort" value={params.get('sort') ?? 'newest'} onChange={(v) => set('sort', v)} options={['newest','oldest','downloads','likes'].map((v) => [v, v])} /></aside>
      <section><div className="flex items-center gap-2 rounded-2xl border border-white/[.08] bg-[#0e1118] p-2"><Search className="ml-2 h-4 w-4 text-zinc-600" /><input list="macro-suggestions" value={query} onChange={(event) => { setQuery(event.target.value); set('q', event.target.value); }} className="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none" placeholder="Search level, creator, uploader, or title" /><datalist id="macro-suggestions">{[...new Set((macros ?? []).flatMap((macro) => [macro.title, macro.level?.name, macro.level?.id, macro.level?.creator, macro.uploader?.username].filter((value): value is string => Boolean(value))))].slice(0, 80).map((value) => <option key={value} value={value} />)}</datalist></div><p className="my-5 text-xs text-zinc-600">{grouped.length} level{grouped.length === 1 ? '' : 's'} · {filtered.length} macro{filtered.length === 1 ? '' : 's'}</p>{error && <ErrorBox message={error} />}{loading ? <Loading /> : grouped.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{grouped.map((level) => <LevelCard key={level.id} level={level} />)}</div> : <Empty title="No macros found" text="Try clearing filters, or upload the first matching macro." action={<Link to="/upload" className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-semibold"><Upload className="h-3.5 w-3.5" />Upload a macro</Link>} />}</section>
    </div></main>;
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) { return <label className="block"><span className="mb-2 block text-[10px] font-medium text-zinc-500">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-xl border border-white/[.075] bg-[#11151d] px-3 text-xs capitalize text-zinc-300 outline-none"><option value="">All</option>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>; }
