'use client';

import Link from 'next/link';
import { Filter, RotateCcw, SearchX, SlidersHorizontal, Upload } from 'lucide-react';
import type { LevelRecord } from '../../lib/data/types';
import { LevelCard } from './level-card';
import { SearchBox } from '../ui/search-box';
import { EmptyState } from '../ui/empty-state';

type Result = {
  level: LevelRecord;
  matchingMacroCount: number;
  matchingDownloads: number;
  matchingLikes: number;
};

export function BrowseClient({
  query,
  filters,
  items,
  total,
  page,
  totalPages,
  formats,
  tools,
}: {
  query: string;
  filters: Record<string, string>;
  items: Result[];
  total: number;
  page: number;
  totalPages: number;
  formats: Array<{ id: string; label: string }>;
  tools: Array<{ id: string; label: string }>;
}) {
  return (
    <main className="mx-auto min-h-[70vh] max-w-7xl px-5 py-10 lg:px-8">
      <div className="mb-9">
        <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-300">Macro database</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">Browse macros</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">Search by level, creator, uploader, or title.</p>
        <SearchBox defaultValue={query} autoFocus={filters.focus === 'search'} className="mt-7 max-w-3xl" />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-[22px] border border-white/[.07] bg-[#0d1016] p-4 lg:sticky lg:top-24">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="h-4 w-4 text-violet-300" /> Filters</h2>
            <Link href="/browse" className="inline-flex items-center gap-1 text-[10px] text-zinc-600 hover:text-white"><RotateCcw className="h-3 w-3" /> Reset</Link>
          </div>
          <form action="/browse" className="space-y-4">
            <input type="hidden" name="q" value={query} />
            <FilterSelect label="Difficulty" name="difficulty" value={filters.difficulty} options={['Easy', 'Normal', 'Hard', 'Harder', 'Insane', 'Demon']} />
            <FilterSelect label="Demon difficulty" name="demonDifficulty" value={filters.demonDifficulty} options={['Easy', 'Medium', 'Hard', 'Insane', 'Extreme']} />
            <FilterSelect label="Length" name="length" value={filters.length} options={['Tiny', 'Short', 'Medium', 'Long', 'XL', 'Platformer']} />
            <FilterSelect label="TPS / FPS" name="rate" value={filters.rate} options={['60', '120', '240', '360', '480']} />
            <FilterSelect label="GD version" name="gdVersion" value={filters.gdVersion} options={['2.2', '2.1', '2.0']} />
            <FilterSelect label="Macro format" name="format" value={filters.format} options={formats.map((item) => item.id)} labels={Object.fromEntries(formats.map((item) => [item.id, item.label]))} />
            <FilterSelect label="Replay tool" name="replayTool" value={filters.replayTool} options={tools.map((item) => item.id)} labels={Object.fromEntries(tools.map((item) => [item.id, item.label]))} />
            <FilterSelect label="Working status" name="status" value={filters.status} options={['Working', 'Unverified', 'Possibly outdated', 'Broken']} />
            <FilterSelect label="Sort" name="sort" value={filters.sort || 'newest'} options={['newest', 'oldest', 'downloads', 'likes']} labels={{ newest: 'Newest', oldest: 'Oldest', downloads: 'Most downloaded', likes: 'Most liked' }} allLabel={null} />
            <button type="submit" className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-violet-500 text-xs font-semibold transition hover:bg-violet-400">
              <Filter className="h-3.5 w-3.5" />
              Apply filters
            </button>
          </form>
        </aside>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs text-zinc-500"><strong className="font-semibold text-zinc-200">{total}</strong> levels</p>
          </div>
          {items.length ? (
            <div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((item) => (
                  <LevelCard key={item.level.id} level={item.level} macroCount={item.matchingMacroCount} downloads={item.matchingDownloads} compact />
                ))}
              </div>
              {totalPages > 1 && (
                <nav aria-label="Browse pages" className="mt-7 flex items-center justify-center gap-3">
                  <Link aria-disabled={page <= 1} href={page <= 1 ? '#' : pageHref(page - 1, query, filters)} className={`rounded-xl border border-white/[.08] px-4 py-2 text-xs ${page <= 1 ? 'pointer-events-none text-zinc-700' : 'text-zinc-300 hover:bg-white/[.05]'}`}>Previous</Link>
                  <span className="text-xs text-zinc-600">Page {page} of {totalPages}</span>
                  <Link aria-disabled={page >= totalPages} href={page >= totalPages ? '#' : pageHref(page + 1, query, filters)} className={`rounded-xl border border-white/[.08] px-4 py-2 text-xs ${page >= totalPages ? 'pointer-events-none text-zinc-700' : 'text-zinc-300 hover:bg-white/[.05]'}`}>Next</Link>
                </nav>
              )}
            </div>
          ) : (
            <EmptyState
              icon={SearchX}
              title="No levels or macros yet"
              description={query || Object.values(filters).some(Boolean) ? 'No macros match this search. Try clearing the filters.' : 'Upload a macro to add the first level to MacroHub.'}
              action={
                <Link href="/upload" className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-semibold hover:bg-violet-400">
                  <Upload className="h-3.5 w-3.5" />
                  Upload a macro
                </Link>
              }
            />
          )}
        </section>
      </div>
    </main>
  );
}

function pageHref(page: number, query: string, filters: Record<string, string>) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  for (const [key, value] of Object.entries(filters)) if (value && key !== 'focus') params.set(key, value);
  params.set('page', String(page));
  return `/browse?${params}`;
}

function FilterSelect({
  label,
  name,
  value,
  options,
  labels,
  allLabel = 'All',
}: {
  label: string;
  name: string;
  value?: string;
  options: string[];
  labels?: Record<string, string>;
  allLabel?: string | null;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-medium text-zinc-500">{label}</span>
      <select name={name} defaultValue={value ?? ''} className="h-10 w-full rounded-xl border border-white/[.075] bg-[#11151d] px-3 text-xs text-zinc-300 outline-none focus:border-violet-400/40">
        {allLabel !== null && <option value="">{allLabel}</option>}
        {options.map((option) => <option key={option} value={option}>{labels?.[option] ?? option}</option>)}
      </select>
    </label>
  );
}
