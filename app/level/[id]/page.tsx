import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MacroCard } from '../../../components/macro/macro-card';
import { EmptyState } from '../../../components/ui/empty-state';
import { findLevelRecord, listMacroRecordsForLevel, listProfileRecords } from '../../../lib/data/repository';
import { compactNumber } from '../../../lib/utils';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const level = await findLevelRecord(id);
  return { title: level ? `${level.name} macros` : 'Level not found', description: level ? `Geometry Dash macros for ${level.name} by ${level.creator}.` : undefined };
}

export default async function LevelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sort?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [level, macros, profiles] = await Promise.all([
    findLevelRecord(id),
    listMacroRecordsForLevel(id),
    listProfileRecords(),
  ]);
  if (!level) notFound();
  const sort = query.sort ?? 'downloads';
  macros.sort((a, b) => sort === 'likes'
    ? b.likeCount - a.likeCount
    : sort === 'newest'
      ? Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt)
      : sort === 'oldest'
        ? Date.parse(a.uploadedAt) - Date.parse(b.uploadedAt)
        : b.downloadCount - a.downloadCount);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const difficulty = level.demonDifficulty ? `${level.demonDifficulty} Demon` : level.difficulty;
  return (
    <main className="mx-auto min-h-[75vh] max-w-7xl px-5 py-12 lg:px-8">
      <section className="relative overflow-hidden rounded-[28px] border border-white/[.075] bg-[#0e1118] p-6 sm:p-9">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_0%,rgba(124,92,255,.15),transparent_35%)]" />
        <div className="relative">
          <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">{difficulty}</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">{level.name}</h1>
          <p className="mt-2 text-sm text-zinc-500">by {level.creator} · Level #{level.id}</p>
          <dl className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:max-w-3xl">
            <Metric label="Stars" value={level.stars === undefined ? 'Unknown' : String(level.stars)} />
            <Metric label="Length" value={level.length} />
            <Metric label="GD version" value={level.gdVersion ?? 'Unknown'} />
            <Metric label="Downloads" value={compactNumber(level.totalDownloads)} />
          </dl>
        </div>
      </section>

      <section className="mt-10">
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">{macros.length} macros</p><h2 className="mt-2 text-2xl font-semibold">Community replays</h2></div>
          <form className="flex items-center gap-2"><label className="text-[10px] text-zinc-600" htmlFor="sort">Sort</label><select id="sort" name="sort" defaultValue={sort} className="h-10 rounded-xl border border-white/[.08] bg-[#11151d] px-3 text-xs text-zinc-300"><option value="downloads">Most downloaded</option><option value="likes">Most liked</option><option value="newest">Newest</option><option value="oldest">Oldest</option></select><button className="h-10 rounded-xl bg-white/[.06] px-3 text-xs hover:bg-white/[.1]">Apply</button></form>
        </div>
        {macros.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{macros.map((macro) => { const uploader = profileById.get(macro.uploaderId); return uploader ? <MacroCard key={macro.id} macro={macro} uploader={uploader} /> : null; })}</div> : <EmptyState title="No macros available" description="Upload a macro for this level to add it here." action={<Link href="/upload" className="rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-semibold hover:bg-violet-400">Upload a macro</Link>} />}
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/[.06] bg-white/[.025] p-3"><dt className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</dt><dd className="mt-1.5 text-sm font-semibold text-zinc-200">{value}</dd></div>;
}
