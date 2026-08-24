import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getChatGPTUser } from '../../chatgpt-auth';
import { findAppUser } from '../../../lib/auth/app-user';
import { findCollectionRecord, listLevelRecords, listMacroRecordsByIds, listProfileRecords } from '../../../lib/data/repository';
import { MacroCard } from '../../../components/macro/macro-card';
import { EmptyState } from '../../../components/ui/empty-state';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const collection = await findCollectionRecord(id);
  return { title: collection?.name ?? 'Collection not found', description: collection?.description || undefined };
}

export default async function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await getChatGPTUser();
  const viewer = identity ? await findAppUser(identity) : null;
  const collection = await findCollectionRecord(id, viewer?.id);
  if (!collection) notFound();
  const [macros, profiles, levels] = await Promise.all([listMacroRecordsByIds(collection.macroIds), listProfileRecords(), listLevelRecords()]);
  const owner = profiles.find((profile) => profile.id === collection.ownerId);
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  const levelsById = new Map(levels.map((level) => [level.id, level]));
  return (
    <main className="mx-auto min-h-[75vh] max-w-7xl px-5 py-12 lg:px-8">
      <header className="rounded-[28px] border border-white/[.075] bg-[#0e1118] p-6 sm:p-9"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">{collection.visibility} collection</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">{collection.name}</h1>{owner && <p className="mt-2 text-sm text-zinc-500">by @{owner.username}</p>}{collection.description && <p className="mt-5 max-w-3xl text-sm leading-7 text-zinc-400">{collection.description}</p>}<p className="mt-5 text-xs text-zinc-600">{macros.length} macros</p></header>
      <section className="mt-8">{macros.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{macros.map((macro) => { const uploader = profilesById.get(macro.uploaderId); return uploader ? <MacroCard key={macro.id} macro={macro} uploader={uploader} level={levelsById.get(macro.levelId)} showLevel /> : null; })}</div> : <EmptyState title="This collection is empty" description="Macros added to this collection will appear here." />}</section>
    </main>
  );
}
