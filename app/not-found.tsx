'use client';

import Link from 'next/link';
import { ArrowLeft, FileQuestion } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-[68vh] max-w-3xl place-items-center px-5 py-20 text-center">
      <div>
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] border border-white/[.08] bg-white/[.04] text-violet-300">
          <FileQuestion className="h-7 w-7" />
        </span>
        <p className="mt-6 text-[10px] font-semibold uppercase tracking-[.2em] text-violet-300">404</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-.04em]">Nothing here yet</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-500">This level, macro, profile, or collection does not exist in MacroHub.</p>
        <Link href="/browse" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-white/[.07] px-4 py-2.5 text-xs font-semibold hover:bg-white/[.11]">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to browse
        </Link>
      </div>
    </main>
  );
}

