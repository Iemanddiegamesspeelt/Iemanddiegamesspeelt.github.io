'use client';

import { useEffect } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto grid min-h-[68vh] max-w-3xl place-items-center px-5 py-20 text-center">
      <div>
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] border border-rose-400/15 bg-rose-400/[.07] text-rose-300">
          <TriangleAlert className="h-7 w-7" />
        </span>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">MacroHub hit a snag</h1>
        <p className="mt-3 text-sm text-zinc-500">The request could not be completed. Your file and account data were not changed.</p>
        <button type="button" onClick={reset} className="mt-7 inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-xs font-semibold hover:bg-violet-400">
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </button>
      </div>
    </main>
  );
}

