import { AlertTriangle, Check, FileUp, LoaderCircle, RotateCcw, Send, ShieldCheck } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CanonicalReplayV1 } from '../../lib/replay/types';
import { analyzeReplay } from '../../lib/replay/analyze';
import { detectReplayFormat } from '../../lib/replay/conversion';
import { stableStringify } from '../../lib/replay/schema';
import { validateUpload } from '../../lib/security/upload';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

type ReadyFile = {
  file: File;
  replay: CanonicalReplayV1;
  sourceFormat: { id: string; name: string; extension: string };
  analysis: ReturnType<typeof analyzeReplay>;
};

export function UploadPage() {
  const { user, profile } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState<ReadyFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [publishedId, setPublishedId] = useState('');
  const restricted = Boolean(profile?.banned_at || profile?.restricted_until);

  async function analyze(file: File) {
    setBusy(true); setError(''); setPublishedId('');
    try {
      const validated = await validateUpload(file);
      const detection = await detectReplayFormat({ bytes: validated.bytes, filename: validated.filename, mediaType: validated.contentType });
      if (!detection.format?.parser) throw new Error(detection.reason);
      const parsed = await detection.format.parser.parse({ bytes: validated.bytes, filename: validated.filename, mediaType: validated.contentType });
      setReady({ file, replay: parsed.replay, sourceFormat: { id: detection.format.id, name: detection.format.displayName, extension: detection.format.extensions[0] }, analysis: analyzeReplay(parsed.replay) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not read this macro.'); setReady(null); }
    finally { setBusy(false); }
  }

  async function publish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !user) return;
    if (restricted) { setError('Your account is temporarily restricted. Downloads and the converter still work.'); return; }
    setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const levelId = String(form.get('levelId') ?? '').trim();
    const levelName = String(form.get('levelName') ?? '').trim();
    const creator = String(form.get('creator') ?? '').trim();
    const title = String(form.get('title') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    const macroId = crypto.randomUUID();
    const originalPath = `${user.id}/${macroId}/original${ready.sourceFormat.extension}`;
    const canonicalPath = `${user.id}/${macroId}/canonical.macrohub.json`;
    const client = supabase();
    let originalUploaded = false;
    let canonicalUploaded = false;
    try {
      if (!/^\d{1,20}$/.test(levelId)) throw new Error('Enter a valid numeric Geometry Dash level ID.');
      if (!levelName || !creator || !title) throw new Error('Complete the level name, creator, and macro title.');
      if (ready.analysis.levelId && ready.analysis.levelId !== levelId) throw new Error('The level ID does not match the replay file.');
      const { error: originalError } = await client.storage.from('macrohub-files').upload(originalPath, ready.file, { upsert: false, contentType: ready.file.type || 'application/octet-stream' });
      if (originalError) throw originalError;
      originalUploaded = true;
      const canonicalBlob = new Blob([stableStringify(ready.replay)], { type: 'application/vnd.macrohub.replay+json' });
      const { error: canonicalError } = await client.storage.from('macrohub-files').upload(canonicalPath, canonicalBlob, { upsert: false, contentType: canonicalBlob.type });
      if (canonicalError) throw canonicalError;
      canonicalUploaded = true;
      const { error: levelError } = await client.from('levels').upsert({
        id: levelId, name: levelName.slice(0, 120), creator: creator.slice(0, 80), difficulty: 'unknown', length: 'unknown', gd_version: ready.analysis.geometryDashVersion,
      }, { onConflict: 'id', ignoreDuplicates: true });
      if (levelError) throw levelError;
      const { error: macroError } = await client.from('macros').insert({
        id: macroId,
        level_id: levelId,
        uploader_id: user.id,
        title: title.slice(0, 140),
        description: description.slice(0, 4000) || null,
        completion: ready.analysis.completionPercent,
        rate_kind: ready.analysis.rateKind,
        rate: ready.analysis.rate,
        input_count: ready.analysis.inputCount,
        duration_seconds: ready.analysis.durationSeconds ?? 0,
        player1_inputs: ready.analysis.player1Inputs,
        player2_inputs: ready.analysis.player2Inputs,
        recorded_gd_version: ready.analysis.geometryDashVersion,
        original_format_id: ready.sourceFormat.id,
        original_path: originalPath,
        canonical_path: canonicalPath,
        available_format_ids: ready.analysis.targets.filter((target) => target.available).map((target) => target.id),
      });
      if (macroError) throw macroError;
      setPublishedId(macroId);
    } catch (caught) {
      if (canonicalUploaded) await client.storage.from('macrohub-files').remove([canonicalPath]);
      if (originalUploaded) await client.storage.from('macrohub-files').remove([originalPath]);
      setError(caught instanceof Error ? caught.message : 'Could not publish the macro.');
    } finally { setBusy(false); }
  }

  if (publishedId) return <main className="mx-auto min-h-[75vh] max-w-5xl px-5 py-14"><div className="rounded-[28px] border border-emerald-400/15 bg-emerald-400/[.055] p-12 text-center"><Check className="mx-auto h-8 w-8 text-emerald-300" /><h1 className="mt-5 text-3xl font-semibold">Macro published</h1><p className="mt-2 text-sm text-zinc-500">It is ready to view and share.</p><Link to={`/macro/${publishedId}`} className="mt-6 inline-flex rounded-xl bg-violet-500 px-5 py-3 text-xs font-semibold">View macro</Link></div></main>;

  return <main className="mx-auto min-h-[75vh] max-w-6xl px-5 py-12 lg:px-8"><header className="mb-9 max-w-3xl"><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-300">Share a macro</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">Upload once</h1><p className="mt-3 text-sm text-zinc-500">The file is parsed in your browser, then its canonical replay and original file are saved securely to your account.</p></header>
    {!ready ? <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void analyze(file); }} className="relative overflow-hidden rounded-[28px] border border-dashed border-violet-400/25 bg-gradient-to-br from-violet-500/[.09] to-cyan-500/[.035] p-10 text-center sm:p-16"><div className="surface-grid pointer-events-none absolute inset-0 opacity-30" /><div className="relative"><span className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] border border-violet-300/15 bg-violet-400/10 text-violet-200">{busy ? <LoaderCircle className="h-7 w-7 animate-spin" /> : <FileUp className="h-7 w-7" />}</span><h2 className="mt-5 text-xl font-semibold">Drop your macro here</h2><p className="mt-2 text-sm text-zinc-500">Choose any supported macro file up to 10 MiB.</p><button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="mt-6 rounded-xl bg-violet-500 px-5 py-3 text-xs font-semibold hover:bg-violet-400 disabled:opacity-50">Choose a file</button><input ref={inputRef} className="sr-only" type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void analyze(file); }} /></div></div> :
      <form onSubmit={(event) => void publish(event)} className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"><div className="space-y-6"><section className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] uppercase tracking-[.16em] text-violet-300">File ready</p><h2 className="mt-2 break-all text-lg font-semibold">{ready.file.name}</h2><p className="mt-1 text-xs text-zinc-500">{ready.sourceFormat.name}</p></div><button type="button" onClick={() => setReady(null)} className="inline-flex items-center gap-2 rounded-xl border border-white/[.08] px-3 py-2 text-[11px] text-zinc-400"><RotateCcw className="h-3 w-3" />Change</button></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Inputs" value={ready.analysis.inputCount.toLocaleString()} /><Metric label="Rate" value={ready.analysis.rate ? `${ready.analysis.rate} ${ready.analysis.rateKind.toUpperCase()}` : 'Unknown'} /><Metric label="Duration" value={ready.analysis.durationSeconds === null ? 'Unknown' : `${ready.analysis.durationSeconds.toFixed(2)}s`} /><Metric label="Outputs" value={String(ready.analysis.targets.filter((target) => target.available).length)} /></div></section>
        <section className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-6"><h2 className="text-lg font-semibold">Macro details</h2><div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="Level ID" name="levelId" defaultValue={ready.analysis.levelId ?? ''} placeholder="Geometry Dash level ID" /><Field label="Level name" name="levelName" defaultValue={ready.analysis.levelName ?? ''} placeholder="Level name" /><Field label="Level creator" name="creator" placeholder="Creator name" /><Field label="Macro title" name="title" defaultValue={ready.analysis.levelName ? `${ready.analysis.levelName} macro` : ''} placeholder="Macro title" /></div><label className="mt-4 block"><span className="mb-2 block text-[11px] text-zinc-400">Description</span><textarea name="description" maxLength={4000} rows={5} className="w-full rounded-xl border border-white/[.08] bg-[#11151d] p-3 text-sm outline-none" placeholder="Anything players should know" /></label></section></div>
        <aside className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5 lg:sticky lg:top-24"><p className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-emerald-300" />Ready to publish</p><p className="mt-3 text-xs leading-5 text-zinc-500">Only recognized replay files are accepted. Executables and active content are blocked.</p>{restricted ? <p className="mt-5 rounded-xl border border-amber-400/15 bg-amber-400/[.06] p-3 text-xs leading-5 text-amber-100">Your account is temporarily restricted{profile?.restricted_until ? ` until ${new Date(profile.restricted_until).toLocaleString()}` : ''}. Downloads and the converter still work.</p> : user ? <button disabled={busy} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-500 text-xs font-semibold disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Publish macro</button> : <Link to="/login?return_to=%2Fupload" className="mt-5 flex h-11 items-center justify-center rounded-xl bg-violet-500 text-xs font-semibold">Sign in to publish</Link>}</aside>
      </form>}
    {error && <div role="alert" className="mt-6 flex gap-3 rounded-2xl border border-rose-400/15 bg-rose-400/[.06] p-4 text-sm text-rose-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
  </main>;
}

function Field({ label, name, defaultValue, placeholder }: { label: string; name: string; defaultValue?: string; placeholder: string }) { return <label><span className="mb-2 block text-[11px] text-zinc-400">{label}</span><input required name={name} defaultValue={defaultValue} maxLength={140} placeholder={placeholder} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#11151d] px-3.5 text-sm outline-none" /></label>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/[.055] bg-white/[.025] p-3"><p className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</p><p className="mt-1.5 truncate text-xs font-semibold text-zinc-200">{value}</p></div>; }
