import { getChatGPTUser } from '../../../../../chatgpt-auth';
import { findAppUser } from '../../../../../../lib/auth/app-user';
import { findMacroRecord } from '../../../../../../lib/data/repository';
import { getPrisma } from '../../../../../../lib/db/prisma';
import { convertReplay } from '../../../../../../lib/replay/conversion';
import type { ResolvedToolCompatibility } from '../../../../../../lib/replay/conversion';
import { getFormat } from '../../../../../../lib/replay/registry';
import { anonymousActorHash, userActorHash } from '../../../../../../lib/security/actor';
import { checkRateLimit, rateLimitHeaders } from '../../../../../../lib/security/rate-limit';
import { jsonError } from '../../../../../../lib/security/request';

export const runtime = 'edge';

export async function GET(request: Request, { params }: { params: Promise<{ id: string; format: string }> }) {
  const { id, format: formatId } = await params;
  const target = getFormat(formatId);
  if (!target?.exporter || target.status !== 'implemented') return jsonError('FORMAT_UNAVAILABLE', 'This file format is not available.', 404);
  const identity = await getChatGPTUser();
  const appUser = identity ? await findAppUser(identity) : null;
  const actorHash = appUser ? await userActorHash(appUser.id) : await anonymousActorHash(request);
  const limit = await checkRateLimit(`macro-download:${actorHash}`, { limit: 60, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return jsonError('RATE_LIMITED', 'Download limit reached. Try again later.', 429);

  const macro = await findMacroRecord(id, true);
  if (!macro?.canonical) return jsonError('MACRO_NOT_FOUND', 'Macro not found.', 404);
  const url = new URL(request.url);
  const toolId = (url.searchParams.get('tool') ?? '').slice(0, 64);
  const acknowledgedIssueCodes = (url.searchParams.get('ack') ?? '').split(',').filter(Boolean).slice(0, 30);
  const prisma = getPrisma();
  if (!prisma) return jsonError('SERVICE_UNAVAILABLE', 'Downloads are temporarily unavailable.', 503);

  let capability;
  let selectedTool: { id: string } | null = null;
  let resolvedToolCompatibility: ResolvedToolCompatibility | undefined;
  try {
    capability = await prisma.macroConversionCapability.findFirst({
      where: {
        macroId: id,
        quality: { not: 'BLOCKED' },
        format: {
          slug: formatId,
          enabled: true,
          implementationStatus: 'IMPLEMENTED',
        },
      },
      include: {
        format: { select: { id: true } },
        macro: { select: { canonicalHash: true, levelId: true, uploaderId: true } },
      },
    });
    if (!capability
      || capability.canonicalHash !== capability.macro.canonicalHash
      || capability.exporterVersion !== target.exporter.implementationVersion) {
      return jsonError('FORMAT_UNAVAILABLE', 'This file format is not available for this macro.', 404);
    }
    if (toolId) {
      const tool = await prisma.replayTool.findUnique({ where: { slug: toolId }, select: { id: true, status: true } });
      if (!tool || tool.status !== 'ACTIVE') return jsonError('TOOL_UNAVAILABLE', 'This replay tool is not available.', 422);
      const compatibility = await prisma.formatToolCompatibility.findUnique({
        where: { formatId_replayToolId: { formatId: capability.format.id, replayToolId: tool.id } },
        select: { canRead: true, supportLevel: true, verification: true, warning: true },
      });
      if (!compatibility
        || !compatibility.canRead
        || compatibility.supportLevel === 'UNSUPPORTED'
        || !['verified', 'community-reported'].includes(compatibility.verification)) {
        return jsonError('TOOL_FORMAT_NOT_COMPATIBLE', 'This file format is not available for the selected replay tool.', 422);
      }
      selectedTool = tool;
      resolvedToolCompatibility = {
        replayToolId: toolId,
        verification: compatibility.verification as ResolvedToolCompatibility['verification'],
        notes: compatibility.warning ?? undefined,
      };
    }
  } catch {
    return jsonError('SERVICE_UNAVAILABLE', 'Downloads are temporarily unavailable.', 503);
  }

  try {
    const result = await convertReplay(macro.canonical, formatId, {
      replayToolId: toolId || null,
      acknowledgedIssueCodes,
      resolvedToolCompatibility,
    });
    try {
      const windowStart = new Date(Math.floor(Date.now() / 600_000) * 600_000);
      await prisma.$transaction(async (transaction) => {
        const inserted = await transaction.download.createMany({
          data: [{
            macroId: id,
            formatId: capability.format.id,
            userId: appUser?.id ?? null,
            replayToolId: selectedTool?.id ?? null,
            actorHash,
            dedupeWindowStart: windowStart,
          }],
          skipDuplicates: true,
        });
        if (!inserted.count) return;
        await Promise.all([
          transaction.macro.update({ where: { id }, data: { downloadCount: { increment: 1 } } }),
          transaction.level.update({ where: { id: capability.macro.levelId }, data: { totalDownloads: { increment: 1 } } }),
          transaction.profile.update({ where: { userId: capability.macro.uploaderId }, data: { totalDownloads: { increment: 1 } } }),
        ]);
      });
    } catch {
      // Analytics failure must not prevent a valid file download.
    }
    const filename = result.artifact.filename.replace(/[^a-z0-9._-]/gi, '-');
    return new Response(result.artifact.bytes as BodyInit, {
      headers: {
        'Content-Type': result.artifact.mediaType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
        ...rateLimitHeaders(limit),
      },
    });
  } catch (error) {
    const details = error && typeof error === 'object' && 'issues' in error ? (error as { issues: unknown }).issues : undefined;
    return jsonError('DOWNLOAD_BLOCKED', error instanceof Error ? error.message : 'Download could not be generated.', 422, details);
  }
}
