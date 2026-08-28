import { AlertTriangle, CheckCircle2, Download, Flag, Heart, LoaderCircle, MessageCircle, Pencil, Reply, Send, Trash2, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { analyzeReplay } from '../../lib/replay/analyze';
import { assessConversion, convertReplay } from '../../lib/replay/conversion';
import { formatCompatibilityRegistry, formatRegistry, replayToolRegistry } from '../../lib/replay/registry';
import { validateCanonicalReplay } from '../../lib/replay/schema';
import type { CanonicalReplayV1 } from '../../lib/replay/types';
import { Empty, ErrorBox, Loading, Status } from '../components/cards';
import { addComment, getMacro, isLiked, listComments, recordDownload, toggleLike } from '../lib/catalog';
import { downloadArtifact } from '../lib/downloads';
import { useAuth } from '../lib/auth';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { CommentRow } from '../lib/types';
import { useAsync } from '../lib/use-async';

export function MacroPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [toolId, setToolId] = useState('');
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [likeState, setLikeState] = useState<{ macroId: string; userId: string; value: boolean } | null>(null);
  const { data, error, loading, reload } = useAsync(async () => {
    if (!isSupabaseConfigured()) return null;
    const macro = await getMacro(id);
    if (!macro) return null;
    const [{ data: canonical, error: fileError }, comments] = await Promise.all([
      supabase().storage.from('macrohub-files').download(macro.canonical_path),
      listComments(id),
    ]);
    if (fileError) throw fileError;
    const replay = validateCanonicalReplay(JSON.parse(await canonical.text())) as CanonicalReplayV1;
    return { macro, replay, comments };
  }, [id]);
  useEffect(() => {
    let active = true;
    if (user) void isLiked(id, user.id).then((value) => { if (active) setLikeState({ macroId: id, userId: user.id, value }); });
    return () => { active = false; };
  }, [id, user]);
  const liked = Boolean(user && likeState?.macroId === id && likeState.userId === user.id && likeState.value);
  const analysis = useMemo(() => data ? analyzeReplay(data.replay) : null, [data]);
  const formats = useMemo(() => {
    if (!data) return [];
    return formatRegistry.filter((format) => data.macro.available_format_ids.includes(format.id) && format.exporter).filter((format) => !toolId || formatCompatibilityRegistry.some((entry) => entry.formatId === format.id && entry.replayToolId === toolId && entry.verification !== 'unknown' && (entry.direction === 'import' || entry.direction === 'both'))).map((format) => ({ format, assessment: assessConversion(data.replay, format.id, toolId || null), compatibility: toolId ? formatCompatibilityRegistry.find((entry) => entry.formatId === format.id && entry.replayToolId === toolId) : null }));
  }, [data, toolId]);
  const tools = useMemo(() => !data ? [] : replayToolRegistry.filter((tool) => formatCompatibilityRegistry.some((entry) => entry.replayToolId === tool.id && data.macro.available_format_ids.includes(entry.formatId) && entry.verification !== 'unknown' && (entry.direction === 'import' || entry.direction === 'both'))), [data]);

  async function download(formatId: string) {
    if (!data) return;
    setBusy(formatId); setActionError('');
    try {
      const assessment = assessConversion(data.replay, formatId, toolId || null);
      const requiredIssues = assessment.issues.filter((issue) => issue.requiresAcknowledgement);
      if (requiredIssues.length && !window.confirm(`Continue with this conversion?\n\n${requiredIssues.map((issue) => `• ${issue.message}`).join('\n')}`)) return;
      const result = await convertReplay(data.replay, formatId, { replayToolId: toolId || null, acknowledgedIssueCodes: requiredIssues.map((issue) => issue.code) });
      downloadArtifact(result.artifact);
      void recordDownload(data.macro.id, formatId, toolId || null);
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : 'The conversion failed.'); }
    finally { setBusy(''); }
  }
  async function like() {
    if (!user) return;
    setBusy('like'); setActionError('');
    try { setLikeState({ macroId: id, userId: user.id, value: await toggleLike(id, user.id) }); await reload(); }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : 'Could not update the like.'); }
    finally { setBusy(''); }
  }

  if (loading) return <main className="mx-auto max-w-7xl px-5 py-12 lg:px-8"><Loading /></main>;
  if (error) return <main className="mx-auto max-w-4xl px-5 py-12"><ErrorBox message={error} /></main>;
  if (!data || !analysis) return <main className="mx-auto max-w-4xl px-5 py-12"><Empty title="Macro not found" text="This macro was removed, is private, or does not exist." /></main>;
  const { macro } = data;
  return <main className="mx-auto min-h-[75vh] max-w-7xl px-5 py-12 lg:px-8"><div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_310px]"><div className="space-y-6"><section className="rounded-[28px] border border-white/[.075] bg-[#0e1118] p-6 sm:p-8"><div className="flex flex-wrap items-center gap-3"><Status value={macro.working_status} /><Link to={`/level/${macro.level_id}`} className="text-xs text-zinc-500 hover:text-white">{macro.level?.name ?? `Level #${macro.level_id}`}</Link></div><h1 className="mt-5 text-3xl font-semibold tracking-[-.045em] sm:text-5xl">{macro.title}</h1><p className="mt-3 flex items-center gap-2 text-xs text-zinc-500"><UserRound className="h-3.5 w-3.5" />Uploaded by <Link className="text-zinc-300 hover:text-white" to={`/profile/${macro.uploader?.username ?? macro.uploader_id}`}>@{macro.uploader?.username ?? 'player'}</Link> · {new Date(macro.created_at).toLocaleDateString()}</p>{macro.description && <p className="mt-6 whitespace-pre-wrap text-sm leading-7 text-zinc-400">{macro.description}</p>}<div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Completion" value={macro.completion === null ? 'Unknown' : `${macro.completion}%`} /><Metric label="Inputs" value={macro.input_count.toLocaleString()} /><Metric label="Rate" value={macro.rate ? `${macro.rate} ${macro.rate_kind.toUpperCase()}` : 'Unknown'} /><Metric label="Duration" value={`${macro.duration_seconds.toFixed(2)}s`} /><Metric label="Player 1" value={`${macro.player1_inputs} inputs`} /><Metric label="Player 2" value={`${macro.player2_inputs} inputs`} /><Metric label="GD version" value={macro.recorded_gd_version ?? 'Unknown'} /><Metric label="Original" value={formatRegistry.find((format) => format.id === macro.original_format_id)?.displayName ?? macro.original_format_id} /></div></section>
        <Timeline replay={data.replay} />
        <section className="rounded-[28px] border border-white/[.075] bg-[#0e1118] p-6 sm:p-8"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">Downloads</p><h2 className="mt-2 text-2xl font-semibold">Filter for your replay tool</h2><p className="mt-2 text-xs text-zinc-600">Only verified or community-confirmed import formats are shown for a selected tool.</p></div><label className="block sm:w-64"><span className="sr-only">Replay tool</span><select value={toolId} onChange={(event) => setToolId(event.target.value)} className="h-12 w-full rounded-xl border border-white/[.08] bg-[#11151d] px-3 text-sm outline-none"><option value="">All formats</option>{tools.map((tool) => <option key={tool.id} value={tool.id}>{tool.displayName}</option>)}</select></label></div><div className="mt-6 grid gap-3 sm:grid-cols-2">{formats.map(({ format, assessment, compatibility }) => <article key={format.id} className="rounded-[20px] border border-white/[.07] bg-white/[.018] p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{format.displayName}</h3>{compatibility?.recommended && <span className="rounded-md bg-violet-400/10 px-2 py-1 text-[9px] text-violet-200">Recommended</span>}</div><p className="mt-1 text-xs text-zinc-600">{format.extensions.join(', ')}</p></div><CheckCircle2 className="h-4 w-4 text-emerald-300" /></div>{assessment.decision === 'allowed' && <p className={`mt-3 text-[10px] font-semibold uppercase tracking-wider ${assessment.fidelity === 'lossless' ? 'text-emerald-300' : 'text-amber-300'}`}>{assessment.fidelity.replace('-', ' ')}</p>}{assessment.issues.length > 0 && <p className="mt-2 text-[11px] leading-5 text-zinc-500">{assessment.issues.map((issue) => issue.message).join(' ')}</p>}<button disabled={assessment.decision === 'blocked' || Boolean(busy)} onClick={() => void download(format.id)} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-violet-500 text-xs font-semibold hover:bg-violet-400 disabled:opacity-35">{busy === format.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}Download</button></article>)}</div>{!formats.length && <p className="mt-6 rounded-2xl border border-dashed border-white/[.08] p-8 text-center text-sm text-zinc-600">No compatible generated format is available for that tool.</p>}</section>
        <Comments macroId={id} comments={data.comments} onChanged={reload} />
      </div><aside className="space-y-4 lg:sticky lg:top-24"><section className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5"><div className="grid grid-cols-2 gap-3"><Metric label="Downloads" value={macro.download_count.toLocaleString()} /><Metric label="Likes" value={macro.like_count.toLocaleString()} /></div>{user ? <button type="button" disabled={Boolean(busy)} onClick={() => void like()} className={`mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-xs font-semibold ${liked ? 'border-rose-400/20 bg-rose-400/[.09] text-rose-200' : 'border-white/[.08] bg-white/[.04] text-zinc-300'}`}><Heart className={`h-4 w-4 ${liked ? 'fill-current' : ''}`} />{liked ? 'Liked' : 'Like macro'}</button> : <Link to={`/login?return_to=${encodeURIComponent(`/macro/${id}`)}`} className="mt-4 flex h-11 items-center justify-center rounded-xl bg-white/[.05] text-xs font-semibold">Sign in to like</Link>}</section><section className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5"><h2 className="text-sm font-semibold">Works with</h2><div className="mt-4 flex flex-wrap gap-2">{tools.map((tool) => <span key={tool.id} className="rounded-lg border border-white/[.07] bg-white/[.03] px-2.5 py-1.5 text-[10px] text-zinc-400">{tool.displayName}</span>)}</div></section><ReportMacro macroId={id} /></aside></div>
    {actionError && <div role="alert" className="fixed bottom-5 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 gap-2 rounded-xl border border-rose-400/20 bg-[#171019] px-4 py-3 text-xs text-rose-200 shadow-2xl"><AlertTriangle className="h-4 w-4 shrink-0" />{actionError}</div>}
  </main>;
}

function Timeline({ replay }: { replay: CanonicalReplayV1 }) {
  const inputs = replay.events.filter((event) => event.kind === 'input');
  const maximum = Math.max(1, Number(BigInt(replay.durationTicks ?? inputs.at(-1)?.tick ?? '1')));
  return <section className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-6"><h2 className="text-sm font-semibold">Input timeline</h2><div className="relative mt-5 h-20 overflow-hidden rounded-xl border border-white/[.06] bg-[#090b10]"><div className="absolute left-3 right-3 top-1/2 h-px bg-white/[.08]" />{inputs.slice(0, 600).map((event, index) => <span key={`${event.tick}-${event.order}-${index}`} title={`P${event.player} ${event.state} at tick ${event.tick}`} className={`absolute h-2 w-0.5 rounded-full ${event.player === 2 ? 'bg-cyan-300' : event.state === 'press' ? 'bg-violet-300' : 'bg-violet-600'}`} style={{ left: `${Math.min(99, (Number(BigInt(event.tick)) / maximum) * 100)}%`, top: event.player === 2 ? '57%' : '35%' }} />)}</div><div className="mt-3 flex justify-between text-[10px] text-zinc-700"><span>Start</span><span>{inputs.length.toLocaleString()} inputs</span><span>End</span></div></section>;
}

function ReportMacro({ macroId }: { macroId: string }) {
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  async function report(status: 'working' | 'broken' | 'outdated') {
    if (!user) return;
    setMessage('Saving…');
    const { error } = await supabase().from('macro_reports').upsert({ macro_id: macroId, reporter_id: user.id, status }, { onConflict: 'macro_id,reporter_id' });
    setMessage(error ? error.message : 'Report saved.');
  }
  return <section className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5"><h2 className="text-sm font-semibold">Does this macro work?</h2>{user ? <div className="mt-4 grid grid-cols-3 gap-2">{(['working', 'broken', 'outdated'] as const).map((status) => <button key={status} type="button" onClick={() => void report(status)} className="rounded-lg border border-white/[.07] bg-white/[.025] px-2 py-2 text-[9px] capitalize text-zinc-400 hover:text-white">{status}</button>)}</div> : <Link to={`/login?return_to=${encodeURIComponent(`/macro/${macroId}`)}`} className="mt-4 inline-flex text-xs font-semibold text-violet-300">Sign in to report</Link>}{message && <p className="mt-3 text-[10px] leading-4 text-zinc-600">{message}</p>}</section>;
}

function Comments({ macroId, comments, onChanged }: { macroId: string; comments: CommentRow[]; onChanged: () => Promise<void> }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (!user) return; const form = event.currentTarget; const data = new FormData(form); const body = String(data.get('body') ?? '').trim(); if (!body) return; setBusy(true); setError(''); try { await addComment(macroId, user.id, body); form.reset(); await onChanged(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not post the comment.'); } finally { setBusy(false); } }
  async function remove(id: string) { if (!user) return; setBusy(true); setError(''); try { const { error: deleteError } = await supabase().from('comments').delete().eq('id', id).eq('author_id', user.id); if (deleteError) throw deleteError; await onChanged(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not delete the comment.'); } finally { setBusy(false); } }
  async function reply(comment: CommentRow) { if (!user) return; const body = window.prompt(`Reply to @${comment.author?.username ?? 'player'}`)?.trim(); if (!body) return; setBusy(true); setError(''); try { await addComment(macroId, user.id, body.slice(0, 2000), comment.id); await onChanged(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not post the reply.'); } finally { setBusy(false); } }
  async function edit(comment: CommentRow) { if (!user || user.id !== comment.author_id) return; const body = window.prompt('Edit your comment', comment.body)?.trim(); if (!body || body === comment.body) return; setBusy(true); setError(''); try { const { error: updateError } = await supabase().from('comments').update({ body: body.slice(0, 2000) }).eq('id', comment.id).eq('author_id', user.id); if (updateError) throw updateError; await onChanged(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not edit the comment.'); } finally { setBusy(false); } }
  async function report(comment: CommentRow) { if (!user) return; const reason = window.prompt('Why are you reporting this comment?')?.trim(); if (!reason) return; setBusy(true); setError(''); try { const { error: reportError } = await supabase().from('comment_reports').insert({ comment_id: comment.id, reporter_id: user.id, reason: reason.slice(0, 1000) }); if (reportError) throw reportError; } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not report the comment.'); } finally { setBusy(false); } }
  return <section className="rounded-[28px] border border-white/[.075] bg-[#0e1118] p-6 sm:p-8"><h2 className="flex items-center gap-2 text-xl font-semibold"><MessageCircle className="h-5 w-5 text-violet-300" />Comments <span className="text-sm text-zinc-600">{comments.length}</span></h2>{user ? <form onSubmit={(event) => void submit(event)} className="mt-5 flex items-end gap-2"><label className="min-w-0 flex-1"><span className="sr-only">Comment</span><textarea required name="body" maxLength={2000} rows={2} placeholder="Share a helpful comment" className="w-full resize-none rounded-xl border border-white/[.08] bg-[#11151d] p-3 text-sm outline-none" /></label><button disabled={busy} className="grid h-12 w-12 place-items-center rounded-xl bg-violet-500"><Send className="h-4 w-4" /></button></form> : <Link to={`/login?return_to=${encodeURIComponent(`/macro/${macroId}`)}`} className="mt-5 inline-flex rounded-xl bg-white/[.05] px-4 py-3 text-xs font-semibold">Sign in to comment</Link>}{error && <p className="mt-3 text-xs text-rose-200">{error}</p>}<div className="mt-6 space-y-3">{comments.map((comment) => <article key={comment.id} className={`rounded-2xl border border-white/[.055] bg-white/[.018] p-4 ${comment.parent_id ? 'ml-5 sm:ml-10' : ''}`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold">@{comment.author?.username ?? 'player'}</p><p className="mt-1 text-[10px] text-zinc-700">{comment.parent_id ? 'Reply · ' : ''}{new Date(comment.created_at).toLocaleString()}{comment.edited_at ? ' · edited' : ''}</p></div>{user && <div className="flex gap-2">{user.id === comment.author_id ? <><button type="button" disabled={busy} onClick={() => void edit(comment)} aria-label="Edit comment" className="text-zinc-700 hover:text-violet-300"><Pencil className="h-3.5 w-3.5" /></button><button type="button" disabled={busy} onClick={() => void remove(comment.id)} aria-label="Delete comment" className="text-zinc-700 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button></> : <button type="button" disabled={busy} onClick={() => void report(comment)} aria-label="Report comment" className="text-zinc-700 hover:text-amber-300"><Flag className="h-3.5 w-3.5" /></button>}</div>}</div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-400">{comment.body}</p>{user && !comment.parent_id && <button type="button" disabled={busy} onClick={() => void reply(comment)} className="mt-3 inline-flex items-center gap-1.5 text-[10px] text-zinc-600 hover:text-white"><Reply className="h-3 w-3" />Reply</button>}</article>)}{!comments.length && <p className="py-8 text-center text-sm text-zinc-700">No comments yet.</p>}</div></section>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/[.055] bg-white/[.025] p-3"><p className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</p><p className="mt-1.5 truncate text-xs font-semibold text-zinc-200">{value}</p></div>; }
