'use client';

import { useState } from 'react';
import { Check, LoaderCircle, ShieldAlert, Trash2 } from 'lucide-react';

type Report = { id: string; macroId: string; macroTitle: string; verdict: string; reporter: string; createdAt: string };
type Format = { slug: string; name: string; extension: string; enabled: boolean; status: string };

export function AdminConsole({ initialReports, formats }: { initialReports: Report[]; formats: Format[] }) {
  const [reports, setReports] = useState(initialReports);
  const [formatRows, setFormatRows] = useState(formats);
  const [busy, setBusy] = useState('');

  async function action(payload: Record<string, unknown>, key: string) {
    setBusy(key);
    const response = await fetch('/api/admin/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (response.ok && payload.action === 'resolve_report') setReports((items) => items.filter((item) => item.id !== payload.targetId));
    setBusy('');
  }
  async function toggleFormat(format: Format) {
    setBusy(format.slug);
    const response = await fetch('/api/admin/registry', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'format', slug: format.slug, enabled: !format.enabled }) });
    if (response.ok) setFormatRows((rows) => rows.map((row) => row.slug === format.slug ? { ...row, enabled: !row.enabled } : row));
    setBusy('');
  }
  return <div className="space-y-10"><section><div className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-amber-300" /><h2 className="text-xl font-semibold">Open macro reports</h2></div><div className="mt-5 overflow-hidden rounded-[22px] border border-white/[.07] bg-[#0e1118]">{reports.map((report) => <div key={report.id} className="grid gap-3 border-b border-white/[.055] p-4 last:border-0 md:grid-cols-[1fr_auto] md:items-center"><div><p className="text-sm font-semibold">{report.macroTitle}</p><p className="mt-1 text-[11px] text-zinc-600">{report.verdict} · reported by {report.reporter}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void action({ action: 'set_macro_status', targetId: report.macroId, status: 'BROKEN', reason: 'Reviewed community report' }, `broken-${report.id}`)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-400/15 px-3 text-[10px] text-rose-300"><Trash2 className="h-3 w-3" /> Mark broken</button><button type="button" onClick={() => void action({ action: 'resolve_report', targetId: report.id, reason: 'Report reviewed' }, report.id)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-emerald-400/15 px-3 text-[10px] text-emerald-300">{busy === report.id ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Resolve</button></div></div>)}{!reports.length && <p className="p-8 text-center text-sm text-zinc-600">No open macro reports.</p>}</div></section><section><h2 className="text-xl font-semibold">Format availability</h2><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{formatRows.map((format) => <div key={format.slug} className="rounded-2xl border border-white/[.07] bg-[#0e1118] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{format.extension}</p><p className="mt-1 text-[10px] text-zinc-600">{format.name} · {format.status}</p></div><button type="button" disabled={busy === format.slug || format.status !== 'IMPLEMENTED'} onClick={() => void toggleFormat(format)} className={`rounded-lg px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-wider ${format.enabled ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/[.05] text-zinc-600'} disabled:opacity-40`}>{busy === format.slug ? 'Saving' : format.enabled ? 'Enabled' : 'Disabled'}</button></div></div>)}</div></section></div>;
}
