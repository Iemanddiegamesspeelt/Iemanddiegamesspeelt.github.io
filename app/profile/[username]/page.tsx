import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Avatar } from '../../../components/ui/avatar';
import { MacroCard } from '../../../components/macro/macro-card';
import { CollectionCard } from '../../../components/collection/collection-card';
import { EmptyState } from '../../../components/ui/empty-state';
import { findProfileRecord, listLevelRecords, listMacroRecordsForProfile, listPublicCollectionRecords } from '../../../lib/data/repository';
import { compactNumber, formatDate } from '../../../lib/utils';

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  const profile = await findProfileRecord(username);
  return { title: profile ? `${profile.displayName} (@${profile.username})` : 'Profile not found', description: profile?.bio || undefined };
}

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const profile = await findProfileRecord(username);
  if (!profile) notFound();
  const [macros, levels, collections] = await Promise.all([
    listMacroRecordsForProfile(profile.id),
    listLevelRecords(),
    listPublicCollectionRecords(),
  ]);
  const levelById = new Map(levels.map((level) => [level.id, level]));
  const ownCollections = collections.filter((collection) => collection.ownerId === profile.id);
  return (
    <main className="mx-auto min-h-[75vh] max-w-7xl px-5 py-12 lg:px-8">
      <section className="rounded-[28px] border border-white/[.075] bg-[#0e1118] p-6 sm:p-9">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center"><Avatar initials={profile.initials} tone={profile.avatarTone} src={profile.avatarUrl} size="lg" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-3xl font-semibold tracking-[-.04em] sm:text-4xl">{profile.displayName}</h1>{profile.role !== 'user' && <span className="rounded-md bg-violet-400/10 px-2 py-1 text-[9px] uppercase tracking-wider text-violet-300">{profile.role}</span>}</div><p className="mt-1 text-sm text-zinc-500">@{profile.username} · joined {formatDate(profile.joinedAt)}</p>{profile.bio && <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400">{profile.bio}</p>}</div></div>
        <dl className="mt-7 grid grid-cols-3 gap-3 border-t border-white/[.06] pt-6"><Stat label="Macros" value={String(macros.length)} /><Stat label="Downloads" value={compactNumber(profile.totalDownloads)} /><Stat label="Likes" value={compactNumber(profile.totalLikes)} /></dl>
      </section>
      <section className="mt-10"><h2 className="text-2xl font-semibold">Uploaded macros</h2><div className="mt-5">{macros.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{macros.map((macro) => <MacroCard key={macro.id} macro={macro} uploader={profile} level={levelById.get(macro.levelId)} showLevel />)}</div> : <EmptyState title="No uploaded macros" description="Published macros will appear here." />}</div></section>
      {ownCollections.length > 0 && <section className="mt-12"><h2 className="text-2xl font-semibold">Collections</h2><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{ownCollections.map((collection) => <CollectionCard key={collection.id} collection={collection} />)}</div></section>}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) { return <div><dt className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</dt><dd className="mt-1 text-lg font-semibold text-zinc-200">{value}</dd></div>; }
