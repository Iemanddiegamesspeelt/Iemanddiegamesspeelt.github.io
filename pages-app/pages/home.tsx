import { ArrowRight, Search, Upload, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, ErrorBox, LevelCard, Loading, MacroCard } from '../components/cards';
import { isSupabaseConfigured } from '../lib/supabase';
import { listLevels, listMacros } from '../lib/catalog';
import { useAsync } from '../lib/use-async';

export function HomePage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const { data, error, loading } = useAsync(async () => {
    if (!isSupabaseConfigured()) return { macros: [], levels: [] };
    const [macros, levels] = await Promise.all([listMacros(12), listLevels(6)]);
    return { macros, levels };
  }, []);
  const recent = data?.macros.slice(0, 6) ?? [];
  const popular = useMemo(() => [...(data?.macros ?? [])].sort((a, b) => b.download_count - a.download_count).slice(0, 3), [data]);
  function search(event: React.FormEvent) { event.preventDefault(); navigate(query.trim() ? `/browse?q=${encodeURIComponent(query.trim())}` : '/browse'); }
  return <main>
    <section className="relative overflow-hidden border-b border-white/[.055]"><div className="surface-grid pointer-events-none absolute inset-0 opacity-60" /><div className="relative mx-auto max-w-7xl px-5 py-20 text-center sm:py-28 lg:px-8">
      <p className="text-[10px] font-semibold uppercase tracking-[.24em] text-violet-300">Geometry Dash replay library</p>
      <h1 className="mx-auto mt-5 max-w-4xl text-5xl font-semibold tracking-[-.06em] sm:text-7xl">Find the perfect <span className="bg-gradient-to-r from-violet-300 to-cyan-300 bg-clip-text text-transparent">Geometry Dash macro</span></h1>
      <p className="mx-auto mt-6 max-w-2xl text-sm leading-7 text-zinc-500 sm:text-base">Search community macros by level, creator, uploader, or ID. Filter every download for the replay tool you use.</p>
      <form onSubmit={search} className="mx-auto mt-9 flex max-w-2xl items-center gap-2 rounded-2xl border border-white/[.09] bg-[#0e1118] p-2 shadow-2xl shadow-violet-950/15"><Search className="ml-3 h-5 w-5 text-zinc-600" /><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search macros" placeholder="Level name, ID, creator, uploader…" className="h-12 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-zinc-700" /><button className="h-11 rounded-xl bg-violet-500 px-5 text-xs font-semibold hover:bg-violet-400">Search</button></form>
      <div className="mt-6 flex flex-wrap justify-center gap-3"><Link to="/upload" className="inline-flex items-center gap-2 rounded-xl bg-white/[.07] px-4 py-3 text-xs font-semibold hover:bg-white/[.11]"><Upload className="h-4 w-4" />Upload a macro</Link><Link to="/converter" className="inline-flex items-center gap-2 rounded-xl border border-violet-400/20 bg-violet-400/[.07] px-4 py-3 text-xs font-semibold text-violet-200 hover:bg-violet-400/[.12]"><Wrench className="h-4 w-4" />Open converter</Link></div>
    </div></section>
    <div className="mx-auto max-w-7xl space-y-16 px-5 py-14 lg:px-8">
      {error && <ErrorBox message={error} />}
      <Section title="Recently uploaded" link="/browse?sort=newest">{loading ? <Loading /> : recent.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{recent.map((macro) => <MacroCard key={macro.id} macro={macro} />)}</div> : <Empty title="No macros yet" text="The first published macro will appear here." action={<Link to="/upload" className="rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-semibold">Upload a macro</Link>} />}</Section>
      {popular.length > 0 && <Section title="Most downloaded" link="/browse?sort=downloads"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{popular.map((macro) => <MacroCard key={macro.id} macro={macro} />)}</div></Section>}
      {(data?.levels.length ?? 0) > 0 && <Section title="Popular levels" link="/browse"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{data!.levels.map((level) => <LevelCard key={level.id} level={level} />)}</div></Section>}
    </div>
  </main>;
}

function Section({ title, link, children }: { title: string; link: string; children: React.ReactNode }) { return <section><div className="mb-6 flex items-center justify-between"><h2 className="text-2xl font-semibold tracking-tight">{title}</h2><Link to={link} className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-white">View all <ArrowRight className="h-3.5 w-3.5" /></Link></div>{children}</section>; }
