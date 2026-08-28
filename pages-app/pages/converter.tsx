import { AlertTriangle, Archive, CheckCircle2, Download, FileUp, LoaderCircle, RotateCcw, ShieldAlert, Wrench } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { analyzeReplay } from '../../lib/replay/analyze';
import { assessConversion, convertReplay } from '../../lib/replay/conversion';
import { formatCompatibilityRegistry, formatRegistry, replayToolRegistry } from '../../lib/replay/registry';
import type { CanonicalReplayV1 } from '../../lib/replay/types';
import { validateUpload } from '../../lib/security/upload';
import { buildReplayZip, downloadArtifact, downloadBlob } from '../lib/downloads';

type Loaded = {
  file: File;
  replay: CanonicalReplayV1;
  sourceName: string;
  sourceFormatId: string;
};

export function ConverterPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [toolId, setToolId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const analysis = useMemo(() => loaded ? analyzeReplay(loaded.replay) : null, [loaded]);
  const formats = useMemo(() => {
    if (!loaded) return [];
    return formatRegistry.filter((format) => {
      if (!format.exporter) return false;
      if (!toolId) return true;
      return formatCompatibilityRegistry.some((entry) => entry.formatId === format.id
        && entry.replayToolId === toolId
        && entry.verification !== 'unknown'
        && (entry.direction === 'import' || entry.direction === 'both'));
    }).map((format) => ({ format, assessment: assessConversion(loaded.replay, format.id, toolId || null) }));
  }, [loaded, toolId]);

  async function load(file: File) {
    setBusy('loading'); setError('');
    try {
      const validated = await validateUpload(file);
      const format = formatRegistry.find((entry) => entry.id === validated.detectedFormatId);
      if (!format?.parser) throw new Error('This replay cannot be parsed safely.');
      const parsed = await format.parser.parse({ bytes: validated.bytes, filename: validated.filename, mediaType: validated.contentType });
      setLoaded({ file, replay: parsed.replay, sourceName: format.displayName, sourceFormatId: format.id });
    } catch (caught) {
      setLoaded(null);
      setError(caught instanceof Error ? caught.message : 'Could not read this macro.');
    } finally { setBusy(''); }
  }

  async function convert(targetId: string) {
    if (!loaded) return;
    setBusy(targetId); setError('');
    try {
      const assessment = assessConversion(loaded.replay, targetId, toolId || null);
      const requiredIssues = assessment.issues.filter((issue) => issue.requiresAcknowledgement);
      if (requiredIssues.length && !window.confirm(`Continue with this conversion?\n\n${requiredIssues.map((issue) => `• ${issue.message}`).join('\n')}`)) return;
      const acknowledgedIssueCodes = requiredIssues.map((issue) => issue.code);
      const result = await convertReplay(loaded.replay, targetId, { replayToolId: toolId || null, acknowledgedIssueCodes });
      downloadArtifact(result.artifact);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Conversion failed.'); }
    finally { setBusy(''); }
  }

  async function all() {
    if (!loaded) return;
    setBusy('zip'); setError('');
    try {
      const ids = formats.filter((entry) => entry.assessment.decision === 'allowed').map((entry) => entry.format.id);
      const requiredIssues = [...new Map(formats.filter((entry) => entry.assessment.decision === 'allowed').flatMap((entry) => entry.assessment.issues).filter((issue) => issue.requiresAcknowledgement).map((issue) => [issue.code, issue])).values()];
      if (requiredIssues.length && !window.confirm(`Some ZIP formats remove optional information. Continue?\n\n${requiredIssues.map((issue) => `• ${issue.message}`).join('\n')}`)) return;
      const result = await buildReplayZip(loaded.replay, ids, requiredIssues.map((issue) => issue.code));
      if (!result.count) throw new Error('No safe conversions could be generated for this replay.');
      downloadBlob(result.blob, `${safeBaseName(loaded.file.name)}-formats.zip`);
      if (result.failures.length) setError(`${result.failures.length} format${result.failures.length === 1 ? '' : 's'} could not be included because validation failed.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not create the ZIP package.'); }
    finally { setBusy(''); }
  }

  return <main className="mx-auto min-h-[75vh] max-w-6xl px-5 py-12 lg:px-8">
    <header className="max-w-3xl"><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-300">Private browser conversion</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">Macro converter</h1><p className="mt-3 text-sm leading-6 text-zinc-500">Drop a replay, choose your tool or a file type, and download a verified conversion. The source file stays on your device.</p></header>
    {!loaded ? <section onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void load(file); }} className="surface-grid relative mt-9 overflow-hidden rounded-[28px] border border-dashed border-violet-400/25 bg-violet-500/[.055] p-12 text-center sm:p-20"><span className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] border border-violet-300/15 bg-violet-400/10 text-violet-200">{busy ? <LoaderCircle className="h-7 w-7 animate-spin" /> : <FileUp className="h-7 w-7" />}</span><h2 className="mt-5 text-xl font-semibold">Drop a macro file here</h2><p className="mt-2 text-sm text-zinc-500">All 23 implemented replay formats are detected automatically.</p><button type="button" disabled={Boolean(busy)} onClick={() => inputRef.current?.click()} className="mt-6 rounded-xl bg-violet-500 px-5 py-3 text-xs font-semibold hover:bg-violet-400 disabled:opacity-50">Choose a file</button><input ref={inputRef} className="sr-only" type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void load(file); }} /></section> : <div className="mt-9 space-y-6">
      <section className="rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[.17em] text-emerald-300">Parsed successfully</p><h2 className="mt-2 break-all text-lg font-semibold">{loaded.file.name}</h2><p className="mt-1 text-xs text-zinc-500">{loaded.sourceName}</p></div><button type="button" onClick={() => { setLoaded(null); setToolId(''); setError(''); }} className="inline-flex items-center gap-2 rounded-xl border border-white/[.08] px-3 py-2 text-[11px] text-zinc-400 hover:text-white"><RotateCcw className="h-3.5 w-3.5" />Different file</button></div>{analysis && <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Inputs" value={analysis.inputCount.toLocaleString()} /><Metric label="Duration" value={analysis.durationSeconds === null ? 'Unknown' : `${analysis.durationSeconds.toFixed(2)}s`} /><Metric label="Rate" value={analysis.rate ? `${analysis.rate} ${analysis.rateKind.toUpperCase()}` : 'Unknown'} /><Metric label="Players" value={analysis.player2Inputs ? 'P1 + P2' : 'P1'} /></div>}</section>
      <section><div className="flex flex-col gap-4 rounded-[24px] border border-white/[.075] bg-[#0e1118] p-5 sm:flex-row sm:items-end sm:justify-between"><label className="block flex-1"><span className="mb-2 block text-[11px] font-medium text-zinc-400">Filter for your replay tool</span><select value={toolId} onChange={(event) => setToolId(event.target.value)} className="h-12 w-full rounded-xl border border-white/[.08] bg-[#11151d] px-3.5 text-sm outline-none"><option value="">All formats</option>{replayToolRegistry.filter((tool) => tool.status === 'active').map((tool) => <option key={tool.id} value={tool.id}>{tool.displayName}</option>)}</select></label><button type="button" disabled={Boolean(busy) || !formats.some((entry) => entry.assessment.decision === 'allowed')} onClick={() => void all()} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-violet-400/20 bg-violet-400/[.09] px-5 text-xs font-semibold text-violet-100 hover:bg-violet-400/[.14] disabled:opacity-40">{busy === 'zip' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}Download all compatible formats</button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">{formats.map(({ format, assessment }) => { const allowed = assessment.decision === 'allowed'; const compatibility = toolId ? formatCompatibilityRegistry.find((entry) => entry.formatId === format.id && entry.replayToolId === toolId) : null; return <article key={format.id} className={`rounded-[20px] border p-4 ${allowed ? 'border-white/[.075] bg-[#0e1118]' : 'border-white/[.045] bg-white/[.015] opacity-65'}`}><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{format.displayName}</h3>{compatibility?.recommended && <span className="rounded-md bg-violet-400/10 px-2 py-1 text-[9px] font-semibold text-violet-200">Recommended</span>}</div><p className="mt-1 text-xs text-zinc-600">{format.extensions.join(', ')}</p></div>{allowed ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" /> : <ShieldAlert className="h-4 w-4 shrink-0 text-rose-300" />}</div><p className={`mt-4 text-[10px] font-semibold uppercase tracking-wider ${allowed && assessment.fidelity === 'lossless' ? 'text-emerald-300' : allowed ? 'text-amber-300' : 'text-rose-300'}`}>{allowed ? assessment.fidelity.replace('-', ' ') : 'Unsupported for this replay'}</p>{assessment.issues.length > 0 && <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-zinc-500">{assessment.issues.map((issue) => issue.message).join(' ')}</p>}<button type="button" disabled={!allowed || Boolean(busy)} onClick={() => void convert(format.id)} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-white/[.06] text-xs font-semibold hover:bg-white/[.1] disabled:cursor-not-allowed disabled:opacity-35">{busy === format.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}Download</button></article>; })}</div>
        {!formats.length && <div className="mt-4 rounded-2xl border border-dashed border-white/[.08] p-10 text-center text-sm text-zinc-600">No verified import formats are registered for this tool.</div>}
      </section>
    </div>}
    {error && <div role="alert" className="mt-6 flex gap-3 rounded-2xl border border-rose-400/15 bg-rose-400/[.06] p-4 text-sm text-rose-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
    <aside className="mt-8 flex items-start gap-3 rounded-2xl border border-cyan-400/10 bg-cyan-400/[.035] p-4 text-xs leading-5 text-zinc-500"><Wrench className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />Every generated file is checked against its parser. Conversions that would lose required gameplay or timing information are blocked.</aside>
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/[.055] bg-white/[.025] p-3"><p className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</p><p className="mt-1.5 truncate text-xs font-semibold text-zinc-200">{value}</p></div>; }
function safeBaseName(filename: string) { return filename.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'macro'; }
