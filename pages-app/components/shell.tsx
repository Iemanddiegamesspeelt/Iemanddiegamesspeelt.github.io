import { useState } from 'react';
import { Compass, Crown, FolderHeart, LogIn, LogOut, Menu, Repeat2, Search, Settings, ShieldCheck, Upload, UserRound, X } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const nav = [
  { to: '/', label: 'Home' },
  { to: '/browse', label: 'Browse', icon: Compass },
  { to: '/upload', label: 'Upload', icon: Upload },
  { to: '/converter', label: 'Converter', icon: Repeat2 },
  { to: '/collections', label: 'Collections', icon: FolderHeart },
  { to: '/leaderboard', label: 'Leaderboard', icon: Crown },
];

export function Shell() {
  const [open, setOpen] = useState(false);
  const { user, profile, signOut } = useAuth();

  async function logOut() {
    try {
      await signOut();
    } finally {
      setOpen(false);
      window.location.assign(import.meta.env.BASE_URL);
    }
  }
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-white/[.065] bg-[#080a0f]/88 backdrop-blur-xl">
        <nav className="mx-auto flex h-[72px] max-w-7xl items-center gap-7 px-5 lg:px-8" aria-label="Main navigation">
          <Brand />
          <div className="hidden flex-1 items-center gap-1 lg:flex">
            {nav.map((item) => <NavLink key={item.to} to={item.to} className={({ isActive }) => `rounded-lg px-3 py-2 text-[13px] font-medium transition ${isActive ? 'bg-white/[.065] text-white' : 'text-zinc-500 hover:bg-white/[.035] hover:text-zinc-200'}`}>{item.label}</NavLink>)}
            {(profile?.role === 'moderator' || profile?.role === 'admin') && <NavLink to="/admin" className={({ isActive }) => `rounded-lg px-3 py-2 text-[13px] font-medium transition ${isActive ? 'bg-white/[.065] text-white' : 'text-zinc-500 hover:bg-white/[.035] hover:text-zinc-200'}`}>Admin</NavLink>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/browse" aria-label="Search MacroHub" className="grid h-10 w-10 place-items-center rounded-xl text-zinc-400 transition hover:bg-white/[.05] hover:text-white"><Search className="h-[18px] w-[18px]" /></Link>
            {user ? (
              <Link to={`/profile/${profile?.username ?? user.id}`} className="hidden items-center gap-2.5 rounded-xl border border-white/[.08] bg-white/[.04] py-1.5 pl-2 pr-3 text-sm transition hover:bg-white/[.07] sm:flex">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600"><UserRound className="h-3.5 w-3.5" /></span>
                <span className="max-w-28 truncate text-xs font-medium">{profile?.display_name ?? user.email}</span>
              </Link>
            ) : (
              <Link to="/login" className="hidden items-center gap-2 rounded-xl border border-white/[.09] bg-white/[.05] px-3.5 py-2.5 text-xs font-semibold transition hover:bg-white/[.09] sm:inline-flex"><LogIn className="h-3.5 w-3.5" />Sign in</Link>
            )}
            {user && <button type="button" onClick={() => void logOut()} aria-label="Sign out" title="Sign out" className="hidden h-10 w-10 place-items-center rounded-xl text-zinc-400 transition hover:bg-white/[.05] hover:text-white sm:grid"><LogOut className="h-[18px] w-[18px]" /></button>}
            <button type="button" onClick={() => setOpen((value) => !value)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} className="grid h-10 w-10 place-items-center rounded-xl border border-white/[.08] bg-white/[.04] text-zinc-300 lg:hidden">{open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}</button>
          </div>
        </nav>
        {open && <div className="border-t border-white/[.06] bg-[#0a0d13] p-3 lg:hidden"><div className="mx-auto grid max-w-7xl gap-1">
          {nav.map((item) => { const Icon = item.icon ?? Compass; return <NavLink key={item.to} to={item.to} onClick={() => setOpen(false)} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-3 text-sm ${isActive ? 'bg-violet-500/10 text-violet-200' : 'text-zinc-400'}`}><Icon className="h-4 w-4" />{item.label}</NavLink>; })}
          {(profile?.role === 'moderator' || profile?.role === 'admin') && <NavLink to="/admin" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-zinc-400"><ShieldCheck className="h-4 w-4" />Admin</NavLink>}
          {user ? <>
            <Link to={`/profile/${profile?.username ?? user.id}`} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-zinc-400"><UserRound className="h-4 w-4" />Profile</Link>
            <Link to="/settings" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-zinc-400"><Settings className="h-4 w-4" />Settings</Link>
            <button type="button" onClick={() => void logOut()} className="mt-2 flex items-center justify-center gap-2 rounded-xl border border-white/[.09] bg-white/[.05] px-4 py-3 text-sm font-semibold text-zinc-200"><LogOut className="h-4 w-4" />Sign out</button>
          </> : <Link to="/login" onClick={() => setOpen(false)} className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-3 text-sm font-semibold"><LogIn className="h-4 w-4" />Sign in</Link>}
        </div></div>}
      </header>
      <Outlet />
      <footer className="border-t border-white/[.06] px-5 py-10 text-center text-xs text-zinc-600">MacroHub is for replay compatibility, testing, and showcases—not completion proof.</footer>
    </div>
  );
}

export function Brand() {
  return <Link to="/" className="group flex items-center gap-3 font-semibold tracking-tight" aria-label="MacroHub home"><span className="grid h-9 w-9 rotate-3 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-[0_0_28px_rgba(124,92,255,.3)] transition group-hover:rotate-6"><span className="h-3.5 w-3.5 rounded-[4px] border-2 border-white" /></span><span className="text-[17px]">Macro<span className="text-violet-400">Hub</span></span></Link>;
}
