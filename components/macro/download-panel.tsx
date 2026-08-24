'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Gamepad2 } from 'lucide-react';

type Issue = { code: string; message: string; requiresAcknowledgement?: boolean };
type DownloadTarget = {
  id: string;
  name: string;
  extension: string;
  fidelity: 'lossless' | 'compatible' | 'metadata-loss';
  issues: Issue[];
  tools: Array<{
    id: string;
    name: string;
    recommended: boolean;
    supportLevel: 'NATIVE' | 'COMPATIBLE' | 'EXPERIMENTAL';
    verification: 'verified' | 'community-reported';
    warning?: string;
  }>;
};

export function DownloadPanel({ macroId, targets }: { macroId: string; targets: DownloadTarget[] }) {
  const [toolId, setToolId] = useState('');
  const tools = useMemo(() => {
    const map = new Map<string, string>();
    for (const target of targets) for (const tool of target.tools) map.set(tool.id, tool.name);
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [targets]);
  const visible = targets.filter((target) => !toolId || target.tools.some((tool) => tool.id === toolId));

  return (
    <section id="downloads" className="scroll-mt-24 rounded-[26px] border border-white/[.075] bg-[#0e1118] p-5 sm:p-7">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-violet-300">Downloads</p>
          <h2 className="mt-2 text-2xl font-semibold">Choose a file format</h2>
        </div>
        <label className="w-full sm:w-64">
          <span className="mb-2 block text-[10px] text-zinc-500">Filter for your replay tool</span>
          <select value={toolId} onChange={(event) => setToolId(event.target.value)} className="h-11 w-full rounded-xl border border-white/[.08] bg-[#11151d] px-3 text-xs text-zinc-300 outline-none focus:border-violet-400/40">
            <option value="">All formats</option>
            {tools.map((tool) => <option key={tool.id} value={tool.id}>{tool.name}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-6 grid gap-3">
        {visible.map((target) => <DownloadFormat key={target.id} macroId={macroId} target={target} toolId={toolId} />)}
        {!visible.length && <div className="rounded-2xl border border-white/[.06] bg-white/[.025] p-5 text-sm text-zinc-500">No available file format matches this tool.</div>}
      </div>

      {tools.length > 0 && (
        <div className="mt-7 border-t border-white/[.065] pt-6">
          <p className="flex items-center gap-2 text-xs font-semibold text-zinc-300"><Gamepad2 className="h-4 w-4 text-violet-300" /> Works with</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {tools.map((tool) => <span key={tool.id} className="rounded-lg border border-white/[.07] bg-white/[.035] px-3 py-2 text-[11px] text-zinc-400">{tool.name}</span>)}
          </div>
        </div>
      )}
    </section>
  );
}

function DownloadFormat({ macroId, target, toolId }: { macroId: string; target: DownloadTarget; toolId: string }) {
  const warnings = target.issues.filter((issue) => issue.requiresAcknowledgement);
  const [acknowledged, setAcknowledged] = useState(false);
  const selectedCompatibility = target.tools.find((tool) => tool.id === toolId);
  const query = new URLSearchParams();
  if (toolId) query.set('tool', toolId);
  if (acknowledged) query.set('ack', warnings.map((issue) => issue.code).join(','));
  const href = `/api/macros/${macroId}/download/${target.id}${query.size ? `?${query}` : ''}`;
  const status = target.fidelity === 'lossless' ? 'Lossless' : target.fidelity === 'metadata-loss' ? 'Some metadata removed' : 'Compatible';
  return (
    <article className="rounded-2xl border border-white/[.07] bg-white/[.025] p-4 sm:flex sm:items-center sm:justify-between sm:gap-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{target.name} <span className="font-normal text-zinc-600">{target.extension}</span></h3>
          {selectedCompatibility?.recommended && <span className="rounded-md bg-violet-400/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-violet-300">Recommended</span>}
        </div>
        <p className={`mt-1.5 flex items-center gap-1.5 text-[11px] ${target.fidelity === 'metadata-loss' ? 'text-amber-300' : 'text-emerald-300'}`}>
          {target.fidelity === 'metadata-loss' ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}{status}
        </p>
        {target.issues.length > 0 && <p className="mt-2 max-w-2xl text-[11px] leading-5 text-zinc-500">{target.issues.map((issue) => issue.message).join(' ')}</p>}
        {selectedCompatibility && (selectedCompatibility.warning || selectedCompatibility.verification === 'community-reported' || selectedCompatibility.supportLevel === 'EXPERIMENTAL') && (
          <p className="mt-2 max-w-2xl text-[11px] leading-5 text-amber-300/80">
            {selectedCompatibility.warning ?? (selectedCompatibility.supportLevel === 'EXPERIMENTAL' ? 'Experimental tool compatibility.' : 'Compatibility is based on community reports.')}
          </p>
        )}
        {warnings.length > 0 && (
          <label className="mt-2 flex items-center gap-2 text-[10px] text-zinc-400">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="accent-violet-500" /> I understand this conversion note.
          </label>
        )}
      </div>
      <a aria-disabled={warnings.length > 0 && !acknowledged} href={warnings.length > 0 && !acknowledged ? undefined : href} className={`mt-4 inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold sm:mt-0 ${warnings.length > 0 && !acknowledged ? 'cursor-not-allowed bg-white/[.04] text-zinc-700' : 'bg-violet-500 text-white hover:bg-violet-400'}`}>
        <Download className="h-3.5 w-3.5" /> Download
      </a>
    </article>
  );
}
