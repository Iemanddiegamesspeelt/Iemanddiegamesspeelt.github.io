'use client';

import { useState } from 'react';
import { LoaderCircle, Plus, X } from 'lucide-react';
import type { CollectionRecord } from '../../lib/data/types';
import { appSignInPath } from '../../lib/auth/session';
import { CollectionCard } from './collection-card';
import { EmptyState } from '../ui/empty-state';

export function CollectionsClient({ initialCollections, signedIn, ownerNames }: { initialCollections: CollectionRecord[]; signedIn: boolean; ownerNames: Record<string, string> }) {
  const [collections, setCollections] = useState(initialCollections);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create(form: FormData) {
    setBusy(true);
    setError('');
    const response = await fetch('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.get('name'), description: form.get('description'), visibility: form.get('visibility') }),
    });
    const data = await response.json() as { collection?: CollectionRecord; error?: { message?: string } };
    if (response.ok && data.collection) {
      setCollections((items) => [data.collection!, ...items]);
      setOpen(false);
    } else setError(data.error?.message ?? 'Could not create the collection.');
    setBusy(false);
  }

  return (
    <>
      <div className="mb-7 flex justify-end">
        {signedIn ? <button type="button" onClick={() => setOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-500 px-4 text-xs font-semibold hover:bg-violet-400"><Plus className="h-4 w-4" /> New collection</button> : <a href={appSignInPath('/collections')} className="inline-flex h-11 items-center rounded-xl bg-violet-500 px-4 text-xs font-semibold hover:bg-violet-400">Sign in to create</a>}
      </div>
      {collections.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{collections.map((collection) => <CollectionCard key={collection.id} collection={collection} ownerName={ownerNames[collection.ownerId]} />)}</div> : <EmptyState title="No collections yet" description="Create a collection to organize macros around a theme or practice goal." />}
      {open && <div role="dialog" aria-modal="true" className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-5 backdrop-blur-sm"><form action={(form) => void create(form)} className="w-full max-w-lg rounded-[24px] border border-white/[.09] bg-[#11141b] p-6 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">New collection</h2><button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/[.06]" aria-label="Close"><X className="h-4 w-4" /></button></div><label className="mt-5 block text-[11px] text-zinc-400">Name<input name="name" required maxLength={100} className="mt-2 h-11 w-full rounded-xl border border-white/[.08] bg-[#0b0e14] px-3 text-sm outline-none" /></label><label className="mt-4 block text-[11px] text-zinc-400">Description<textarea name="description" maxLength={1000} rows={4} className="mt-2 w-full rounded-xl border border-white/[.08] bg-[#0b0e14] p-3 text-sm outline-none" /></label><label className="mt-4 block text-[11px] text-zinc-400">Visibility<select name="visibility" className="mt-2 h-11 w-full rounded-xl border border-white/[.08] bg-[#0b0e14] px-3 text-sm"><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option></select></label>{error && <p className="mt-3 text-xs text-rose-300">{error}</p>}<button disabled={busy} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-50">{busy && <LoaderCircle className="h-4 w-4 animate-spin" />}Create collection</button></form></div>}
    </>
  );
}
