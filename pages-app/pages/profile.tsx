import { CalendarDays, Download, Heart, Settings, Upload } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Empty, ErrorBox, Loading, MacroCard } from '../components/cards';
import { getProfile, listCollections, listLikedMacros, listProfileMacros } from '../lib/catalog';
import { useAuth } from '../lib/auth';
import { isSupabaseConfigured } from '../lib/supabase';
import { useAsync } from '../lib/use-async';

export function ProfilePage() {
  const { username = '' } = useParams();
  const { user } = useAuth();
  const { data, error, loading } = useAsync(async () => {
    if (!isSupabaseConfigured()) return null;
    const profile = await getProfile(username);
    if (!profile) return null;
    const [macros, collections, liked] = await Promise.all([listProfileMacros(profile.id), listCollections(user?.id), user?.id === profile.id ? listLikedMacros(profile.id) : Promise.resolve([])]);
    return { profile, macros, liked, collections: collections.filter((collection) => collection.owner_id === profile.id) };
  }, [username, user?.id]);
  if (loading) return <main className="mx-auto max-w-7xl px-5 py-12 lg:px-8"><Loading /></main>;
  if (error) return <main className="mx-auto max-w-4xl px-5 py-12"><ErrorBox message={error} /></main>;
  if (!data) return <main className="mx-auto max-w-4xl px-5 py-12"><Empty title="Profile not found" text="This account does not exist or is unavailable." /></main>;
  const { profile, macros, liked, collections } = data;
  return <main className="mx-auto min-h-[75vh] max-w-7xl px-5 py-12 lg:px-8"><section className="flex flex-col gap-6 rounded-[28px] border border-white/[.075] bg-[#0e1118] p-6 sm:flex-row sm:items-center sm:p-8"><span className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-[28px] border border-white/[.09] bg-gradient-to-br from-violet-500 to-indigo-700 text-3xl font-semibold">{profile.avatar_url ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" /> : profile.username.slice(0, 1).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="text-[10px] uppercase tracking-[.17em] text-violet-300">MacroHub profile</p><h1 className="mt-2 truncate text-4xl font-semibold tracking-[-.045em]">{profile.display_name ?? profile.username}</h1><p className="mt-1 text-sm text-zinc-600">@{profile.username}</p>{profile.bio && <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400">{profile.bio}</p>}<p className="mt-4 flex items-center gap-2 text-xs text-zinc-600"><CalendarDays className="h-3.5 w-3.5" />Joined {new Date(profile.joined_at).toLocaleDateString()}</p></div>{user?.id === profile.id && <Link to="/settings" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[.08] px-4 text-xs font-semibold text-zinc-300"><Settings className="h-3.5 w-3.5" />Edit profile</Link>}</section>
    <div className="mt-5 grid grid-cols-3 gap-3"><Metric icon={Upload} label="Macros" value={profile.macro_count} /><Metric icon={Download} label="Downloads" value={profile.total_downloads} /><Metric icon={Heart} label="Likes" value={profile.total_likes} /></div>
    <section className="mt-12"><h2 className="mb-6 text-2xl font-semibold">Uploaded macros</h2>{macros.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{macros.map((macro) => <MacroCard key={macro.id} macro={macro} />)}</div> : <Empty title="No macros yet" text="Published macros will appear here." />}</section>
    {user?.id === profile.id && liked.length > 0 && <section className="mt-12"><h2 className="mb-6 text-2xl font-semibold">Liked macros</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{liked.map((macro) => <MacroCard key={macro.id} macro={macro} />)}</div></section>}
    {collections.length > 0 && <section className="mt-12"><h2 className="mb-6 text-2xl font-semibold">Collections</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{collections.map((collection) => <Link key={collection.id} to={`/collection/${collection.id}`} className="card-hover rounded-[22px] border border-white/[.075] bg-[#0e1118] p-5"><p className="text-[10px] uppercase tracking-wider text-violet-300">{collection.visibility}</p><h3 className="mt-3 font-semibold">{collection.name}</h3><p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-600">{collection.description ?? 'Macro collection'}</p><p className="mt-4 text-[10px] text-zinc-700">{collection.collection_macros?.length ?? 0} macros</p></Link>)}</div></section>}
  </main>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof Heart; label: string; value: number }) { return <div className="rounded-2xl border border-white/[.065] bg-[#0e1118] p-4"><p className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-600"><Icon className="h-3 w-3" />{label}</p><p className="mt-2 text-xl font-semibold">{value.toLocaleString()}</p></div>; }
