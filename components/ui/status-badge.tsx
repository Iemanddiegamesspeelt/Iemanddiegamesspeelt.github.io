'use client';

import { CheckCircle2, CircleAlert, CircleDashed, Clock3, XCircle } from 'lucide-react';
import type { WorkingStatus } from '../../lib/data/types';
import { cn } from '../../lib/utils';

const styles: Record<WorkingStatus, string> = {
  Working: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
  Unverified: 'border-zinc-400/15 bg-zinc-400/10 text-zinc-300',
  'Possibly outdated': 'border-amber-400/20 bg-amber-400/10 text-amber-300',
  Broken: 'border-rose-400/20 bg-rose-400/10 text-rose-300',
  Removed: 'border-rose-400/20 bg-rose-400/10 text-rose-300',
};
const icons = {
  Working: CheckCircle2,
  Unverified: CircleDashed,
  'Possibly outdated': Clock3,
  Broken: CircleAlert,
  Removed: XCircle,
};

export function StatusBadge({ status, className }: { status: WorkingStatus; className?: string }) {
  const Icon = icons[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium', styles[status], className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {status}
    </span>
  );
}
