'use client';

import Link from '../ui/native-link';
import { Check, FolderPlus, LoaderCircle, X } from 'lucide-react';
import { useState } from 'react';

type Choice = { id: string; name: string; visibility: string };

export function AddToCollection({ macroId, signedIn }: { macroId: string; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [added, setAdded] = useState('');

  async function show() {
    setOpen(true); setBusy(true);
    const response = await fetch('/api/collections?mine=1');
    const data = await response.json() as { collections?: Choice[] };
    setChoices(data.collections ?? []); setBusy(false);
  }
  async function add(collectionId: string) {
    setBusy(true);
    const response = await fetch(`/api/collections/${collectionId}/macros`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ macroId }) });
    if (response.ok) setAdded(collectionId);
    setBusy(false);
  }
  if (!signedIn) return null;
  return <><button type="button" onClick={() => void show()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.04] px-3.5 text-xs font-semibold text-zinc-300 hover:bg-white/[.08]"><FolderPlus className="h-3.5 w-3.5" /> Add to collection</button>{open && <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-5 backdrop-blur-sm"><div className="w-full max-w-md rounded-[22px] border border-white/[.09] bg-[#11141b] p-5"><div className="flex items-center justify-between"><h2 className="font-semibold">Add to collection</h2><button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/[.06]"><X className="h-4 w-4" /></button></div><div className="mt-4 space-y-2">{busy && !choices.length ? <div className="grid place-items-center py-8"><LoaderCircle className="h-5 w-5 animate-spin text-violet-300" /></div> : choices.map((choice) => <button key={choice.id} type="button" disabled={busy} onClick={() => void add(choice.id)} className="flex w-full items-center justify-between rounded-xl border border-white/[.065] bg-white/[.025] p-3 text-left text-sm hover:bg-white/[.055]"><span><span className="block font-medium">{choice.name}</span><span className="mt-0.5 block text-[10px] text-zinc-600">{choice.visibility}</span></span>{added === choice.id && <Check className="h-4 w-4 text-emerald-300" />}</button>)}{!busy && !choices.length && <p className="py-6 text-center text-sm text-zinc-600">No collections yet. <Link href="/collections" className="text-violet-300">Create one</Link></p>}</div></div></div>}</>;
}
