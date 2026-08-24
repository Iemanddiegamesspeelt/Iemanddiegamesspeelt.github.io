'use client';

import Link from 'next/link';
import { ArrowRight, FileSearch, Repeat2, Upload, Wrench } from 'lucide-react';
import type { LevelRecord, MacroRecord, ProfileRecord } from '../../lib/data/types';
import { SearchBox } from '../ui/search-box';
import { EmptyState } from '../ui/empty-state';
import { SectionHeader } from '../ui/section-header';
import { LevelCard } from '../level/level-card';
import { MacroCard } from '../macro/macro-card';

export function HomeContent({ levels, macros, profiles }: { levels: LevelRecord[]; macros: MacroRecord[]; profiles: ProfileRecord[] }) {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const levelById = new Map(levels.map((level) => [level.id, level]));
  const recent = [...macros].sort((a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt)).slice(0, 6);
  const downloaded = [...macros].sort((a, b) => b.downloadCount - a.downloadCount).slice(0, 6);
  const liked = [...macros].sort((a, b) => b.likeCount - a.likeCount).slice(0, 6);
  const popularLevels = [...levels].sort((a, b) => b.totalDownloads - a.totalDownloads).slice(0, 6);

  return (
    <main className="overflow-hidden">
      <section className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[620px] bg-[radial-gradient(circle_at_50%_-12%,rgba(111,87,255,.26),transparent_46%),radial-gradient(circle_at_82%_25%,rgba(32,211,164,.1),transparent_25%)]" />
        <div className="surface-grid pointer-events-none absolute inset-x-0 top-0 h-[560px] opacity-50" />
        <div className="relative mx-auto max-w-7xl px-5 pb-20 pt-20 text-center sm:pb-28 sm:pt-28 lg:px-8">
          <div className="mx-auto mb-7 inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/[.08] px-3.5 py-1.5 text-[11px] font-medium text-violet-200">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
            Community macro library
          </div>
          <h1 className="mx-auto max-w-4xl text-balance text-5xl font-semibold leading-[1.03] tracking-[-.055em] text-white sm:text-7xl">
            Find the perfect <span className="bg-gradient-to-r from-violet-300 via-violet-500 to-cyan-300 bg-clip-text text-transparent">Geometry Dash macro</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-base leading-7 text-zinc-400 sm:text-lg">
            Browse community replays by level, creator, replay tool, or file format.
          </p>
          <SearchBox large className="mx-auto mt-10 max-w-3xl text-left" />
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link href="/upload" className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-500 px-5 text-sm font-semibold transition hover:bg-violet-400">
              <Upload className="h-4 w-4" /> Upload a macro
            </Link>
            <Link href="/converter" className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/[.09] bg-white/[.045] px-5 text-sm font-semibold text-zinc-200 transition hover:bg-white/[.08]">
              <Repeat2 className="h-4 w-4" /> Open converter
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl space-y-20 px-5 pb-24 lg:px-8">
        {!macros.length ? (
          <div>
            <SectionHeader eyebrow="Community library" title="Latest macros" />
            <EmptyState
              icon={FileSearch}
              title="No macros have been published yet"
              description="Share a macro with the community and help build the library."
              action={<Link href="/upload" className="inline-flex items-center gap-2 rounded-xl bg-white/[.07] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-white/[.11]">Upload a macro <ArrowRight className="h-3.5 w-3.5" /></Link>}
            />
          </div>
        ) : (
          <>
            <MacroSection title="Trending macros" eyebrow="Popular now" items={liked} profileById={profileById} levelById={levelById} />
            <MacroSection title="Recently uploaded" eyebrow="New replays" items={recent} profileById={profileById} levelById={levelById} />
            <MacroSection title="Most downloaded" eyebrow="Community favorites" items={downloaded} profileById={profileById} levelById={levelById} />
            <div>
              <SectionHeader eyebrow="Explore levels" title="Popular levels" href="/browse" actionLabel="Browse all" />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{popularLevels.map((level) => <LevelCard key={level.id} level={level} />)}</div>
            </div>
          </>
        )}
      </section>

      <section className="border-y border-white/[.055] bg-white/[.018]">
        <div className="mx-auto grid max-w-7xl gap-5 px-5 py-20 md:grid-cols-3 lg:px-8">
          {[
            { icon: FileSearch, title: 'Find by level', copy: 'Search level names, IDs, creators, uploaders, and macro titles.' },
            { icon: Wrench, title: 'Choose your replay tool', copy: 'Narrow the available files to options that match the setup you use.' },
            { icon: Repeat2, title: 'Bring your own macro', copy: 'Open a local replay and view its details and available file options.' },
          ].map((item) => (
            <article key={item.title} className="rounded-[22px] border border-white/[.07] bg-[#0d1016] p-6">
              <span className="grid h-11 w-11 place-items-center rounded-2xl border border-violet-400/15 bg-violet-400/[.08] text-violet-300"><item.icon className="h-5 w-5" /></span>
              <h3 className="mt-5 font-semibold text-white">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-500">{item.copy}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function MacroSection({ title, eyebrow, items, profileById, levelById }: { title: string; eyebrow: string; items: MacroRecord[]; profileById: Map<string, ProfileRecord>; levelById: Map<string, LevelRecord> }) {
  return (
    <div>
      <SectionHeader eyebrow={eyebrow} title={title} href="/browse" actionLabel="Browse all" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((macro) => {
          const uploader = profileById.get(macro.uploaderId);
          if (!uploader) return null;
          return <MacroCard key={macro.id} macro={macro} uploader={uploader} level={levelById.get(macro.levelId)} showLevel />;
        })}
      </div>
    </div>
  );
}
