'use client';

import { useRef, useState } from 'react';
import { Camera, Check, LoaderCircle, Save } from 'lucide-react';
import { Avatar } from '../ui/avatar';

export function SettingsForm({ initial }: { initial: { username: string; displayName: string; bio: string; initials: string; avatarUrl?: string } }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl);
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function save(form: FormData) {
    setBusy(true); setError(''); setMessage('');
    const response = await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: form.get('username'), displayName: form.get('displayName'), bio: form.get('bio') }) });
    const data = await response.json() as { error?: { message?: string } };
    if (response.ok) setMessage('Profile saved.'); else setError(data.error?.message ?? 'Could not save your profile.');
    setBusy(false);
  }

  async function uploadAvatar(file: File) {
    setAvatarBusy(true); setError('');
    const body = new FormData(); body.set('avatar', file);
    const response = await fetch('/api/profile/avatar', { method: 'POST', body });
    const data = await response.json() as { avatarUrl?: string; error?: { message?: string } };
    if (response.ok && data.avatarUrl) setAvatarUrl(data.avatarUrl); else setError(data.error?.message ?? 'Could not upload this image.');
    setAvatarBusy(false);
  }

  return (
    <form action={(form) => void save(form)} className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Profile details</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field name="username" label="Username" defaultValue={initial.username} maxLength={32} />
          <Field name="displayName" label="Display name" defaultValue={initial.displayName} maxLength={80} />
        </div>
        <label className="mt-4 block"><span className="mb-2 block text-[11px] text-zinc-400">Bio</span><textarea name="bio" defaultValue={initial.bio} maxLength={500} rows={5} className="w-full resize-y rounded-xl border border-white/[.08] bg-[#11151d] p-3 text-sm outline-none focus:border-violet-400/40" /></label>
        {message && <p className="mt-4 flex items-center gap-2 text-xs text-emerald-300"><Check className="h-3.5 w-3.5" />{message}</p>}{error && <p className="mt-4 text-xs text-rose-300">{error}</p>}
        <button disabled={busy} className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-violet-500 px-5 text-xs font-semibold hover:bg-violet-400 disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save changes</button>
      </section>
      <aside className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5 text-center"><Avatar initials={initial.initials} src={avatarUrl} size="xl" className="mx-auto" /><h2 className="mt-4 text-sm font-semibold">Profile picture</h2><p className="mt-1 text-[11px] leading-5 text-zinc-600">PNG, JPEG, or WebP up to 2 MiB.</p><button type="button" disabled={avatarBusy} onClick={() => fileRef.current?.click()} className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.04] px-4 text-xs hover:bg-white/[.08] disabled:opacity-50">{avatarBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}Change avatar</button><input ref={fileRef} type="file" className="sr-only" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAvatar(file); }} /></aside>
    </form>
  );
}

function Field({ name, label, defaultValue, maxLength }: { name: string; label: string; defaultValue: string; maxLength: number }) { return <label className="block"><span className="mb-2 block text-[11px] text-zinc-400">{label}</span><input name={name} required defaultValue={defaultValue} maxLength={maxLength} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#11151d] px-3.5 text-sm outline-none focus:border-violet-400/40" /></label>; }
