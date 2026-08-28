import { ImageUp, LoaderCircle, LogOut, Save } from 'lucide-react';
import { useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

export function SettingsPage() {
  const { user, profile, loading, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  if (!loading && !user) return <Navigate to="/login?return_to=%2Fsettings" replace />;
  if (!user || !profile) return <main className="grid min-h-[70vh] place-items-center"><LoaderCircle className="h-6 w-6 animate-spin text-violet-300" /></main>;
  const currentUser = user;

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy('profile'); setError(''); setMessage('');
    const form = new FormData(event.currentTarget);
    const username = String(form.get('username') ?? '').trim().toLowerCase();
    const displayName = String(form.get('displayName') ?? '').trim();
    const bio = String(form.get('bio') ?? '').trim();
    try {
      if (!/^[a-z0-9_]{3,30}$/.test(username)) throw new Error('Username must be 3–30 characters using letters, numbers, or underscores.');
      const { error: updateError } = await supabase().from('profiles').update({ username, display_name: displayName.slice(0, 80) || null, bio: bio.slice(0, 500) || null }).eq('id', currentUser.id);
      if (updateError) throw updateError;
      await refreshProfile(); setMessage('Profile saved.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save the profile.'); }
    finally { setBusy(''); }
  }

  async function avatar(file: File) {
    setBusy('avatar'); setError(''); setMessage('');
    try {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('Choose a PNG, JPEG, WebP, or GIF image.');
      if (file.size > 2 * 1024 * 1024) throw new Error('Avatars are limited to 2 MiB.');
      if (!await hasValidImageSignature(file)) throw new Error('The image contents do not match its file type.');
      const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
      const path = `${currentUser.id}/avatar/avatar.${extension}`;
      const { error: uploadError } = await supabase().storage.from('macrohub-files').upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      const { data } = supabase().storage.from('macrohub-files').getPublicUrl(path);
      const avatarUrl = `${data.publicUrl}?v=${Date.now()}`;
      const { error: updateError } = await supabase().from('profiles').update({ avatar_url: avatarUrl }).eq('id', currentUser.id);
      if (updateError) throw updateError;
      await refreshProfile(); setMessage('Avatar updated.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not upload the avatar.'); }
    finally { setBusy(''); }
  }

  return <main className="mx-auto min-h-[75vh] max-w-3xl px-5 py-12"><header><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-300">Your account</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.045em]">Profile settings</h1></header><section className="mt-8 rounded-[28px] border border-white/[.075] bg-[#0e1118] p-6 sm:p-8"><div className="flex items-center gap-5"><span className="grid h-20 w-20 place-items-center overflow-hidden rounded-[24px] bg-gradient-to-br from-violet-500 to-indigo-700 text-2xl font-semibold">{profile.avatar_url ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : profile.username[0].toUpperCase()}</span><div><button type="button" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.04] px-4 py-2.5 text-xs font-semibold"><ImageUp className="h-3.5 w-3.5" />Change avatar</button><p className="mt-2 text-[10px] text-zinc-700">PNG, JPEG, WebP, or GIF · max 2 MiB</p><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void avatar(file); }} /></div></div><form onSubmit={(event) => void save(event)} className="mt-8 space-y-4"><Field label="Username" name="username" defaultValue={profile.username} maxLength={30} /><Field label="Display name" name="displayName" defaultValue={profile.display_name ?? ''} maxLength={80} /><label className="block"><span className="mb-2 block text-[11px] text-zinc-400">Bio</span><textarea name="bio" defaultValue={profile.bio ?? ''} maxLength={500} rows={5} className="w-full rounded-xl border border-white/[.08] bg-[#11151d] p-3 text-sm outline-none" /></label><p className="text-[11px] text-zinc-700">Signed in as {user.email}</p>{error && <p role="alert" className="rounded-xl border border-rose-400/15 bg-rose-400/[.06] p-3 text-xs text-rose-200">{error}</p>}{message && <p className="rounded-xl border border-emerald-400/15 bg-emerald-400/[.06] p-3 text-xs text-emerald-200">{message}</p>}<button disabled={Boolean(busy)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-500 px-5 text-xs font-semibold disabled:opacity-50">{busy === 'profile' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save profile</button></form></section><button type="button" onClick={() => void signOut().then(() => navigate('/'))} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-rose-400/15 px-4 py-3 text-xs font-semibold text-rose-200"><LogOut className="h-4 w-4" />Sign out</button></main>;
}

function Field({ label, name, defaultValue, maxLength }: { label: string; name: string; defaultValue: string; maxLength: number }) { return <label className="block"><span className="mb-2 block text-[11px] text-zinc-400">{label}</span><input required name={name} defaultValue={defaultValue} maxLength={maxLength} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#11151d] px-3 text-sm outline-none" /></label>; }

async function hasValidImageSignature(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (file.type === 'image/png') return [0x89, 0x50, 0x4e, 0x47].every((value, index) => bytes[index] === value);
  if (file.type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.type === 'image/gif') return new TextDecoder().decode(bytes.slice(0, 4)) === 'GIF8';
  if (file.type === 'image/webp') return new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
  return false;
}
