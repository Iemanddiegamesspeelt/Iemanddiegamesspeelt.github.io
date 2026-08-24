'use client';

import Link from 'next/link';
import { Logo } from '../ui/logo';

export function Footer() {
  return (
    <footer className="border-t border-white/[.06] bg-[#07090d]">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 sm:grid-cols-[1fr_auto] lg:px-8">
        <div>
          <Logo />
          <p className="mt-4 max-w-md text-sm leading-6 text-zinc-500">
            Browse, share, and convert Geometry Dash macros with the community.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm text-zinc-500 sm:text-right">
          <Link className="hover:text-white" href="/browse">Browse</Link>
          <Link className="hover:text-white" href="/upload">Upload</Link>
          <Link className="hover:text-white" href="/converter">Converter</Link>
          <Link className="hover:text-white" href="/collections">Collections</Link>
          <Link className="hover:text-white" href="/leaderboard">Leaderboard</Link>
          <Link className="hover:text-white" href="/settings">Settings</Link>
        </div>
      </div>
      <div className="border-t border-white/[.045]">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-5 text-[11px] text-zinc-600 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <p>© 2026 MacroHub.</p>
          <p>Built for the Geometry Dash community.</p>
        </div>
      </div>
    </footer>
  );
}
