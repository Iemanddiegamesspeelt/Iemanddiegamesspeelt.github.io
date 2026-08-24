'use client';

import Link from '../ui/native-link';
import { ArrowRight, Globe2, Lock, Layers3 } from 'lucide-react';
import type { CollectionRecord } from '../../lib/data/types';
import { formatDate } from '../../lib/utils';

const tones = {
  violet: 'from-violet-500/20 to-transparent text-violet-300',
  cyan: 'from-cyan-500/20 to-transparent text-cyan-300',
  rose: 'from-rose-500/20 to-transparent text-rose-300',
  amber: 'from-amber-500/20 to-transparent text-amber-300',
};

export function CollectionCard({ collection, ownerName }: { collection: CollectionRecord; ownerName?: string }) {
  const PrivateIcon = collection.visibility === 'private' ? Lock : Globe2;
  return (
    <article className="card-hover relative overflow-hidden rounded-[22px] border border-white/[.075] bg-[#0e1118] p-5">
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-br ${tones[collection.accent]}`} />
      <div className="relative">
        <div className="flex items-center justify-between"><span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/[.08] bg-white/[.045]"><Layers3 className="h-5 w-5" /></span><span className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-zinc-600"><PrivateIcon className="h-3 w-3" /> {collection.visibility}</span></div>
        <h2 className="mt-5 truncate text-lg font-semibold">{collection.name}</h2>
        <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-zinc-500">{collection.description || 'A MacroHub collection.'}</p>
        <div className="mt-5 flex items-center justify-between text-[10px] text-zinc-600"><span>{collection.macroIds.length} macros{ownerName ? ` · by ${ownerName}` : ''}</span><span>{formatDate(collection.updatedAt)}</span></div>
        <Link href={`/collection/${collection.id}`} className="mt-4 flex h-10 items-center justify-between rounded-xl bg-white/[.055] px-3.5 text-xs font-semibold text-zinc-300 hover:bg-white/[.09]">Open collection <ArrowRight className="h-3.5 w-3.5" /></Link>
      </div>
    </article>
  );
}
