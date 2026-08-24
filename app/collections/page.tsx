import type { Metadata } from 'next';
import { getChatGPTUser } from '../chatgpt-auth';
import { findAppUser } from '../../lib/auth/app-user';
import { listCollectionRecordsForOwner, listProfileRecords, listPublicCollectionRecords } from '../../lib/data/repository';
import { CollectionsClient } from '../../components/collection/collections-client';

export const metadata: Metadata = { title: 'Collections', description: 'Browse public Geometry Dash macro collections on MacroHub.' };

export default async function CollectionsPage() {
  const identity = await getChatGPTUser();
  const appUser = identity ? await findAppUser(identity) : null;
  const [publicCollections, ownCollections, profiles] = await Promise.all([
    listPublicCollectionRecords(),
    appUser ? listCollectionRecordsForOwner(appUser.id) : Promise.resolve([]),
    listProfileRecords(),
  ]);
  const merged = [...ownCollections, ...publicCollections.filter((item) => !ownCollections.some((own) => own.id === item.id))];
  const ownerNames = Object.fromEntries(profiles.map((profile) => [profile.id, `@${profile.username}`]));
  return (
    <main className="mx-auto min-h-[75vh] max-w-7xl px-5 py-12 lg:px-8">
      <header className="max-w-3xl"><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-300">Curated lists</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">Collections</h1><p className="mt-3 text-sm leading-6 text-zinc-500">Organize macros for practice, showcases, challenges, or anything else.</p></header>
      <div className="mt-2"><CollectionsClient initialCollections={merged} signedIn={Boolean(identity)} ownerNames={ownerNames} /></div>
    </main>
  );
}
