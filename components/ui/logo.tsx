import Link from 'next/link';
import { cn } from '../../lib/utils';

export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <Link href="/" className={cn('group flex items-center gap-3 font-semibold tracking-tight', className)} aria-label="MacroHub home">
      <span className="logo-cube grid h-9 w-9 rotate-3 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-[0_0_28px_rgba(124,92,255,.3)] transition group-hover:rotate-6">
        <span className="h-3.5 w-3.5 rounded-[4px] border-2 border-white" />
      </span>
      {!compact && <span className="text-[17px]">Macro<span className="text-violet-400">Hub</span></span>}
    </Link>
  );
}
