'use client';

import Link from 'next/link';
import { ArrowRight, Download, Layers3 } from 'lucide-react';
import type { LevelRecord } from '../../lib/data/types';
import { compactNumber, cn } from '../../lib/utils';

const accentStyles = {
  violet: 'from-violet-500/20 via-violet-500/[.06] to-transparent text-violet-300',
  cyan: 'from-cyan-500/20 via-cyan-500/[.06] to-transparent text-cyan-300',
  rose: 'from-rose-500/20 via-rose-500/[.06] to-transparent text-rose-300',
  amber: 'from-amber-500/20 via-amber-500/[.06] to-transparent text-amber-300',
  emerald: 'from-emerald-500/20 via-emerald-500/[.06] to-transparent text-emerald-300',
  blue: 'from-blue-500/20 via-blue-500/[.06] to-transparent text-blue-300',
};

export function LevelCard({
  level,
  macroCount,
  downloads,
  compact = false,
}: {
  level: LevelRecord;
  macroCount?: number;
  downloads?: number;
  compact?: boolean;
}) {
  const label = level.demonDifficulty ? `${level.demonDifficulty} Demon` : level.difficulty;
  return (
    <article className={cn('card-hover group relative overflow-hidden rounded-[22px] border border-white/[.075] bg-[#0e1118]', compact ? 'p-4' : 'p-5')}>
      <div className={cn('pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-br opacity-70', accentStyles[level.accent])} />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[.14em] text-zinc-500">
              <span className={cn('h-1.5 w-1.5 rounded-full', level.accent === 'rose' ? 'bg-rose-400' : level.accent === 'cyan' ? 'bg-cyan-400' : 'bg-violet-400')} />
              {label}
            </span>
            <h3 className={cn('mt-3 truncate font-semibold tracking-[-.025em] text-white', compact ? 'text-lg' : 'text-xl')}>{level.name}</h3>
            <p className="mt-1 truncate text-xs text-zinc-500">by {level.creator} · #{level.id}</p>
          </div>
          <span className={cn('grid shrink-0 rotate-3 place-items-center rounded-2xl border border-white/10 bg-gradient-to-br', compact ? 'h-11 w-11' : 'h-13 w-13', accentStyles[level.accent])}>
            <span className="h-4 w-4 rotate-12 rounded-[5px] border-2 border-current" />
          </span>
        </div>
        <div className={cn('mt-7 grid grid-cols-2 gap-3 border-t border-white/[.065] pt-4', compact && 'mt-5')}>
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Layers3 className="h-3.5 w-3.5 text-zinc-600" />
            <strong className="font-semibold text-zinc-200">{macroCount ?? level.macroCount}</strong> macros
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Download className="h-3.5 w-3.5 text-zinc-600" />
            <strong className="font-semibold text-zinc-200">{compactNumber(downloads ?? level.totalDownloads)}</strong>
          </div>
        </div>
        <Link href={`/level/${level.id}`} className="mt-5 flex items-center justify-between rounded-xl border border-white/[.07] bg-white/[.035] px-3.5 py-2.5 text-xs font-semibold text-zinc-300 transition group-hover:border-violet-400/20 group-hover:bg-violet-400/[.07] group-hover:text-violet-200">
          View macros
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </article>
  );
}
