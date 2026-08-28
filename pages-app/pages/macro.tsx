import { AlertTriangle, CheckCircle2, Download, Flag, Heart, LoaderCircle, MessageCircle, Pencil, Reply, Send, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { analyzeReplay } from '../../lib/replay/analyze';
import { assessUniversalConversion, convertUniversalReplay } from '../../lib/replay/conversion';
import { formatRegistry } from '../../lib/replay/registry';
import { validateCanonicalReplay } from '../../lib/replay/schema';
import type { CanonicalReplayV1 } from '../../lib/replay/types';
import { formatGeometryDashVersion } from '../../lib/utils';
import { Empty, ErrorBox, Loading, Status } from '../components/cards';
import { Avatar } from '../components/avatar';
import { addComment, getMacro, isLiked, listComments, recordDownload, toggleLike } from '../lib/catalog';
import { downloadArtifact } from '../lib/downloads';
import { useAuth } from '../lib/auth';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { CommentRow, MacroRow } from '../lib/types';
import { useAsync } from '../lib/use-async';

export function MacroPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [likeState, setLikeState] = useState<{ macroId: string; userId: string; value: boolean } | null>(null);
  const restricted = Boolean(profile?.banned_at || profile?.restricted_until);
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
    return formatRegistry
      .filter((format) => Boolean(format.exporter))
      .map((format) => ({ format, assessment: assessUniversalConversion(data.replay, format.id) }));
  }, [data]);

  async function download(formatId: string) {
    if (!data) return;
    setBusy(formatId); setActionError('');
    try {
      const replay = formatId === 'macrohub-json' ? replayWithLevelCatalog(data.replay, data.macro) : data.replay;
      const result = await convertUniversalReplay(replay, formatId);
      downloadArtifact(result.artifact);
      void recordDownload(data.macro.id, formatId);
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : 'The conversion failed.'); }
    finally { setBusy(''); }
  }
  async function like() {
    if (!user) return;
    if (restricted) { setActionError('Your account is temporarily restricted. Downloads and the converter still work.'); return; }
    setBusy('like'); setActionError('');
    try { setLikeState({ macroId: id, userId: user.id, value: await toggleLike(id, user.id) }); await reload(); }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : 'Could not update the like.'); }
    finally { setBusy(''); }
  }
  async function removeMacro() {
    if (!data || !user || data.macro.uploader_id !== user.id) return;
    if (!window.confirm(`Delete “${data.macro.title}”? This cannot be undone.`)) return;
    setBusy('delete'); setActionError('');
    try {
      const { data: deleted, error: deleteError } = await supabase().from('macros').delete().eq('id', data.macro.id).eq('uploader_id', user.id).select('id').maybeSingle();
      if (deleteError) throw deleteError;
      if (!deleted) throw new Error('The macro could not be deleted. Run the latest Supabase migration first.');
      const paths = [...new Set([data.macro.original_path, data.macro.canonical_path].filter(Boolean))];
      if (paths.length) await supabase().storage.from('macrohub-files').remove(paths);
      navigate(profile?.username ? `/profile/${profile.username}` : '/browse', { replace: true });
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : 'Could not delete the macro.'); }
    finally { setBusy(''); }
  }

  if (loading) return <main className="mx-auto max-w-7xl px-5 py-12 lg:px-8"><Loading /></main>;
  if (error) return <main className="mx-auto max-w-4xl px-5 py-12"><ErrorBox message={error} /></main>;
  if (!data || !analysis) return <main className="mx-auto max-w-4xl px-5 py-12"><Empty title="Macro not found" text="This macro was removed, is private, or does not exist." /></main>;
  const { macro } = data;
  return <main className="mx-auto min-h-[75vh] max-w-7xl px-5 py-12 lg:px-8"><div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_310px]"><div className="space-y-6"><section className="rounded-[28px] border border-white/[.075] bg-[#0e1118] p-6 sm:p-8"><div className="flex flex-wrap items-center gap-3"><Status value={macro.working_status} /><Link to={`/level/${macro.level_id}`} className="text-xs text-zinc-500 hover:text-white">{macro.level?.name ?? `Level #${macro.level_id}`}</Link></div><h1 className="mt-5 text-3xl font-semibold tracking-[-.045em] sm:text-5xl">{macro.title}</h1><p className="mt-3 flex items-center gap-2 text-xs text-zinc-500"><Avatar profile={macro.uploader} className="h-6 w-6 rounded-lg text-[9px]" />Uploaded by <Link className="text-zinc-300 hover:text-white" to={`/profile/${macro.uploader?.username ?? macro.uploader_id}`}>@{macro.uploader?.username ?? 'player'}</Link> · {new Date(macro.created_at).toLocaleDateString()}</p>{macro.description && <p className="mt-6 whitespace-pre-wrap text-sm leading-7 text-zinc-400">{macro.description}</p>}<div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Completion" value={macro.completion === null ? 'Unknown' : `${macro.completion}%`} /><Metric label="Inputs" value={macro.input_count.toLocaleString()} /><Metric label="Rate" value={macro.rate ? `${macro.rate} ${macro.rate_kind.toUpperCase()}` : 'Unknown'} /><Metric label="Duration" value={`${macro.duration_seconds.toFixed(2)}s`} /><Metric label="Player 1" value={`${macro.player1_inputs} inputs`} /><Metric label="Player 2" value={`${macro.player2_inputs} inputs`} /><Metric label="GD version" value={formatGeometryDashVersion(macro.recorded_gd_version)} /><Metric label="Original" value={formatRegistry.find((format) => format.id === macro.original_format_id)?.displayName ?? macro.original_format_id} /></div></section>
        <Timeline replay={data.replay} />
        <section className="rounded-[28px] border border-white/[.075] bg-[#0e1118] p-6 sm:p-8"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">Downloads</p><h2 className="mt-2 text-2xl font-semibold">Download in any format</h2><p className="mt-2 text-xs text-zinc-600">Choose any implemented output format below.</p></div><div className="mt-6 grid gap-3 sm:grid-cols-2">{formats.map(({ format, assessment }) => { const allowed = assessment.decision === 'allowed'; return <article key={format.id} className={`rounded-[20px] border p-4 ${allowed ? 'border-white/[.07] bg-white/[.018]' : 'border-white/[.045] bg-white/[.01] opacity-60'}`}><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{format.displayName}</h3><p className="mt-1 text-xs text-zinc-600">{format.extensions.join(', ')}</p></div>{allowed ? <CheckCircle2 aria-label="Download available" className="h-4 w-4 text-emerald-300" /> : <AlertTriangle aria-label="Download unavailable" className="h-4 w-4 text-amber-300" />}</div><button disabled={!allowed || Boolean(busy)} onClick={() => void download(format.id)} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-violet-500 text-xs font-semibold hover:bg-violet-400 disabled:opacity-35">{busy === format.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}{allowed ? 'Download' : 'Unavailable'}</button></article>; })}</div></section>
        <Comments macroId={id} comments={data.comments} onChanged={reload} />
      </div><aside className="space-y-4 lg:sticky lg:top-24"><section className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5"><div className="grid grid-cols-2 gap-3"><Metric label="Downloads" value={macro.download_count.toLocaleString()} /><Metric label="Likes" value={macro.like_count.toLocaleString()} /></div>{user ? <button type="button" disabled={Boolean(busy)} onClick={() => void like()} className={`mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-xs font-semibold ${liked ? 'border-rose-400/20 bg-rose-400/[.09] text-rose-200' : 'border-white/[.08] bg-white/[.04] text-zinc-300'}`}><Heart className={`h-4 w-4 ${liked ? 'fill-current' : ''}`} />{liked ? 'Liked' : 'Like macro'}</button> : <Link to={`/login?return_to=${encodeURIComponent(`/macro/${id}`)}`} className="mt-4 flex h-11 items-center justify-center rounded-xl bg-white/[.05] text-xs font-semibold">Sign in to like</Link>}{user?.id === macro.uploader_id && <button type="button" disabled={Boolean(busy)} onClick={() => void removeMacro()} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-rose-400/15 text-xs font-semibold text-rose-200 hover:bg-rose-400/[.06] disabled:opacity-40">{busy === 'delete' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}Delete macro</button>}</section><ReportMacro macro={macro} /><MacroModerationReport macro={macro} /></aside></div>
    {actionError && <div role="alert" className="fixed bottom-5 left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 gap-2 rounded-xl border border-rose-400/20 bg-[#171019] px-4 py-3 text-xs text-rose-200 shadow-2xl"><AlertTriangle className="h-4 w-4 shrink-0" />{actionError}</div>}
  </main>;
}

