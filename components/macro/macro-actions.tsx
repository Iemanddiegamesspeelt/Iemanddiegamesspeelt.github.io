'use client';

import Link from 'next/link';
import { CheckCircle2, Heart, History, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { appSignInPath } from '../../lib/auth/session';

export function MacroActions({ macroId, initialLiked, initialLikes, signedIn }: { macroId: string; initialLiked: boolean; initialLikes: number; signedIn: boolean }) {
  const [liked, setLiked] = useState(initialLiked);
  const [likes, setLikes] = useState(initialLikes);
  const [busy, setBusy] = useState(false);
  const [reported, setReported] = useState('');

  async function toggleLike() {
    if (!signedIn || busy) return;
    setBusy(true);
    const response = await fetch(`/api/macros/${macroId}/like`, { method: liked ? 'DELETE' : 'POST' });
    if (response.ok) {
      setLiked((value) => !value);
      setLikes((value) => value + (liked ? -1 : 1));
    }
    setBusy(false);
  }

  async function report(verdict: 'working' | 'broken' | 'outdated') {
    if (!signedIn) return;
    const response = await fetch(`/api/macros/${macroId}/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict }) });
    if (response.ok) setReported(verdict);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {signedIn ? (
        <button type="button" onClick={() => void toggleLike()} disabled={busy} className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold ${liked ? 'border-rose-400/20 bg-rose-400/[.08] text-rose-300' : 'border-white/[.08] bg-white/[.04] text-zinc-300 hover:bg-white/[.08]'}`}>
          {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Heart className={`h-3.5 w-3.5 ${liked ? 'fill-current' : ''}`} />}{likes.toLocaleString()}
        </button>
      ) : <Link href={appSignInPath(`/macro/${macroId}`)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.04] px-3.5 text-xs font-semibold text-zinc-300"><Heart className="h-3.5 w-3.5" /> {likes.toLocaleString()}</Link>}
      {signedIn && <>
        <button type="button" onClick={() => void report('working')} className={`inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-[11px] ${reported === 'working' ? 'border-emerald-400/20 text-emerald-300' : 'border-white/[.07] text-zinc-500 hover:text-zinc-200'}`}><CheckCircle2 className="h-3.5 w-3.5" /> Working</button>
        <button type="button" onClick={() => void report('outdated')} className={`inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-[11px] ${reported === 'outdated' ? 'border-amber-400/20 text-amber-300' : 'border-white/[.07] text-zinc-500 hover:text-zinc-200'}`}><History className="h-3.5 w-3.5" /> Outdated</button>
        <button type="button" onClick={() => void report('broken')} className={`inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-[11px] ${reported === 'broken' ? 'border-rose-400/20 text-rose-300' : 'border-white/[.07] text-zinc-500 hover:text-zinc-200'}`}><TriangleAlert className="h-3.5 w-3.5" /> Broken</button>
      </>}
    </div>
  );
}
