import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireChatGPTUser } from '../chatgpt-auth';
import { findAppUser } from '../../lib/auth/app-user';
import { getPrisma } from '../../lib/db/prisma';
import { AdminConsole } from '../../components/admin/admin-console';

export const metadata: Metadata = { title: 'Moderation' };

export default async function AdminPage() {
  const identity = await requireChatGPTUser('/admin');
  const user = await findAppUser(identity);
  if (!user || (user.role !== 'MODERATOR' && user.role !== 'ADMIN')) notFound();
  const prisma = getPrisma();
  if (!prisma) return <main className="mx-auto min-h-[70vh] max-w-4xl px-5 py-16"><h1 className="text-3xl font-semibold">Moderation unavailable</h1></main>;
  const [reports, formats] = await Promise.all([
    prisma.macroReport.findMany({ where: { state: 'OPEN' }, include: { macro: { select: { title: true } }, reporter: { include: { profile: true } } }, orderBy: { createdAt: 'asc' }, take: 100 }),
    prisma.macroFormat.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);
  return <main className="mx-auto min-h-[75vh] max-w-7xl px-5 py-12 lg:px-8"><header className="mb-10"><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-300">Staff tools</p><h1 className="mt-3 text-4xl font-semibold tracking-[-.045em]">Moderation</h1><p className="mt-3 text-sm text-zinc-500">Review reports and manage platform registries.</p></header><AdminConsole initialReports={reports.map((report) => ({ id: report.id, macroId: report.macroId, macroTitle: report.macro.title, verdict: report.verdict.toLowerCase(), reporter: report.reporter.profile?.username ?? 'user', createdAt: report.createdAt.toISOString() }))} formats={formats.map((format) => ({ slug: format.slug, name: format.name, extension: format.defaultExtension, enabled: format.enabled, status: format.implementationStatus }))} /></main>;
}
