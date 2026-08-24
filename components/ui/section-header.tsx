'use client';

import Link from './native-link';
import { ArrowUpRight } from 'lucide-react';

export function SectionHeader({
  eyebrow,
  title,
  description,
  href,
  actionLabel = 'View all',
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  href?: string;
  actionLabel?: string;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-5">
      <div>
        {eyebrow && <p className="mb-2 text-[10px] font-semibold uppercase tracking-[.2em] text-violet-300">{eyebrow}</p>}
        <h2 className="text-2xl font-semibold tracking-[-.03em] text-white sm:text-3xl">{title}</h2>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">{description}</p>}
      </div>
      {href && (
        <Link href={href} className="hidden shrink-0 items-center gap-1.5 text-xs font-medium text-zinc-400 transition hover:text-white sm:flex">
          {actionLabel}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
