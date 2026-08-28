import { Check, LoaderCircle, MessageCircleWarning, Search, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../components/avatar';
import { ErrorBox, Loading } from '../components/cards';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import type { ProfileRow } from '../lib/types';
import { useAsync } from '../lib/use-async';

type MacroReport = {
  id: string;
  macro_id: string;
  status: 'working' | 'broken' | 'outdated';
  details: string | null;
  created_at: string;
  macro?: {
    title: string;
    working_votes?: number;
    broken_votes?: number;
    outdated_votes?: number;
    community_flagged_at?: string | null;
  };
  reporter?: { username: string };
};

type CommentReport = {
  id: string;
  comment_id: string;
  reason: string;
  created_at: string;
  comment?: { body: string; macro_id: string; author?: { username: string } };
  reporter?: { username: string };
};

type LevelReport = {
  id: string;
  level_id: string;
  reason: string;
  created_at: string;
  level?: { id: string; name: string; creator: string };
  reporter?: { username: string };
};

function isLevelReportMigrationMissing(error: { message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? '';
  return message.includes('level_reports') || message.includes('submit_level_report');
}

export function AdminPage() {
  const { profile, loading: authLoading } = useAuth();
  const allowed = profile?.role === 'moderator' || profile?.role === 'admin';
  const [loadedAt] = useState(() => Date.now());
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const { data, error, loading, reload } = useAsync(async () => {
    if (!allowed) return { macroReports: [], commentReports: [], levelReports: [], users: [] };
    const [macroReports, commentReports, levelReports, users] = await Promise.all([
      supabase().from('macro_reports').select('*, macro:macros(*), reporter:profiles!macro_reports_reporter_id_fkey(username)').is('resolved_at', null).order('created_at').limit(100),
      supabase().from('comment_reports').select('*, comment:comments(body,macro_id,author:profiles!comments_author_id_fkey(username)), reporter:profiles!comment_reports_reporter_id_fkey(username)').is('resolved_at', null).order('created_at').limit(100),
      supabase().from('level_reports').select('*, level:levels!level_reports_level_id_fkey(id,name,creator), reporter:profiles!level_reports_reporter_id_fkey(username)').is('resolved_at', null).order('created_at').limit(100),
      supabase().from('profiles').select('*').order('joined_at', { ascending: false }).limit(200),
    ]);
    if (macroReports.error) throw macroReports.error;
    if (commentReports.error) throw commentReports.error;
    if (levelReports.error && !isLevelReportMigrationMissing(levelReports.error)) throw levelReports.error;
    if (users.error) throw users.error;
    const reviewableMacros = ((macroReports.data ?? []) as unknown as MacroReport[])
      .filter((report) => report.status !== 'working' && Boolean(report.macro?.community_flagged_at));
    const now = Date.now();
    const restrictedUsers = ((users.data ?? []) as ProfileRow[])
      .filter((person) => Boolean(person.banned_at || (person.restricted_until && Date.parse(person.restricted_until) > now)));
    return {
      macroReports: reviewableMacros,
      commentReports: (commentReports.data ?? []) as unknown as CommentReport[],
      levelReports: (levelReports.data ?? []) as unknown as LevelReport[],
      users: restrictedUsers,
    };
  }, [allowed]);

  async function macroAction(report: MacroReport, status: 'working' | 'unverified' | 'broken' | 'possibly_outdated' | 'removed') {
    setBusy(report.id);
    setActionError('');
    try {
      const { error: action } = status === 'working'
        ? await supabase().rpc('moderate_macro_mark_working', { p_macro_id: report.macro_id, p_reason: report.details ?? 'Moderator verified this macro.' })
        : await supabase().rpc('moderate_macro_status', { p_macro_id: report.macro_id, p_status: status, p_reason: report.details ?? `Community report: ${report.status}` });
      if (action) throw action;
      if (status !== 'working') {
        const { error: resolved } = await supabase().from('macro_reports').update({ resolved_at: new Date().toISOString(), resolved_by: profile!.id }).eq('id', report.id);
        if (resolved) throw resolved;
      }
      await reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Moderation action failed.');
    } finally {
      setBusy('');
    }
  }

  async function commentAction(report: CommentReport, remove: boolean) {
    setBusy(report.id);
    setActionError('');
    try {
      if (remove) {
        const { error: action } = await supabase().rpc('moderate_remove_comment', { p_comment_id: report.comment_id, p_reason: report.reason });
        if (action) throw action;
      }
      const { error: resolved } = await supabase().from('comment_reports').update({ resolved_at: new Date().toISOString() }).eq('id', report.id);
      if (resolved) throw resolved;
      await reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Moderation action failed.');
    } finally {
      setBusy('');
    }
  }

  async function levelAction(report: LevelReport) {
    setBusy(report.id);
    setActionError('');
    try {
      const { error: resolved } = await supabase().from('level_reports').update({
        resolved_at: new Date().toISOString(),
        resolved_by: profile!.id,
      }).eq('id', report.id);
      if (resolved) throw resolved;
      const { error: audit } = await supabase().from('moderation_actions').insert({
        moderator_id: profile!.id,
        target_type: 'report',
        target_id: report.id,
        action: 'dismiss_level_report',
        reason: report.reason,
      });
      if (audit) throw audit;
      await reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Level report could not be resolved.');
    } finally {
      setBusy('');
    }
  }

  async function userAction(target: ProfileRow, action: 'clear' | 'ban' | 'unban') {
    setBusy(target.id);
    setActionError('');
    try {
      const reasonInput = window.prompt(action === 'clear' ? 'Why are you clearing this restriction?' : `Reason to ${action} @${target.username}?`);
      if (reasonInput === null) return;
      const reason = reasonInput.trim();
      const result = action === 'clear'
        ? await supabase().rpc('moderate_clear_restriction', { p_user_id: target.id, p_reason: reason || 'Moderator review' })
        : await supabase().rpc('moderate_user_ban', { p_user_id: target.id, p_banned: action === 'ban', p_reason: reason || 'Moderator review' });
      if (result.error) throw result.error;
      await reload();
    } catch (caught) {
      const message = caught && typeof caught === 'object' && 'message' in caught ? String(caught.message) : '';
      setActionError(message || 'User moderation failed.');
    } finally {
      setBusy('');
    }
  }

  if (authLoading) return <main className="mx-auto max-w-7xl px-5 py-12"><Loading /></main>;
  if (!allowed) return <main className="grid min-h-[75vh] place-items-center px-5 text-center"><div><ShieldCheck className="mx-auto h-7 w-7 text-zinc-700" /><h1 className="mt-4 text-2xl font-semibold">Moderator access required</h1><p className="mt-2 text-sm text-zinc-600">This area is only available to MacroHub moderators.</p></div></main>;

  return <main className="mx-auto min-h-[75vh] max-w-7xl px-5 py-12 lg:px-8">
    <header>
      <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-300">Moderation</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-.045em]">Review reports and people</h1>
      <p className="mt-3 text-sm text-zinc-500">Every action is written to the moderation audit log.</p>
    </header>
    {error && <div className="mt-6"><ErrorBox message={error} /></div>}
    {actionError && <div className="mt-6"><ErrorBox message={actionError} /></div>}
    {loading ? <div className="mt-8"><Loading /></div> : data && <div className="mt-8 grid gap-5 lg:grid-cols-2">
      <Board title="Macro reports" count={data.macroReports.length}>
        {data.macroReports.map((report) => <article key={report.id} className="rounded-2xl border border-white/[.055] bg-white/[.018] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Link to={`/macro/${report.macro_id}`} className="text-sm font-semibold hover:text-violet-200">{report.macro?.title ?? 'Reported macro'}</Link>
              <p className="mt-1 text-[10px] text-zinc-700">@{report.reporter?.username ?? 'player'} · {new Date(report.created_at).toLocaleString()}</p>
            </div>
            <span className="rounded-lg bg-amber-400/[.08] px-2 py-1 text-[10px] capitalize text-amber-200">{report.status}</span>
          </div>
          <p className="mt-3 text-[10px] text-zinc-600">Working {report.macro?.working_votes ?? 0} · Broken {report.macro?.broken_votes ?? 0} · Outdated {report.macro?.outdated_votes ?? 0}</p>
          {report.details && <p className="mt-3 text-xs leading-5 text-zinc-500">{report.details}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {report.status !== 'working' && <Action disabled={Boolean(busy)} onClick={() => void macroAction(report, report.status === 'outdated' ? 'possibly_outdated' : report.status)} label={report.status === 'broken' ? 'Mark broken' : 'Mark outdated'} />}
            <Action disabled={Boolean(busy)} onClick={() => void macroAction(report, 'working')} label="Mark working and clear reviews" />
            <Action disabled={Boolean(busy)} onClick={() => void macroAction(report, 'unverified')} label="Dismiss" />
            {report.status === 'broken' && <Action danger disabled={Boolean(busy)} onClick={() => void macroAction(report, 'removed')} label="Remove" />}
            {busy === report.id && <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />}
          </div>
        </article>)}
      </Board>

      <Board title="Comment reports" count={data.commentReports.length}>
        {data.commentReports.map((report) => <article key={report.id} className="rounded-2xl border border-white/[.055] bg-white/[.018] p-4">
          <Link to={`/macro/${report.comment?.macro_id ?? ''}`} className="text-xs font-semibold hover:text-violet-200">Comment by @{report.comment?.author?.username ?? 'player'}</Link>
          <p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-500">{report.comment?.body}</p>
          <p className="mt-3 rounded-xl bg-amber-400/[.045] p-3 text-[11px] text-amber-100">Report: {report.reason}</p>
          <div className="mt-4 flex gap-2">
            <Action disabled={Boolean(busy)} onClick={() => void commentAction(report, false)} label="Dismiss" />
            <Action danger disabled={Boolean(busy)} onClick={() => void commentAction(report, true)} label="Remove comment" />
            {busy === report.id && <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />}
          </div>
        </article>)}
      </Board>

      <Board title="Level reports" count={data.levelReports.length}>
        {data.levelReports.map((report) => <article key={report.id} className="rounded-2xl border border-white/[.055] bg-white/[.018] p-4">
          <Link to={`/level/${report.level_id}`} className="text-sm font-semibold hover:text-violet-200">{report.level?.name ?? `Level #${report.level_id}`}</Link>
          <p className="mt-1 text-[10px] text-zinc-700">by {report.level?.creator ?? 'Unknown'} · reported by @{report.reporter?.username ?? 'player'} · {new Date(report.created_at).toLocaleString()}</p>
          <p className="mt-3 rounded-xl bg-amber-400/[.045] p-3 text-xs leading-5 text-amber-100">{report.reason}</p>
          <div className="mt-4 flex gap-2">
            <Action disabled={Boolean(busy)} onClick={() => void levelAction(report)} label="Dismiss report" />
            {busy === report.id && <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />}
          </div>
        </article>)}
      </Board>

      <AccountSearch busy={busy} currentUserId={profile.id} onAction={userAction} />

      <section className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5 lg:col-span-2">
        <h2 className="flex items-center gap-2 font-semibold"><UserRound className="h-4 w-4 text-violet-300" />Automatic restrictions<span className="text-xs text-zinc-700">{data.users.length}</span></h2>
        <p className="mt-2 text-xs text-zinc-600">Accounts listed here were automatically restricted or are currently banned.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.users.map((person) => {
            const restricted = Boolean(person.restricted_until && Date.parse(person.restricted_until) > loadedAt);
            return <PersonCard key={person.id} person={person} restricted={restricted} busy={busy} currentUserId={profile.id} onAction={userAction} />;
          })}
          {!data.users.length && <p className="py-8 text-sm text-zinc-700">No accounts are currently restricted or banned.</p>}
        </div>
      </section>
    </div>}
  </main>;
}

function AccountSearch({ busy, currentUserId, onAction }: {
  busy: string;
  currentUserId: string;
  onAction: (target: ProfileRow, action: 'clear' | 'ban' | 'unban') => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProfileRow[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [resultsLoadedAt, setResultsLoadedAt] = useState(() => Date.now());

  async function searchAccounts(event?: FormEvent) {
    event?.preventDefault();
    const cleaned = query.trim().replace(/[^\p{L}\p{N}_ -]/gu, '').slice(0, 50);
    if (!cleaned) {
      setResults([]);
      setSearched(false);
      setSearchError('Enter a username or display name.');
      return;
    }
    setSearching(true);
    setSearchError('');
    try {
      const pattern = `%${cleaned}%`;
      const { data, error } = await supabase().from('profiles').select('*')
        .or(`username.ilike.${pattern},display_name.ilike.${pattern}`)
        .order('username').limit(30);
      if (error) throw error;
      setResults((data ?? []) as ProfileRow[]);
      setResultsLoadedAt(Date.now());
      setSearched(true);
    } catch (caught) {
      const message = caught && typeof caught === 'object' && 'message' in caught ? String(caught.message) : '';
      setSearchError(message || 'Accounts could not be searched.');
    } finally {
      setSearching(false);
    }
  }

  async function act(person: ProfileRow, action: 'clear' | 'ban' | 'unban') {
    await onAction(person, action);
    await searchAccounts();
  }

  return <section className="rounded-[24px] border border-violet-400/10 bg-[#0e1118] p-5">
    <h2 className="flex items-center gap-2 font-semibold"><Search className="h-4 w-4 text-violet-300" />Find an account</h2>
    <p className="mt-2 text-xs leading-5 text-zinc-600">Search every account, including active users who never triggered an automatic restriction.</p>
    <form onSubmit={(event) => void searchAccounts(event)} className="mt-4 flex gap-2">
      <label className="min-w-0 flex-1">
        <span className="sr-only">Username or display name</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={50} placeholder="Username or display name" className="h-11 w-full rounded-xl border border-white/[.08] bg-[#11151d] px-3 text-sm outline-none transition focus:border-violet-400/35" />
      </label>
      <button type="submit" disabled={searching} className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-500 px-4 text-xs font-semibold disabled:opacity-50">{searching ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Search</button>
    </form>
    {searchError && <p role="alert" className="mt-3 text-xs text-rose-200">{searchError}</p>}
    <div className="mt-4 space-y-3">
      {results.map((person) => {
        const restricted = Boolean(person.restricted_until && Date.parse(person.restricted_until) > resultsLoadedAt);
        return <PersonCard key={person.id} person={person} restricted={restricted} busy={busy} currentUserId={currentUserId} onAction={act} />;
      })}
      {searched && !results.length && <p className="py-6 text-center text-sm text-zinc-700">No matching accounts.</p>}
    </div>
  </section>;
}

function PersonCard({ person, restricted, busy, currentUserId, onAction }: {
  person: ProfileRow;
  restricted: boolean;
  busy: string;
  currentUserId: string;
  onAction: (target: ProfileRow, action: 'clear' | 'ban' | 'unban') => Promise<void>;
}) {
  return <article className="rounded-2xl border border-white/[.055] bg-white/[.018] p-4">
    <div className="flex items-start justify-between gap-3">
      <Link to={`/profile/${person.username}`} className="flex min-w-0 items-center gap-2 hover:text-violet-200">
        <Avatar profile={person} className="h-9 w-9 rounded-xl text-xs" />
        <span className="min-w-0"><span className="block truncate text-sm font-semibold">@{person.username}</span>{person.display_name && <span className="block truncate text-[10px] text-zinc-600">{person.display_name}</span>}</span>
      </Link>
      <span className="text-[9px] uppercase text-zinc-600">{person.role}</span>
    </div>
    <p className="mt-3 text-[10px] text-zinc-600">{person.macro_count} macros · {person.total_downloads.toLocaleString()} downloads · {person.total_likes.toLocaleString()} likes</p>
    <p className={`mt-3 text-[10px] ${person.banned_at ? 'text-rose-300' : restricted ? 'text-amber-300' : 'text-emerald-300'}`}>{person.banned_at ? 'Permanently banned' : restricted ? `Restricted until ${new Date(person.restricted_until!).toLocaleString()}` : 'Active'}{person.restriction_strikes ? ` · ${person.restriction_strikes} strike${person.restriction_strikes === 1 ? '' : 's'}` : ''}</p>
    <div className="mt-4 flex flex-wrap gap-2">
      {restricted && <Action disabled={Boolean(busy)} onClick={() => void onAction(person, 'clear')} label="Clear restriction" />}
      {person.id !== currentUserId && <Action danger={!person.banned_at} disabled={Boolean(busy)} onClick={() => void onAction(person, person.banned_at ? 'unban' : 'ban')} label={person.banned_at ? 'Unban' : 'Ban'} />}
      {person.id === currentUserId && <span className="text-[10px] text-zinc-700">Your account</span>}
      {busy === person.id && <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />}
    </div>
  </article>;
}

function Board({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return <section className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5">
    <h2 className="flex items-center gap-2 font-semibold"><MessageCircleWarning className="h-4 w-4 text-violet-300" />{title}<span className="text-xs text-zinc-700">{count}</span></h2>
    <div className="mt-4 space-y-3">{count ? children : <p className="py-10 text-center text-sm text-zinc-700">Nothing to review.</p>}</div>
  </section>;
}

function Action({ label, danger, disabled, onClick }: { label: string; danger?: boolean; disabled: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[10px] font-semibold disabled:opacity-40 ${danger ? 'border-rose-400/15 text-rose-200' : 'border-white/[.07] text-zinc-400'}`}>{danger ? <Trash2 className="h-3 w-3" /> : <Check className="h-3 w-3" />}{label}</button>;
}
