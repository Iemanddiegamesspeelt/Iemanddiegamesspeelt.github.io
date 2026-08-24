'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Compass,
  Crown,
  FolderHeart,
  LogIn,
  Menu,
  Search,
  Repeat2,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Logo } from '../ui/logo';
import { cn } from '../../lib/utils';
import { appSignInPath } from '../../lib/auth/session';

const navItems = [
  { href: '/', label: 'Home' },
  { href: '/browse', label: 'Browse', icon: Compass },
  { href: '/upload', label: 'Upload', icon: Upload },
  { href: '/converter', label: 'Converter', icon: Repeat2 },
  { href: '/collections', label: 'Collections', icon: FolderHeart },
  { href: '/leaderboard', label: 'Leaderboard', icon: Crown },
];

export interface NavbarUser {
  displayName: string;
  email: string;
}

export function Navbar({ user }: { user: NavbarUser | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-white/[.065] bg-[#080a0f]/85 backdrop-blur-xl">
        <nav className="mx-auto flex h-[72px] max-w-7xl items-center gap-7 px-5 lg:px-8" aria-label="Main navigation">
          <Logo />
          <div className="hidden flex-1 items-center gap-1 lg:flex">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-lg px-3 py-2 text-[13px] font-medium transition',
                  current(item.href) ? 'bg-white/[.065] text-white' : 'text-zinc-500 hover:bg-white/[.035] hover:text-zinc-200',
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/browse?focus=search"
              className="grid h-10 w-10 place-items-center rounded-xl text-zinc-400 transition hover:bg-white/[.05] hover:text-white"
              aria-label="Search MacroHub"
            >
              <Search className="h-[18px] w-[18px]" />
            </Link>
            {user ? (
              <Link href="/settings" className="hidden items-center gap-2.5 rounded-xl border border-white/[.08] bg-white/[.04] py-1.5 pl-2 pr-3 text-sm transition hover:bg-white/[.07] sm:flex">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600">
                  <UserRound className="h-3.5 w-3.5" />
                </span>
                <span className="max-w-28 truncate text-xs font-medium">{user.displayName}</span>
              </Link>
            ) : (
              <Link href={appSignInPath('/')} className="hidden items-center gap-2 rounded-xl border border-white/[.09] bg-white/[.05] px-3.5 py-2.5 text-xs font-semibold transition hover:bg-white/[.09] sm:inline-flex">
                <LogIn className="h-3.5 w-3.5" />
                Sign in
              </Link>
            )}
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.08] bg-white/[.04] text-zinc-300 lg:hidden"
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
            >
              {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </nav>
        {open && (
          <div className="border-t border-white/[.06] bg-[#0a0d13] p-3 lg:hidden">
            <div className="mx-auto grid max-w-7xl gap-1">
              {navItems.map((item) => {
                const Icon = item.icon ?? Compass;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn('flex items-center gap-3 rounded-xl px-3 py-3 text-sm', current(item.href) ? 'bg-violet-500/10 text-violet-200' : 'text-zinc-400')}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
              {!user && (
                <Link href={appSignInPath('/')} className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-3 text-sm font-semibold" onClick={() => setOpen(false)}>
                  <LogIn className="h-4 w-4" />
                  Sign in
                </Link>
              )}
            </div>
          </div>
        )}
      </header>
    </>
  );
}

