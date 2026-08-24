'use client';

import { Check, Clock3 } from 'lucide-react';
import { cn } from '../../lib/utils';

export function FormatPill({
  label,
  implemented = false,
  className,
}: {
  label: string;
  implemented?: boolean;
  className?: string;
}) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold',
      implemented
        ? 'border-violet-400/25 bg-violet-400/10 text-violet-200'
        : 'border-white/[.08] bg-white/[.035] text-zinc-400',
      className,
    )}>
      {implemented ? <Check className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}
      {label}
    </span>
  );
}
