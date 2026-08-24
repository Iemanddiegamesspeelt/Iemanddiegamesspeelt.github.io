'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FocusEventHandler, type RefObject } from 'react';
import { AlertTriangle, Check, FileUp, LoaderCircle, RotateCcw, Send, ShieldCheck } from 'lucide-react';
import { appSignInPath } from '../../lib/auth/session';

type UploadAnalysis = {
  uploadId: string | null;
  filename: string;
  sourceFormat: { id: string; name: string; extension: string };
  analysis: {
    levelId: string | null;
    levelName: string | null;
    geometryDashVersion: string | null;
    completionPercent: number | null;
    rate: number | null;
    rateKind: string;
    inputCount: number;
    eventCount: number;
    player1Inputs: number;
    player2Inputs: number;
    durationSeconds: number | null;
  };
};

export function UploadWizard({ signedIn }: { signedIn: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const levelNameRef = useRef<HTMLInputElement>(null);
  const creatorNameRef = useRef<HTMLInputElement>(null);
  const [analysis, setAnalysis] = useState<UploadAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [publishedId, setPublishedId] = useState('');

  const lookupLevel = useCallback(async (levelId: string) => {
    if (!/^\d{1,20}$/.test(levelId)) return;
    try {
      const response = await fetch(`/api/geometry-dash/levels/${encodeURIComponent(levelId)}`);
      if (!response.ok) return;
      const body = await response.json() as { level: { name: string; creator: string } };
      if (levelNameRef.current) levelNameRef.current.value = body.level.name;
      if (creatorNameRef.current) creatorNameRef.current.value = body.level.creator;
    } catch {
      // Manual level fields remain available when metadata lookup is unavailable.
    }
  }, []);

  useEffect(() => {
    if (analysis?.analysis.levelId) void lookupLevel(analysis.analysis.levelId);
  }, [analysis?.analysis.levelId, lookupLevel]);

  async function analyze(file: File) {
    setBusy(true);
    setError('');
    setPublishedId('');
    try {
      const formData = new FormData();
      formData.set('file', file);
      const response = await fetch('/api/upload/analyze', { method: 'POST', body: formData });
      const body = await response.json() as UploadAnalysis & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? 'Could not read this macro.');
      setAnalysis(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read this macro.');
      setAnalysis(null);
    } finally {
      setBusy(false);
    }
  }

  async function publish(form: FormData) {
    if (!analysis?.uploadId) return;
    setPublishing(true);
    setError('');
    try {
      const response = await fetch('/api/upload/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId: analysis.uploadId,
          levelId: form.get('levelId'),
          levelName: form.get('levelName'),
          creatorName: form.get('creatorName'),
          title: form.get('title'),
          description: form.get('description'),
        }),
      });
      const body = await response.json() as { macro?: { id: string }; error?: { message?: string } };
      if (!response.ok || !body.macro) throw new Error(body.error?.message ?? 'Could not publish the macro.');
      setPublishedId(body.macro.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not publish the macro.');
    } finally {
      setPublishing(false);
    }
  }

  if (publishedId) {
    return (
      <div className="rounded-[28px] border border-emerald-400/15 bg-emerald-400/[.055] p-8 text-center sm:p-12">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-300"><Check className="h-6 w-6" /></span>
        <h2 className="mt-5 text-2xl font-semibold">Macro published</h2>
        <p className="mt-2 text-sm text-zinc-500">It is ready to view and share.</p>
        <Link href={`/macro/${publishedId}`} className="mt-6 inline-flex rounded-xl bg-violet-500 px-5 py-3 text-xs font-semibold hover:bg-violet-400">View macro</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!analysis ? (
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (file) void analyze(file);
          }}
          className="relative overflow-hidden rounded-[28px] border border-dashed border-violet-400/25 bg-gradient-to-br from-violet-500/[.09] to-cyan-500/[.035] p-10 text-center sm:p-16"
        >
          <div className="surface-grid pointer-events-none absolute inset-0 opacity-30" />
          <div className="relative">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] border border-violet-300/15 bg-violet-400/10 text-violet-200">
              {busy ? <LoaderCircle className="h-7 w-7 animate-spin" /> : <FileUp className="h-7 w-7" />}
            </span>
            <h2 className="mt-5 text-xl font-semibold">Drop your macro here</h2>
            <p className="mt-2 text-sm text-zinc-500">Choose a supported macro file up to 10 MiB.</p>
            <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="mt-6 rounded-xl bg-violet-500 px-5 py-3 text-xs font-semibold hover:bg-violet-400 disabled:opacity-50">Choose a file</button>
            <input ref={inputRef} className="sr-only" type="file" accept=".gdr2,.macrohub.json,application/json,application/octet-stream" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void analyze(file);
            }} />
          </div>
        </div>
      ) : (
        <form action={(formData) => void publish(formData)} className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            <section className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[.16em] text-violet-300">File ready</p>
                  <h2 className="mt-2 break-all text-lg font-semibold">{analysis.filename}</h2>
                  <p className="mt-1 text-xs text-zinc-500">{analysis.sourceFormat.name}</p>
                </div>
                <button type="button" onClick={() => { setAnalysis(null); setError(''); }} className="inline-flex items-center gap-2 rounded-xl border border-white/[.08] px-3 py-2 text-[11px] text-zinc-400 hover:bg-white/[.05]"><RotateCcw className="h-3 w-3" /> Choose another</button>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Inputs" value={analysis.analysis.inputCount.toLocaleString()} />
                <Metric label="Rate" value={analysis.analysis.rate ? `${analysis.analysis.rate} ${analysis.analysis.rateKind.toUpperCase()}` : 'Unknown'} />
                <Metric label="Duration" value={analysis.analysis.durationSeconds === null ? 'Unknown' : `${analysis.analysis.durationSeconds.toFixed(2)}s`} />
                <Metric label="Players" value={analysis.analysis.player2Inputs ? 'P1 + P2' : 'P1'} />
              </div>
            </section>

            <section className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5 sm:p-6">
              <h2 className="text-lg font-semibold">Macro details</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Level ID" name="levelId" required defaultValue={analysis.analysis.levelId ?? ''} placeholder="Geometry Dash level ID" onBlur={(event) => void lookupLevel(event.currentTarget.value)} />
                <Field label="Level name" name="levelName" required defaultValue={analysis.analysis.levelName ?? ''} placeholder="Level name" inputRef={levelNameRef} />
                <Field label="Level creator" name="creatorName" required placeholder="Creator name" inputRef={creatorNameRef} />
                <Field label="Macro title" name="title" required defaultValue={analysis.analysis.levelName ? `${analysis.analysis.levelName} macro` : ''} placeholder="Short descriptive title" />
              </div>
              <label className="mt-4 block">
                <span className="mb-2 block text-[11px] font-medium text-zinc-400">Description</span>
                <textarea name="description" maxLength={4000} rows={5} placeholder="Anything players should know about this replay" className="w-full resize-y rounded-xl border border-white/[.08] bg-[#11151d] px-3.5 py-3 text-sm text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-violet-400/40" />
              </label>
            </section>
          </div>

          <aside className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5 lg:sticky lg:top-24">
            <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-emerald-300" /> Ready to publish</div>
            <p className="mt-3 text-xs leading-5 text-zinc-500">Review the level and title before sharing this macro.</p>
            {signedIn ? (
              <button type="submit" disabled={publishing || !analysis.uploadId} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-500 text-xs font-semibold hover:bg-violet-400 disabled:opacity-40">
                {publishing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Publish macro
              </button>
            ) : (
              <Link href={appSignInPath('/upload')} className="mt-5 flex h-11 w-full items-center justify-center rounded-xl bg-violet-500 text-xs font-semibold hover:bg-violet-400">Sign in to publish</Link>
            )}
          </aside>
        </form>
      )}

      {error && <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-400/15 bg-rose-400/[.06] p-4 text-sm text-rose-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
    </div>
  );
}

function Field({ label, name, defaultValue, placeholder, required, inputRef, onBlur }: { label: string; name: string; defaultValue?: string; placeholder: string; required?: boolean; inputRef?: RefObject<HTMLInputElement | null>; onBlur?: FocusEventHandler<HTMLInputElement> }) {
  return <label className="block"><span className="mb-2 block text-[11px] font-medium text-zinc-400">{label}</span><input ref={inputRef} onBlur={onBlur} name={name} defaultValue={defaultValue} placeholder={placeholder} required={required} maxLength={140} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#11151d] px-3.5 text-sm text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-violet-400/40" /></label>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/[.055] bg-white/[.025] p-3"><p className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</p><p className="mt-1.5 truncate text-xs font-semibold text-zinc-200">{value}</p></div>;
}
