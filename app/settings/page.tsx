import type { Metadata } from 'next';
import Link from '../../components/ui/native-link';
import { requireChatGPTUser, chatGPTSignOutPath } from '../chatgpt-auth';
import { ensureAppUser } from '../../lib/auth/app-user';
import { SettingsForm } from '../../components/profile/settings-form';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const identity = await requireChatGPTUser('/settings');
  let user;
  try { user = await ensureAppUser(identity); } catch {
    return <main className="mx-auto min-h-[70vh] max-w-3xl px-5 py-16"><h1 className="text-3xl font-semibold">Settings unavailable</h1><p className="mt-3 text-sm text-zinc-500">Profile settings are temporarily unavailable.</p></main>;
  }
  const profile = user.profile!;
  const displayName = profile.displayName ?? profile.username;
  const avatarUrl = profile.avatarStorageKey ? `/api/profile/avatar/${encodeURIComponent(profile.username)}` : undefined;
  return (
    <main className="mx-auto min-h-[75vh] max-w-5xl px-5 py-12 lg:px-8">
      <header className="mb-9 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-300">Account</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.045em]">Settings</h1></div><Link href={chatGPTSignOutPath('/')} className="text-xs text-zinc-500 hover:text-white">Sign out</Link></header>
      <SettingsForm initial={{ username: profile.username, displayName, bio: profile.bio ?? '', initials: displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(), avatarUrl }} />
    </main>
  );
}