function replayWithLevelCatalog(replay: CanonicalReplayV1, macro: MacroRow): CanonicalReplayV1 {
  const level = macro.level;
  if (!level) return replay;
  return validateCanonicalReplay({
    ...replay,
    level: {
      id: replay.level.id ?? { value: level.id, provenance: { kind: 'level-provider' as const } },
      name: replay.level.name ?? { value: level.name, provenance: { kind: 'level-provider' as const } },
    },
    extensions: {
      ...replay.extensions,
      'geometry-dash/level': {
        id: level.id,
        name: level.name,
        creator: level.creator,
        difficulty: level.difficulty,
        demonDifficulty: level.demon_difficulty,
        stars: level.stars,
        length: level.length,
        geometryDashVersion: level.gd_version,
      },
    },
  });
}

function Timeline({ replay }: { replay: CanonicalReplayV1 }) {
  const inputs = replay.events.filter((event) => event.kind === 'input');
  const maximum = Math.max(1, Number(BigInt(replay.durationTicks ?? inputs.at(-1)?.tick ?? '1')));
  return <section className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-6"><h2 className="text-sm font-semibold">Input timeline</h2><div className="relative mt-5 h-20 overflow-hidden rounded-xl border border-white/[.06] bg-[#090b10]"><div className="absolute left-3 right-3 top-1/2 h-px bg-white/[.08]" />{inputs.slice(0, 600).map((event, index) => <span key={`${event.tick}-${event.order}-${index}`} title={`P${event.player} ${event.state} at tick ${event.tick}`} className={`absolute h-2 w-0.5 rounded-full ${event.player === 2 ? 'bg-cyan-300' : event.state === 'press' ? 'bg-violet-300' : 'bg-violet-600'}`} style={{ left: `${Math.min(99, (Number(BigInt(event.tick)) / maximum) * 100)}%`, top: event.player === 2 ? '57%' : '35%' }} />)}</div><div className="mt-3 flex justify-between text-[10px] text-zinc-700"><span>Start</span><span>{inputs.length.toLocaleString()} inputs</span><span>End</span></div></section>;
}

function ReportMacro({ macro }: { macro: MacroRow }) {
  const { user, profile } = useAuth();
  const [message, setMessage] = useState('');
  const [review, setReview] = useState<'working' | 'broken' | 'outdated' | null>(null);
  const [counts, setCounts] = useState(() => ({ working: macro.working_votes ?? 0, broken: macro.broken_votes ?? 0, outdated: macro.outdated_votes ?? 0 }));
  const { working, broken, outdated } = counts;
  const total = working + broken + outdated;
  const communityWarning = total >= 10 && broken + outdated > working;
  const restricted = Boolean(profile?.banned_at || profile?.restricted_until);
  const voteWeight = profile?.role === 'moderator' || profile?.role === 'admin' ? 10 : 1;

  useEffect(() => {
    let active = true;
    if (!user) return () => { active = false; };
    if (voteWeight === 10) {
      void supabase().from('macro_reports').select('reporter_id,status,reporter:profiles!macro_reports_reporter_id_fkey(role)').eq('macro_id', macro.id).is('resolved_at', null).then(({ data }) => {
        if (!active) return;
        const reviews = (data ?? []) as unknown as Array<{ reporter_id: string; status: 'working' | 'broken' | 'outdated'; reporter?: { role?: string } }>;
        const weighted = { working: 0, broken: 0, outdated: 0 };
        for (const review of reviews) weighted[review.status] += review.reporter?.role === 'moderator' || review.reporter?.role === 'admin' ? 10 : 1;
        setCounts(weighted);
        setReview(reviews.find((item) => item.reporter_id === user.id)?.status ?? null);
      });
      return () => { active = false; };
    }
    void supabase().from('macro_reports').select('status').eq('macro_id', macro.id).eq('reporter_id', user.id).maybeSingle().then(({ data }) => {
      if (active) setReview((data?.status as typeof review) ?? null);
    });
    return () => { active = false; };
  }, [macro.id, user, voteWeight]);

  async function report(status: 'working' | 'broken' | 'outdated') {
    if (!user) return;
    if (restricted) { setMessage('Your account is temporarily restricted.'); return; }
    setMessage('Saving…');
    let { error } = await supabase().rpc('submit_macro_review', { p_macro_id: macro.id, p_status: status });
    if (error && (error.code === 'PGRST202' || error.message.toLowerCase().includes('submit_macro_review'))) {
      const fallback = await supabase().from('macro_reports').upsert({ macro_id: macro.id, reporter_id: user.id, status, created_at: new Date().toISOString(), resolved_at: null, resolved_by: null }, { onConflict: 'macro_id,reporter_id' });
      error = fallback.error;
    }
    if (error) setMessage(error.message);
    else {
      setCounts((current) => {
        const next = { ...current };
        if (review) next[review] = Math.max(0, next[review] - voteWeight);
        next[status] += voteWeight;
        return next;
      });
      setReview(status);
      setMessage('Review saved. You can change it anytime.');
    }
  }
  return <section className={`rounded-[24px] border p-5 ${communityWarning ? 'border-amber-400/20 bg-amber-400/[.055]' : 'border-white/[.075] bg-[#0e1118]'}`}><h2 className="text-sm font-semibold">Does this macro work?</h2>{communityWarning && <p role="alert" className="mt-3 text-xs leading-5 text-amber-100">Community warning: broken and outdated reviews outnumber working reviews.</p>}<div className="mt-4 grid grid-cols-3 gap-2">{([['working', working], ['broken', broken], ['outdated', outdated]] as const).map(([status, count]) => user ? <button key={status} type="button" disabled={restricted} onClick={() => void report(status)} className={`rounded-lg border px-2 py-2 text-[9px] capitalize transition disabled:cursor-not-allowed disabled:opacity-40 ${review === status ? 'border-violet-400/35 bg-violet-400/15 text-violet-100' : 'border-white/[.07] bg-white/[.025] text-zinc-400 hover:text-white'}`}>{status}<span className="ml-1 text-zinc-600">{count}</span></button> : <span key={status} className="rounded-lg border border-white/[.06] bg-white/[.02] px-2 py-2 text-center text-[9px] capitalize text-zinc-500">{status}<span className="ml-1 text-zinc-700">{count}</span></span>)}</div>{!user && <Link to={`/login?return_to=${encodeURIComponent(`/macro/${macro.id}`)}`} className="mt-4 inline-flex text-xs font-semibold text-violet-300">Sign in to review</Link>}{restricted && <p className="mt-3 text-[10px] leading-4 text-amber-200">Reviews are unavailable while your account is restricted.</p>}{voteWeight === 10 && <p className="mt-3 text-[10px] leading-4 text-violet-300">Your moderator review counts as 10.</p>}{message && <p className="mt-3 text-[10px] leading-4 text-zinc-600">{message}</p>}<p className="mt-3 text-[9px] leading-4 text-zinc-700">A community warning needs at least 10 reviews.</p></section>;
}

function MacroModerationReport({ macro }: { macro: MacroRow }) {
  const { user, profile } = useAuth();
  const [reportedMacroId, setReportedMacroId] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const reported = Boolean(user && reportedMacroId === macro.id);
  const restricted = Boolean(profile?.banned_at || profile?.restricted_until);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void supabase().from('macro_content_reports').select('id').eq('macro_id', macro.id).eq('reporter_id', user.id).maybeSingle().then(({ data }) => {
      if (active) setReportedMacroId(data ? macro.id : '');
    });
    return () => { active = false; };
  }, [macro.id, user]);

  async function report() {
    if (!user || reported || busy) return;
    if (restricted) {
      setNotice('Reporting is unavailable while your account is restricted.');
      return;
    }
    const reason = window.prompt('What is wrong with this macro?')?.trim();
    if (!reason) return;
    setBusy(true);
    setNotice('');
    try {
      const { error } = await supabase().rpc('submit_macro_content_report', { p_macro_id: macro.id, p_reason: reason.slice(0, 1000) });
      if (error) throw error;
      setReportedMacroId(macro.id);
      setNotice('Macro reported. A moderator can now review it.');
    } catch (caught) {
      const message = caught && typeof caught === 'object' && 'message' in caught ? String(caught.message) : '';
      if (message.toLowerCase().includes('already reported')) {
        setReportedMacroId(macro.id);
        setNotice('You already reported this macro.');
      } else if (message.toLowerCase().includes('function') || message.toLowerCase().includes('macro_content_reports')) {
        setNotice('Macro reporting needs the latest database update before it can be used.');
      } else {
        setNotice(message || 'The macro could not be reported. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return <section className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5">
    <h2 className="text-sm font-semibold">Report this macro</h2>
    <p className="mt-2 text-[10px] leading-4 text-zinc-600">Send problems such as misleading information or unsafe content to the moderators.</p>
    {user ? <button type="button" disabled={reported || busy} onClick={() => void report()} className={`mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border text-xs font-semibold transition disabled:cursor-default ${reported ? 'border-amber-400/15 bg-amber-400/[.06] text-amber-200' : 'border-white/[.08] bg-white/[.035] text-zinc-400 hover:border-amber-400/20 hover:text-amber-200'}`}>{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Flag className="h-3.5 w-3.5" />}{reported ? 'Already reported' : 'Report macro'}</button> : <Link to={`/login?return_to=${encodeURIComponent(`/macro/${macro.id}`)}`} className="mt-4 flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[.08] bg-white/[.035] text-xs font-semibold text-zinc-400 hover:text-amber-200"><Flag className="h-3.5 w-3.5" />Sign in to report</Link>}
    {notice && <p role="status" className="mt-3 text-[10px] leading-4 text-amber-200">{notice}</p>}
  </section>;
}

function Comments({ macroId, comments, onChanged }: { macroId: string; comments: CommentRow[]; onChanged: () => Promise<void> }) {
  const { user, profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reportedCommentIds, setReportedCommentIds] = useState<Set<string>>(() => new Set());
  const restricted = Boolean(profile?.banned_at || profile?.restricted_until);

  useEffect(() => {
    let active = true;
    if (!user || !comments.length) return () => { active = false; };
    void supabase().from('comment_reports').select('comment_id').eq('reporter_id', user.id).in('comment_id', comments.map((comment) => comment.id)).then(({ data }) => {
      if (active) setReportedCommentIds(new Set((data ?? []).map((item) => item.comment_id)));
    });
    return () => { active = false; };
  }, [comments, user]);
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (!user) return; if (restricted) { setError('Your account is temporarily restricted.'); return; } const form = event.currentTarget; const data = new FormData(form); const body = String(data.get('body') ?? '').trim(); if (!body) return; setBusy(true); setError(''); try { await addComment(macroId, user.id, body); form.reset(); await onChanged(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not post the comment.'); } finally { setBusy(false); } }
  async function remove(id: string) { if (!user) return; setBusy(true); setError(''); try { const { error: deleteError } = await supabase().from('comments').delete().eq('id', id).eq('author_id', user.id); if (deleteError) throw deleteError; await onChanged(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not delete the comment.'); } finally { setBusy(false); } }
  async function reply(comment: CommentRow) { if (!user) return; if (restricted) { setError('Your account is temporarily restricted.'); return; } const body = window.prompt(`Reply to @${comment.author?.username ?? 'player'}`)?.trim(); if (!body) return; setBusy(true); setError(''); try { await addComment(macroId, user.id, body.slice(0, 2000), comment.id); await onChanged(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not post the reply.'); } finally { setBusy(false); } }
  async function edit(comment: CommentRow) { if (!user || user.id !== comment.author_id) return; if (restricted) { setError('Your account is temporarily restricted.'); return; } const body = window.prompt('Edit your comment', comment.body)?.trim(); if (!body || body === comment.body) return; setBusy(true); setError(''); try { const { error: updateError } = await supabase().from('comments').update({ body: body.slice(0, 2000) }).eq('id', comment.id).eq('author_id', user.id); if (updateError) throw updateError; await onChanged(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not edit the comment.'); } finally { setBusy(false); } }
  async function report(comment: CommentRow) { if (!user) return; if (reportedCommentIds.has(comment.id)) { setError('You already reported this comment.'); return; } if (restricted) { setError('Your account is temporarily restricted.'); return; } setBusy(true); setError(''); try { const { error: reportError } = await supabase().from('comment_reports').insert({ comment_id: comment.id, reporter_id: user.id, reason: 'Reported by user' }); if (reportError) throw reportError; setReportedCommentIds((current) => new Set(current).add(comment.id)); } catch (caught) { const duplicate = typeof caught === 'object' && caught !== null && 'code' in caught && caught.code === '23505'; if (duplicate) { setReportedCommentIds((current) => new Set(current).add(comment.id)); setError('You already reported this comment.'); } else setError(caught instanceof Error ? caught.message : 'Could not report the comment.'); } finally { setBusy(false); } }
  return <section className="rounded-[28px] border border-white/[.075] bg-[#0e1118] p-6 sm:p-8"><h2 className="flex items-center gap-2 text-xl font-semibold"><MessageCircle className="h-5 w-5 text-violet-300" />Comments <span className="text-sm text-zinc-600">{comments.length}</span></h2>{user ? <form onSubmit={(event) => void submit(event)} className="mt-5 flex items-end gap-2"><label className="min-w-0 flex-1"><span className="sr-only">Comment</span><textarea required name="body" maxLength={2000} rows={2} placeholder="Share a helpful comment" className="w-full resize-none rounded-xl border border-white/[.08] bg-[#11151d] p-3 text-sm outline-none" /></label><button disabled={busy} className="grid h-12 w-12 place-items-center rounded-xl bg-violet-500"><Send className="h-4 w-4" /></button></form> : <Link to={`/login?return_to=${encodeURIComponent(`/macro/${macroId}`)}`} className="mt-5 inline-flex rounded-xl bg-white/[.05] px-4 py-3 text-xs font-semibold">Sign in to comment</Link>}{error && <p className="mt-3 text-xs text-rose-200">{error}</p>}<div className="mt-6 space-y-3">{comments.map((comment) => <article key={comment.id} className={`rounded-2xl border border-white/[.055] bg-white/[.018] p-4 ${comment.parent_id ? 'ml-5 sm:ml-10' : ''}`}><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><Link to={`/profile/${comment.author?.username ?? comment.author_id}`} aria-label={`View @${comment.author?.username ?? 'player'}'s profile`}><Avatar profile={comment.author} className="h-8 w-8 rounded-lg text-[10px]" /></Link><div><Link to={`/profile/${comment.author?.username ?? comment.author_id}`} className="text-xs font-semibold hover:text-violet-200">@{comment.author?.username ?? 'player'}</Link><p className="mt-1 text-[10px] text-zinc-700">{comment.parent_id ? 'Reply · ' : ''}{new Date(comment.created_at).toLocaleString()}{comment.edited_at ? ' · edited' : ''}</p></div></div>{user && <div className="flex gap-2">{user.id === comment.author_id ? <><button type="button" disabled={busy} onClick={() => void edit(comment)} aria-label="Edit comment" className="text-zinc-700 hover:text-violet-300"><Pencil className="h-3.5 w-3.5" /></button><button type="button" disabled={busy} onClick={() => void remove(comment.id)} aria-label="Delete comment" className="text-zinc-700 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button></> : <button type="button" disabled={busy} onClick={() => void report(comment)} aria-label="Report comment" className="text-zinc-700 hover:text-amber-300"><Flag className="h-3.5 w-3.5" /></button>}</div>}</div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-400">{comment.body}</p>{user && !comment.parent_id && <button type="button" disabled={busy} onClick={() => void reply(comment)} className="mt-3 inline-flex items-center gap-1.5 text-[10px] text-zinc-600 hover:text-white"><Reply className="h-3 w-3" />Reply</button>}</article>)}{!comments.length && <p className="py-8 text-center text-sm text-zinc-700">No comments yet.</p>}</div></section>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/[.055] bg-white/[.025] p-3"><p className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</p><p className="mt-1.5 truncate text-xs font-semibold text-zinc-200">{value}</p></div>; }
