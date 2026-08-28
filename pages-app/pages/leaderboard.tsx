import { Crown, Download, Heart, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ErrorBox, Loading } from '../components/cards';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { LevelRow, MacroRow, ProfileRow } from '../lib/types';
import { useAsync } from '../lib/use-async';

export function LeaderboardPage() {
  const { data, error, loading } = useAsync(async () => {
    if (!isSupabaseConfigured()) return { profiles: [], macros: [], liked: [], levels: [] };
    const [profiles, macros, liked, levels] = await Promise.all([
      supabase().from('profiles').select('*').gt('macro_count', 0).order('total_downloads', { ascending: false }).limit(10),
      supabase().from('macros').select('*, level:levels(*), uploader:profiles!macros_uploader_id_fkey(*)').neq('working_status', 'removed').gt('download_count', 0).order('download_count', { ascending: false }).limit(10),
      supabase().from('macros').select('*, level:levels(*), uploader:profiles!macros_uploader_id_fkey(*)').neq('working_status', 'removed').gt('like_count', 0).order('like_count', { ascending: false }).limit(10),
      supabase().from('levels').select('*').gt('total_downloads', 0).order('total_downloads', { ascending: false }).limit(10),
    ]);
    for (const result of [profiles, macros, liked, levels]) if (result.error) throw result.error;
    return { profiles: (profiles.data ?? []) as ProfileRow[], macros: (macros.data ?? []) as unknown as MacroRow[], liked: (liked.data ?? []) as unknown as MacroRow[], levels: (levels.data ?? []) as LevelRow[] };
  }, []);
  return <main className="mx-auto min-h-[75vh] max-w-7xl px-5 py-12 lg:px-8"><header><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-300">Real community activity</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">Leaderboards</h1><p className="mt-3 text-sm text-zinc-500">MacroHub activity only. Replay playback is never treated as completion proof.</p></header>{error && <div className="mt-7"><ErrorBox message={error} /></div>}{loading ? <div className="mt-8"><Loading /></div> : data && <div className="mt-9 grid gap-5 lg:grid-cols-2"><Board title="Top uploaders" icon={Upload} empty="No uploaders yet">{data.profiles.map((profile, index) => <Row key={profile.id} index={index} href={`/profile/${profile.username}`} title={`@${profile.username}`} detail={`${profile.macro_count} macros`} value={`${profile.total_downloads.toLocaleString()} downloads`} />)}</Board><Board title="Most downloaded macros" icon={Download} empty="No downloads yet">{data.macros.map((macro, index) => <Row key={macro.id} index={index} href={`/macro/${macro.id}`} title={macro.title} detail={macro.level?.name ?? `Level #${macro.level_id}`} value={`${macro.download_count.toLocaleString()} downloads`} />)}</Board><Board title="Most liked macros" icon={Heart} empty="No likes yet">{data.liked.map((macro, index) => <Row key={macro.id} index={index} href={`/macro/${macro.id}`} title={macro.title} detail={macro.level?.name ?? `Level #${macro.level_id}`} value={`${macro.like_count.toLocaleString()} likes`} />)}</Board><Board title="Popular levels" icon={Crown} empty="No level activity yet">{data.levels.map((level, index) => <Row key={level.id} index={index} href={`/level/${level.id}`} title={level.name} detail={`by ${level.creator}`} value={`${level.total_downloads.toLocaleString()} downloads`} />)}</Board></div>}</main>;
}

function Board({ title, icon: Icon, empty, children }: { title: string; icon: typeof Crown; empty: string; children: React.ReactNode }) { const items = Array.isArray(children) ? children : [children]; return <section className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5"><h2 className="flex items-center gap-2 font-semibold"><Icon className="h-4 w-4 text-violet-300" />{title}</h2><div className="mt-4 space-y-2">{items.length && items[0] ? items : <p className="py-8 text-center text-sm text-zinc-700">{empty}</p>}</div></section>; }
function Row({ index, href, title, detail, value }: { index: number; href: string; title: string; detail: string; value: string }) { return <Link to={href} className="flex items-center gap-3 rounded-xl border border-white/[.045] bg-white/[.018] p-3 hover:bg-white/[.04]"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[.04] text-xs font-semibold text-zinc-500">{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{title}</span><span className="mt-1 block truncate text-[10px] text-zinc-700">{detail}</span></span><span className="text-[10px] text-zinc-500">{value}</span></Link>; }
