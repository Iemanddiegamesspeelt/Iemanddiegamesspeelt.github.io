'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from './native-link';
import { ArrowRight, LoaderCircle, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';

type Suggestion = {
  type: 'level' | 'creator' | 'uploader' | 'macro';
  label: string;
  meta: string;
  href: string;
};

export function SearchBox({
  defaultValue = '',
  large = false,
  autoFocus = false,
  className,
}: {
  defaultValue?: string;
  large?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const listId = useId();
  const [query, setQuery] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=7`, { signal: controller.signal });
        if (response.ok) {
          const data = await response.json() as { suggestions: Suggestion[] };
          setSuggestions(data.suggestions);
          setOpen(true);
        }
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  return (
    <div ref={container} className={cn('relative', className)}>
      <form action="/browse" className={cn(
        'relative flex items-center rounded-2xl border border-white/[.1] bg-white/[.065] p-2 shadow-[0_24px_80px_rgba(0,0,0,.32)] backdrop-blur-xl focus-within:border-violet-400/40',
        large ? 'min-h-[68px]' : 'min-h-12',
      )}>
        <Search className={cn('ml-2 shrink-0 text-zinc-500', large ? 'h-5 w-5 sm:ml-3' : 'h-4 w-4')} />
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search levels, creators, uploaders, or macros</span>
          <input
            name="q"
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              setOpen(false);
              if (nextQuery.trim().length < 2) {
                setSuggestions([]);
                setLoading(false);
              }
            }}
            onFocus={() => suggestions.length && setOpen(true)}
            autoFocus={autoFocus}
            autoComplete="off"
            aria-autocomplete="list"
            aria-controls={listId}
            className={cn('w-full bg-transparent px-3 text-white outline-none placeholder:text-zinc-600', large ? 'h-12 text-sm sm:text-base' : 'h-9 text-sm')}
            placeholder="Level name, ID, creator, or uploader…"
          />
        </label>
        {loading && <LoaderCircle className="mr-2 h-4 w-4 animate-spin text-zinc-500" />}
        {query && !loading && (
          <button type="button" onClick={() => { setQuery(''); setSuggestions([]); }} className="mr-1 grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/[.06] hover:text-white" aria-label="Clear search">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <button className={cn('rounded-xl bg-violet-500 font-semibold transition hover:bg-violet-400', large ? 'h-12 px-5 text-sm sm:px-7' : 'h-9 px-4 text-xs')} type="submit">
          <span className="hidden sm:inline">Search macros</span>
          <ArrowRight className="h-4 w-4 sm:hidden" />
        </button>
      </form>

      {open && suggestions.length > 0 && (
        <div id={listId} role="listbox" className="absolute inset-x-0 top-[calc(100%+10px)] z-40 overflow-hidden rounded-2xl border border-white/[.09] bg-[#11141b]/98 p-2 shadow-2xl backdrop-blur-xl">
          {suggestions.map((suggestion, index) => (
            <Link
              key={`${suggestion.type}-${suggestion.label}-${index}`}
              href={suggestion.href}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between gap-4 rounded-xl px-3 py-3 transition hover:bg-white/[.055]"
              role="option"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-zinc-100">{suggestion.label}</span>
                <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{suggestion.meta}</span>
              </span>
              <span className="rounded-md border border-white/[.07] px-2 py-1 text-[9px] uppercase tracking-wider text-zinc-500">{suggestion.type}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
