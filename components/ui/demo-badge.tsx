'use client';

import { FlaskConical } from 'lucide-react';

export function DemoBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/15 bg-amber-300/[.07] px-2.5 py-1 text-[10px] font-medium text-amber-200/80">
      <FlaskConical className="h-3 w-3" />
      Development demo data
    </span>
  );
}
