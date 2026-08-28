import { Check, LoaderCircle, MessageCircleWarning, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBox, Loading } from '../components/cards';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { useAsync } from '../lib/use-async';

type MacroReport = { id: string; macro_id: string; status: 'working' | 'broken' | 'outdated'; details: string | null; created_at: string; macro?: { title: string }; reporter?: { username: string } };
type CommentReport = { id: string; comment_id: string; reason: string; created_at: string; comment?: { body: string; macro_id: string; author?: { username: string } }; reporter?: { username: string } };

export function AdminPage() {
  const { profile, loading: authLoading } = useAuth();
  const allowed = profile?.role === 'moderator' || profile?.role === 'admin';
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const { data, error, loading, reload } = useAsync(async () => {
    if (!allowed) return { macroReports: [], commentReports: [] };
    const [macroReports, commentReports] = await Promise.all([
      supabase().from('macro_reports').select('*, macro:macros(title), reporter:profiles!macro_reports_reporter_id_fkey(username)').is('resolved_at', null).order('created_at').limit(100),
      supabase().from('comment_reports').select('*, comment:comments(body,macro_id,author:profiles(username)), reporter:profiles!comment_reports_reporter_id_fkey(username)').is('resolved_at', null).order('created_at').limit(100),
    ]);
    if (macroReports.error) throw macroReports.error;
    if (commentReports.error) throw commentReports.error;
    return { macroReports: (macroReports.data ?? []) as unknown as MacroReport[], commentReports: (commentReports.data ?? []) as unknown as CommentReport[] };
  }, [allowed]);

  async function macroAction(report: MacroReport, status: 'working' | 'unverified' | 'broken' | 'possibly_outdated' | 'removed') {
    setBusy(report.id); setActionError('');
    try {
      const { error: action } = await supabase().rpc('moderate_macro_status', { p_macro_id: report.macro_id, p_status: status, p_reason: report.details ?? `Community report: ${report.status}` });
      if (action) throw action;
      const { error: resolved } = await supabase().from('macro_reports').update({ resolved_at: new Date().toISOString(), resolved_by: profile!.id }).eq('id', report.id);
      if (resolved) throw resolved;
      await reload();
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : 'Moderation action failed.'); }
    finally { setBusy(''); }
  }
  async function commentAction(report: CommentReport, remove: boolean) {
    setBusy(report.id); setActionError('');
    try {
      if (remove) { const { error: action } = await supabase().rpc('moderate_remove_comment', { p_comment_id: report.comment_id, p_reason: report.reason }); if (action) throw action; }
      const { error: resolved } = await supabase().from('comment_reports').update({ resolved_at: new Date().toISOString() }).eq('id', report.id);
      if (resolved) throw resolved;
      await reload();
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : 'Moderation action failed.'); }
    finally { setBusy(''); }
  }

  if (authLoading) return <main className="mx-auto max-w-7xl px-5 py-12"><Loading /></main>;
  if (!allowed) return <main className="grid min-h-[75vh] place-items-center px-5 text-center"><div><ShieldCheck className="mx-auto h-7 w-7 text-zinc-700" /><h1 className="mt-4 text-2xl font-semibold">Moderator access required</h1><p className="mt-2 text-sm text-zinc-600">This area is only available to MacroHub moderators.</p></div></main>;
  return <main className="mx-auto min-h-[75vh] max-w-7xl px-5 py-12 lg:px-8"><header><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-300">Moderation</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.045em]">Review reports</h1><p className="mt-3 text-sm text-zinc-500">Every action is written to the moderation audit log.</p></header>{error && <div className="mt-6"><ErrorBox message={error} /></div>}{actionError && <div className="mt-6"><ErrorBox message={actionError} /></div>}{loading ? <div className="mt-8"><Loading /></div> : data && <div className="mt-8 grid gap-5 lg:grid-cols-2"><Board title="Macro reports" count={data.macroReports.length}>{data.macroReports.map((report) => <article key={report.id} className="rounded-2xl border border-white/[.055] bg-white/[.018] p-4"><div className="flex items-start justify-between gap-3"><div><Link to={`/macro/${report.macro_id}`} className="text-sm font-semibold hover:text-violet-200">{report.macro?.title ?? 'Reported macro'}</Link><p className="mt-1 text-[10px] text-zinc-700">@{report.reporter?.username ?? 'player'} · {new Date(report.created_at).toLocaleString()}</p></div><span className="rounded-lg bg-amber-400/[.08] px-2 py-1 text-[10px] capitalize text-amber-200">{report.status}</span></div>{report.details && <p className="mt-3 text-xs leading-5 text-zinc-500">{report.details}</p>}<div className="mt-4 flex flex-wrap gap-2"><Action disabled={Boolean(busy)} onClick={() => void macroAction(report, report.status === 'outdated' ? 'possibly_outdated' : report.status)} label={report.status === 'working' ? 'Mark working' : report.status === 'broken' ? 'Mark broken' : 'Mark outdated'} /><Action disabled={Boolean(busy)} onClick={() => void macroAction(report, 'unverified')} label="Dismiss" />{report.status === 'broken' && <Action danger disabled={Boolean(busy)} onClick={() => void macroAction(report, 'removed')} label="Remove" />}{busy === report.id && <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />}</div></article>)}</Board><Board title="Comment reports" count={data.commentReports.length}>{data.commentReports.map((report) => <article key={report.id} className="rounded-2xl border border-white/[.055] bg-white/[.018] p-4"><Link to={`/macro/${report.comment?.macro_id ?? ''}`} className="text-xs font-semibold hover:text-violet-200">Comment by @{report.comment?.author?.username ?? 'player'}</Link><p className="mt-2 line-clamp-3 text-xs leading-5 text-zinc-500">{report.comment?.body}</p><p className="mt-3 rounded-xl bg-amber-400/[.045] p-3 text-[11px] text-amber-100">Report: {report.reason}</p><div className="mt-4 flex gap-2"><Action disabled={Boolean(busy)} onClick={() => void commentAction(report, false)} label="Dismiss" /><Action danger disabled={Boolean(busy)} onClick={() => void commentAction(report, true)} label="Remove comment" />{busy === report.id && <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />}</div></article>)}</Board></div>}</main>;
}

function Board({ title, count, children }: { title: string; count: number; children: React.ReactNode }) { return <section className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5"><h2 className="flex items-center gap-2 font-semibold"><MessageCircleWarning className="h-4 w-4 text-violet-300" />{title}<span className="text-xs text-zinc-700">{count}</span></h2><div className="mt-4 space-y-3">{count ? children : <p className="py-10 text-center text-sm text-zinc-700">Nothing to review.</p>}</div></section>; }
function Action({ label, danger, disabled, onClick }: { label: string; danger?: boolean; disabled: boolean; onClick: () => void }) { return <button type="button" disabled={disabled} onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[10px] font-semibold disabled:opacity-40 ${danger ? 'border-rose-400/15 text-rose-200' : 'border-white/[.07] text-zinc-400'}`}>{danger ? <Trash2 className="h-3 w-3" /> : <Check className="h-3 w-3" />}{label}</button>; }
