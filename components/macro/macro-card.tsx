'use client';

import Link from 'next/link';
import { ArrowRight, Download, Gauge, Heart, MousePointerClick } from 'lucide-react';
import type { LevelRecord, MacroRecord, ProfileRecord } from '../../lib/data/types';
import { getFormat } from '../../lib/replay/registry';
import { compactNumber, formatDate, formatRate } from '../../lib/utils';
import { Avatar } from '../ui/avatar';
import { StatusBadge } from '../ui/status-badge';

export function MacroCard({
  macro,
  uploader,
  level,
  showLevel = false,
}: {
  macro: MacroRecord;
  uploader: ProfileRecord;
  level?: LevelRecord;
  showLevel?: boolean;
}) {
  const format = getFormat(macro.originalFormatId);
  return (
    <article className="card-hover group rounded-[22px] border border-white/[.075] bg-[#0e1118] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {showLevel && level && <p className="mb-1.5 truncate text-[11px] font-medium text-violet-300">{level.name} · by {level.creator}</p>}
          <h3 className="truncate text-[15px] font-semibold tracking-tight text-zinc-100">{macro.title}</h3>
          <div className="mt-2 flex items-center gap-2">
            <Avatar initials={uploader.initials} tone={uploader.avatarTone} src={uploader.avatarUrl} size="sm" />
            <span className="text-xs text-zinc-500">by <Link className="text-zinc-300 hover:text-white" href={`/profile/${uploader.username}`}>{uploader.username}</Link></span>
          </div>
        </div>
        <StatusBadge status={macro.status} className="shrink-0" />
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2 rounded-xl border border-white/[.055] bg-white/[.025] p-3">
        <div>
          <p className="flex items-center gap-1.5 text-[10px] text-zinc-600"><Gauge className="h-3 w-3" /> Rate</p>
          <p className="mt-1 text-xs font-semibold text-zinc-300">{formatRate(macro.tps, macro.fps)}</p>
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-[10px] text-zinc-600"><MousePointerClick className="h-3 w-3" /> Inputs</p>
          <p className="mt-1 text-xs font-semibold text-zinc-300">{compactNumber(macro.inputCount)}</p>
        </div>
        <div>
          <p className="text-[10px] text-zinc-600">Original</p>
          <p className="mt-1 truncate text-xs font-semibold text-zinc-300">{format?.extensions[0] ?? macro.originalFormatId}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-[11px] text-zinc-600">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><Download className="h-3 w-3" /> {compactNumber(macro.downloadCount)}</span>
          <span className="inline-flex items-center gap-1"><Heart className="h-3 w-3" /> {compactNumber(macro.likeCount)}</span>
        </div>
        <time dateTime={macro.uploadedAt}>{formatDate(macro.uploadedAt)}</time>
      </div>
      <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
        <Link href={`/macro/${macro.id}`} className="flex h-10 items-center justify-between rounded-xl bg-white/[.055] px-3.5 text-xs font-semibold text-zinc-200 transition hover:bg-white/[.09]">
          View macro
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        <Link href={`/macro/${macro.id}#downloads`} className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500 text-white transition hover:bg-violet-400" aria-label={`Download ${macro.title}`}>
          <Download className="h-4 w-4" />
        </Link>
      </div>
    </article>
  );
}
