import type { Metadata } from 'next';
import Link from '../../../components/ui/native-link';
import { notFound } from 'next/navigation';
import { getChatGPTUser } from '../../chatgpt-auth';
import { findAppUser } from '../../../lib/auth/app-user';
import { findLevelRecord, findMacroRecord, listCommentsForMacro, listProfileRecords } from '../../../lib/data/repository';
import { getPrisma } from '../../../lib/db/prisma';
import { listAvailableExports } from '../../../lib/replay/conversion';
import { getFormat } from '../../../lib/replay/registry';
import { compactNumber, formatDate } from '../../../lib/utils';
import { StatusBadge } from '../../../components/ui/status-badge';
import { MacroTimeline } from '../../../components/macro/macro-timeline';
import { DownloadPanel } from '../../../components/macro/download-panel';
import { CommentSection } from '../../../components/macro/comment-section';
import { MacroActions } from '../../../components/macro/macro-actions';
import { AddToCollection } from '../../../components/collection/add-to-collection';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const macro = await findMacroRecord(id);
  return { title: macro?.title ?? 'Macro not found', description: macro?.description || undefined };
}

export default async function MacroPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [macro, profiles, identity] = await Promise.all([findMacroRecord(id, true), listProfileRecords(), getChatGPTUser()]);
  if (!macro) notFound();
  const [level, comments, appUser] = await Promise.all([
    findLevelRecord(macro.levelId),
    listCommentsForMacro(macro.id),
    identity ? findAppUser(identity) : Promise.resolve(null),
  ]);
  if (!level) notFound();
  const uploader = profiles.find((profile) => profile.id === macro.uploaderId);
  if (!uploader) notFound();
  const prisma = getPrisma();
  const liked = appUser && prisma ? Boolean(await prisma.like.findUnique({ where: { userId_macroId: { userId: appUser.id, macroId: macro.id } } })) : false;
  const capabilityByFormat = new Map((macro.formatCapabilities ?? []).map((capability) => [capability.formatId, capability]));
  const targets = macro.canonical ? listAvailableExports(macro.canonical)
    .filter(({ format }) => capabilityByFormat.has(format.id))
    .map(({ format, assessment }) => ({
    id: format.id,
    name: format.displayName,
    extension: format.extensions[0],
    fidelity: assessment.decision === 'allowed' ? assessment.fidelity : 'compatible' as const,
    issues: assessment.issues.map((issue) => ({ code: issue.code, message: issue.message, requiresAcknowledgement: issue.requiresAcknowledgement })),
    tools: (capabilityByFormat.get(format.id)?.tools ?? []).filter((tool) => tool.id !== 'macrohub'),
  })) : [];
  const format = getFormat(macro.originalFormatId);
  const timeline = macro.canonical?.events.filter((event) => event.kind === 'input').slice(0, 100).map((event) => ({ tick: event.tick, player: event.player, state: event.state, control: event.control.kind })) ?? [];

  return (
    <main className="mx-auto min-h-[75vh] max-w-7xl px-5 py-12 lg:px-8">
      <nav className="mb-6 text-xs text-zinc-600"><Link href={`/level/${level.id}`} className="hover:text-zinc-300">{level.name}</Link><span className="mx-2">/</span>{macro.title}</nav>
      <section className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <div className="flex flex-wrap items-center gap-3"><StatusBadge status={macro.status} /><span className="text-[11px] text-zinc-600">Uploaded {formatDate(macro.uploadedAt)}</span></div>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-.045em] sm:text-5xl">{macro.title}</h1>
          <p className="mt-3 text-sm text-zinc-500"><Link className="text-violet-300 hover:text-violet-200" href={`/level/${level.id}`}>{level.name}</Link> by {level.creator} · uploaded by <Link className="text-zinc-300 hover:text-white" href={`/profile/${uploader.username}`}>@{uploader.username}</Link></p>
          {macro.description && <p className="mt-6 max-w-3xl whitespace-pre-wrap text-sm leading-7 text-zinc-400">{macro.description}</p>}
          {macro.status === 'Possibly outdated' && <div className="mt-5 rounded-xl border border-amber-400/15 bg-amber-400/[.06] p-4 text-sm text-amber-200">Possibly outdated{macro.recordedGdVersion ? ` — recorded on GD ${macro.recordedGdVersion}` : ''}</div>}
          <div className="mt-6 flex flex-wrap gap-2"><MacroActions macroId={macro.id} initialLiked={liked} initialLikes={macro.likeCount} signedIn={Boolean(identity)} /><AddToCollection macroId={macro.id} signedIn={Boolean(identity)} /></div>
        </div>
        <dl className="grid grid-cols-2 gap-3 rounded-[24px] border border-white/[.075] bg-[#0e1118] p-4 lg:grid-cols-1">
          <Metric label="Completion" value={macro.completion === undefined ? 'Unknown' : `${macro.completion}%`} />
          <Metric label="Rate" value={macro.tps ? `${macro.tps} TPS` : macro.fps ? `${macro.fps} FPS` : 'Unknown'} />
          <Metric label="Inputs" value={macro.inputCount.toLocaleString()} />
          <Metric label="Duration" value={`${macro.durationSeconds.toFixed(2)}s`} />
        </dl>
      </section>

      <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Detail label="Player 1 / Player 2" value={`${macro.player1Inputs.toLocaleString()} / ${macro.player2Inputs.toLocaleString()} inputs`} />
        <Detail label="Recorded GD version" value={macro.recordedGdVersion ?? 'Unknown'} />
        <Detail label="Original format" value={format?.extensions.join(' / ') ?? macro.originalFormatId} />
        <Detail label="Activity" value={`${compactNumber(macro.downloadCount)} downloads · ${compactNumber(macro.likeCount)} likes`} />
      </section>

      <div className="mt-10 space-y-8">
        {timeline.length > 0 && <MacroTimeline events={timeline} />}
        <DownloadPanel macroId={macro.id} targets={targets} />
        <CommentSection macroId={macro.id} initialComments={comments} currentUserId={appUser?.id ?? null} />
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-white/[.055] bg-white/[.025] p-3"><dt className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</dt><dd className="mt-1.5 text-sm font-semibold text-zinc-200">{value}</dd></div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-white/[.07] bg-[#0e1118] p-4"><p className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</p><p className="mt-2 text-sm font-medium text-zinc-300">{value}</p></div>; }
