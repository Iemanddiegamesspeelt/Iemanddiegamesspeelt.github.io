import type { Metadata } from 'next';
import Link from 'next/link';
import { Avatar } from '../../components/ui/avatar';
import { EmptyState } from '../../components/ui/empty-state';
import { LevelCard } from '../../components/level/level-card';
import { MacroCard } from '../../components/macro/macro-card';
import { listLevelRecords, listMacroRecords, listProfileRecords } from '../../lib/data/repository';
import { compactNumber } from '../../lib/utils';

export const metadata: Metadata = { title: 'Leaderboard', description: 'MacroHub community upload, download, like, and level leaderboards.' };

export default async function LeaderboardPage() {
  const [levels, macros, profiles] = await Promise.all([listLevelRecords(), listMacroRecords(), listProfileRecords()]);
  const uploaders = [...profiles].filter((profile) => profile.macroCount > 0).sort((a, b) => b.totalDownloads - a.totalDownloads).slice(0, 10);
  const downloaded = [...macros].sort((a, b) => b.downloadCount - a.downloadCount).slice(0, 6);
  const liked = [...macros].sort((a, b) => b.likeCount - a.likeCount).slice(0, 6);
  const popularLevels = [...levels].sort((a, b) => b.totalDownloads - a.totalDownloads).slice(0, 6);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const levelById = new Map(levels.map((level) => [level.id, level]));
  return (
    <main className="mx-auto min-h-[75vh] max-w-7xl px-5 py-12 lg:px-8">
      <header className="max-w-3xl"><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-300">Community activity</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">Leaderboard</h1><p className="mt-3 text-sm leading-6 text-zinc-500">Celebrating the people and macros that help the community.</p><p className="mt-2 text-xs text-zinc-700">Macro playback is for testing and showcases, not completion proof.</p></header>
      {!macros.length ? <div className="mt-10"><EmptyState title="No leaderboard entries yet" description="Community activity will appear here as macros are published, liked, and downloaded." /></div> : <div className="mt-10 space-y-14">
        <section><h2 className="text-2xl font-semibold">Top uploaders</h2><div className="mt-5 overflow-hidden rounded-[22px] border border-white/[.07] bg-[#0e1118]">{uploaders.map((profile, index) => <Link key={profile.id} href={`/profile/${profile.username}`} className="flex items-center gap-4 border-b border-white/[.055] p-4 last:border-0 hover:bg-white/[.025]"><span className="w-7 text-center text-sm font-semibold text-zinc-600">#{index + 1}</span><Avatar initials={profile.initials} tone={profile.avatarTone} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{profile.displayName}</p><p className="text-[11px] text-zinc-600">@{profile.username} · {profile.macroCount} macros</p></div><strong className="text-sm text-zinc-300">{compactNumber(profile.totalDownloads)} <span className="font-normal text-zinc-700">downloads</span></strong></Link>)}</div></section>
        <MacroRanking title="Most downloaded macros" items={downloaded} profileById={profileById} levelById={levelById} />
        <MacroRanking title="Most liked macros" items={liked} profileById={profileById} levelById={levelById} />
        <section><h2 className="text-2xl font-semibold">Most popular levels</h2><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{popularLevels.map((level) => <LevelCard key={level.id} level={level} />)}</div></section>
      </div>}
    </main>
  );
}

function MacroRanking({ title, items, profileById, levelById }: { title: string; items: Awaited<ReturnType<typeof listMacroRecords>>; profileById: Map<string, Awaited<ReturnType<typeof listProfileRecords>>[number]>; levelById: Map<string, Awaited<ReturnType<typeof listLevelRecords>>[number]> }) {
  return <section><h2 className="text-2xl font-semibold">{title}</h2><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{items.map((macro) => { const uploader = profileById.get(macro.uploaderId); return uploader ? <MacroCard key={macro.id} macro={macro} uploader={uploader} level={levelById.get(macro.levelId)} showLevel /> : null; })}</div></section>;
}
