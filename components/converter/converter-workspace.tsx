'use client';

import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Download,
  FileCode2,
  FileUp,
  LoaderCircle,
  PackageOpen,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import Link from '../ui/native-link';
import { MacroTimeline, type TimelineEvent } from '../macro/macro-timeline';
import { UploadWizard } from '../upload/upload-wizard';
import { appSignInPath } from '../../lib/auth/session';

type Issue = {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  requiresAcknowledgement?: boolean;
};
type Target = {
  id: string;
  name: string;
  shortName: string;
  extension: string;
  available: boolean;
  fidelity: 'lossless' | 'compatible' | 'metadata-loss' | null;
  issues: Issue[];
  compatibleToolIds: string[];
  toolCompatibility: Array<{ toolId: string; verification: 'verified' | 'community-reported'; recommended: boolean; note: string | null }>;
};
type Analysis = {
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
    timeline: TimelineEvent[];
    targets: Target[];
  };
  diagnostics: Issue[];
};

export function ConverterWorkspace({
  tools,
  signedIn,
  acceptedFileTypes,
}: {
  tools: Array<{ id: string; label: string }>;
  signedIn: boolean;
  acceptedFileTypes: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selectedTarget, setSelectedTarget] = useState('');
  const [selectedTool, setSelectedTool] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [acknowledgedAll, setAcknowledgedAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [converting, setConverting] = useState<'single' | 'all' | null>(null);
  const [error, setError] = useState('');
  const [publishMode, setPublishMode] = useState(false);
  const target = analysis?.analysis.targets.find((item) => item.id === selectedTarget);
  const selectedCompatibility = target?.toolCompatibility.find((item) => item.toolId === selectedTool);
  const warningCodes = useMemo(
    () => target?.issues.filter((issue) => issue.requiresAcknowledgement).map((issue) => issue.code) ?? [],
    [target],
  );
  const visibleTargets = useMemo(
    () => analysis?.analysis.targets.filter((item) => !selectedTool || item.compatibleToolIds.includes(selectedTool)) ?? [],
    [analysis, selectedTool],
  );
  const availableVisibleTargets = useMemo(
    () => visibleTargets.filter((item) => item.available),
    [visibleTargets],
  );
  const allWarnings = useMemo(() => {
    const unique = new Map<string, Issue>();
    for (const item of availableVisibleTargets) {
      for (const issue of item.issues) if (issue.requiresAcknowledgement) unique.set(issue.code, issue);
    }
    return [...unique.values()];
  }, [availableVisibleTargets]);
  const visibleTools = useMemo(
    () => tools.filter((tool) => analysis?.analysis.targets.some((item) => item.compatibleToolIds.includes(tool.id))),
    [analysis, tools],
  );

  async function chooseFile(nextFile: File) {
    setFile(nextFile);
    setAnalysis(null);
    setSelectedTarget('');
    setSelectedTool('');
    setAcknowledged(false);
    setAcknowledgedAll(false);
    setError('');
    setBusy(true);
    try {
      const body = new FormData();
      body.set('file', nextFile);
      const response = await fetch('/api/converter/analyze', { method: 'POST', body });
      const data = await response.json() as Analysis & { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message ?? 'Macro analysis failed.');
      setAnalysis(data);
      setSelectedTarget(data.analysis.targets.find((item) => item.available)?.id ?? data.analysis.targets[0]?.id ?? '');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Macro analysis failed.');
    } finally {
      setBusy(false);
    }
  }

  async function convert(all = false) {
    if (!file || (!all && !selectedTarget)) return;
    setConverting(all ? 'all' : 'single');
    setError('');
    try {
      const body = new FormData();
      body.set('file', file);
      if (!all) body.set('targetFormatId', selectedTarget);
      if (selectedTool) body.set('replayToolId', selectedTool);
      body.set('acknowledgedIssueCodes', JSON.stringify(
        all ? (acknowledgedAll ? allWarnings.map((issue) => issue.code) : []) : (acknowledged ? warningCodes : []),
      ));
      const response = await fetch(all ? '/api/converter/all' : '/api/converter', { method: 'POST', body });
      if (!response.ok) {
        const data = await response.json() as { error?: { message?: string } };
        throw new Error(data.error?.message ?? 'Conversion failed.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') ?? '';
      const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? (all ? 'macrohub-formats.zip' : `macro${target?.extension ?? ''}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Conversion failed.');
    } finally {
      setConverting(null);
    }
  }

  const needsAcknowledgement = warningCodes.length > 0;

  if (publishMode && file) {
    return (
      <div className="space-y-5">
        <button type="button" onClick={() => setPublishMode(false)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[.08] px-4 text-xs text-zinc-300 hover:bg-white/[.05]">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to converter
        </button>
        <UploadWizard signedIn={signedIn} acceptedFileTypes={acceptedFileTypes} initialFile={file} />
      </div>
    );
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        {!analysis && (
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const dropped = event.dataTransfer.files[0];
              if (dropped) void chooseFile(dropped);
            }}
            className="relative overflow-hidden rounded-[28px] border border-dashed border-violet-400/25 bg-gradient-to-br from-violet-500/[.09] to-cyan-500/[.035] p-8 text-center sm:p-14"
          >
            <div className="pointer-events-none absolute inset-0 surface-grid opacity-30" />
            <div className="relative">
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] border border-violet-300/15 bg-violet-400/10 text-violet-200">
                {busy ? <LoaderCircle className="h-7 w-7 animate-spin" /> : <FileUp className="h-7 w-7" />}
              </span>
              <h2 className="mt-5 text-xl font-semibold">{busy ? 'Reading your macro…' : 'Drop a macro file here'}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-500">Choose a supported macro file up to 10 MiB.</p>
              <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="mt-6 rounded-xl bg-violet-500 px-5 py-3 text-xs font-semibold transition hover:bg-violet-400 disabled:opacity-50">
                Choose a file
              </button>
              <input ref={inputRef} type="file" className="sr-only" accept={acceptedFileTypes} onChange={(event) => {
                const selected = event.target.files?.[0];
                if (selected) void chooseFile(selected);
              }} />
            </div>
          </div>
        )}

        {analysis && (
          <>
            <div className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-300"><FileCode2 className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{analysis.filename}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">Detected as <span className="text-zinc-300">{analysis.sourceFormat.name}</span></p>
                  </div>
                </div>
                <button type="button" onClick={() => { setAnalysis(null); setFile(null); setError(''); }} className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-white/[.07] px-3 text-[11px] text-zinc-400 hover:bg-white/[.05] hover:text-white">
                  <RefreshCw className="h-3 w-3" /> Use another file
                </button>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Inputs" value={analysis.analysis.inputCount.toLocaleString()} />
                <Metric label="Rate" value={analysis.analysis.rate ? `${analysis.analysis.rate} ${analysis.analysis.rateKind.toUpperCase()}` : 'Unknown'} />
                <Metric label="Duration" value={analysis.analysis.durationSeconds ? `${analysis.analysis.durationSeconds.toFixed(2)}s` : 'Unknown'} />
                <Metric label="Players" value={analysis.analysis.player2Inputs ? 'P1 + P2' : 'P1'} />
              </div>
            </div>

            <MacroTimeline events={analysis.analysis.timeline} />

            <section>
              <div className="mb-4">
                <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">Target format</p>
                <h2 className="mt-2 text-xl font-semibold">Choose an output</h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {visibleTargets.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => { setSelectedTarget(item.id); setAcknowledged(false); }}
                    className={`flex items-center justify-between rounded-2xl border p-4 text-left transition ${selectedTarget === item.id ? 'border-violet-400/35 bg-violet-400/[.09]' : item.available ? 'border-white/[.07] bg-white/[.025] hover:border-white/[.13]' : 'border-white/[.05] bg-white/[.015] opacity-60 hover:opacity-80'}`}
                  >
                    <span>
                      <span className="block text-sm font-semibold">{item.name}</span>
                      <span className="mt-1 block text-[11px] text-zinc-500">{item.extension} · {!item.available ? 'Unavailable for this replay' : item.fidelity === 'lossless' ? 'Lossless' : item.fidelity === 'metadata-loss' ? 'Metadata warning' : 'Compatible'}</span>
                    </span>
                    {selectedTarget === item.id ? <Check className="h-4 w-4 text-violet-300" /> : <ChevronRight className="h-4 w-4 text-zinc-700" />}
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        {error && (
          <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-400/15 bg-rose-400/[.065] p-4 text-sm text-rose-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X className="h-4 w-4" /></button>
          </div>
        )}
      </div>

      <aside className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5 lg:sticky lg:top-24">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-300" />
          <h2 className="text-sm font-semibold">Conversion</h2>
        </div>
        {!analysis ? (
          <p className="mt-4 text-sm leading-6 text-zinc-500">Add a macro file to see its metadata and output formats.</p>
        ) : (
          <>
            <label className="mt-5 block">
              <span className="mb-2 block text-[10px] font-medium text-zinc-500">Filter for your replay tool</span>
              <select value={selectedTool} onChange={(event) => {
                const toolId = event.target.value;
                setSelectedTool(toolId);
                const matches = analysis.analysis.targets.filter((item) => !toolId || item.compatibleToolIds.includes(toolId));
                const firstMatch = matches.find((item) => item.available) ?? matches[0];
                if (toolId && (!target?.compatibleToolIds.includes(toolId) || !target.available)) setSelectedTarget(firstMatch?.id ?? '');
                setAcknowledged(false);
                setAcknowledgedAll(false);
              }} className="h-11 w-full rounded-xl border border-white/[.075] bg-[#11151d] px-3 text-xs text-zinc-300 outline-none">
                <option value="">All formats</option>
                {visibleTools.map((tool) => <option key={tool.id} value={tool.id}>{tool.label}</option>)}
              </select>
            </label>

            {target?.issues.length ? (
              <div className="mt-4 space-y-2">
                {target.issues.map((issue) => (
                  <div key={issue.code} className="rounded-xl border border-amber-400/15 bg-amber-400/[.06] p-3 text-[11px] leading-5 text-amber-100/80">
                    <span className="mb-1 flex items-center gap-1.5 font-semibold text-amber-200"><AlertTriangle className="h-3 w-3" /> Conversion note</span>
                    {issue.message}
                  </div>
                ))}
              </div>
            ) : target ? (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-400/15 bg-emerald-400/[.055] p-3 text-[11px] text-emerald-200">
                <ShieldCheck className="h-3.5 w-3.5" />
                No conversion warnings
              </div>
            ) : null}

            {selectedCompatibility?.verification === 'community-reported' && (
              <p className="mt-3 text-[10px] leading-4 text-zinc-600">Replay-tool support is community-tested and can vary by installed version.</p>
            )}

            {needsAcknowledgement && (
              <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[11px] leading-5 text-zinc-400">
                <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1 accent-violet-500" />
                I understand the listed information-loss warning.
              </label>
            )}

            <button type="button" disabled={!selectedTarget || !target?.available || converting !== null || (needsAcknowledgement && !acknowledged)} onClick={() => void convert(false)} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-500 text-xs font-semibold transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40">
              {converting === 'single' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Convert &amp; download
            </button>
            {allWarnings.length > 0 && (
              <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[11px] leading-5 text-zinc-400">
                <input type="checkbox" checked={acknowledgedAll} onChange={(event) => setAcknowledgedAll(event.target.checked)} className="mt-1 accent-violet-500" />
                Include every visible format and accept each listed conversion note.
              </label>
            )}
            <p className="mt-4 text-[10px] text-zinc-600">ZIP contents: {availableVisibleTargets.map((item) => item.extension).join(', ') || 'No compatible outputs'}</p>
            <button type="button" disabled={!availableVisibleTargets.length || converting !== null || (allWarnings.length > 0 && !acknowledgedAll)} onClick={() => void convert(true)} className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/[.08] bg-white/[.035] text-xs font-semibold text-zinc-300 transition hover:bg-white/[.07] disabled:opacity-40">
              {converting === 'all' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <PackageOpen className="h-4 w-4" />}
              Download all formats
            </button>
            {signedIn ? (
              <button type="button" onClick={() => setPublishMode(true)} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-violet-400/20 bg-violet-400/[.07] text-xs font-semibold text-violet-200 transition hover:bg-violet-400/[.12]">
                <Upload className="h-4 w-4" /> Publish this macro
              </button>
            ) : (
              <Link href={appSignInPath('/upload')} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-violet-400/20 bg-violet-400/[.07] text-xs font-semibold text-violet-200 transition hover:bg-violet-400/[.12]">
                <Upload className="h-4 w-4" /> Sign in to upload
              </Link>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/[.055] bg-white/[.025] p-3"><p className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</p><p className="mt-1.5 truncate text-xs font-semibold text-zinc-200">{value}</p></div>;
}
