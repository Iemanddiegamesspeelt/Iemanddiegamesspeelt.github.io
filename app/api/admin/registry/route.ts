import { z } from 'zod';
import { requireModeratorApi } from '../../../../lib/auth/moderation';
import { jsonError, readJsonBody } from '../../../../lib/security/request';

export const runtime = 'edge';
const inputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('format'), slug: z.string().max(64), enabled: z.boolean().optional(), warning: z.string().max(500).nullable().optional() }),
  z.object({ kind: z.literal('tool'), slug: z.string().max(64), status: z.enum(['ACTIVE', 'DEPRECATED', 'PLANNED']) }),
  z.object({
    kind: z.literal('compatibility'),
    formatSlug: z.string().max(64),
    toolSlug: z.string().max(64),
    canRead: z.boolean(),
    canWrite: z.boolean(),
    supportLevel: z.enum(['NATIVE', 'COMPATIBLE', 'EXPERIMENTAL', 'UNSUPPORTED']),
    verification: z.enum(['verified', 'community-reported', 'unknown']),
    recommended: z.boolean(),
    minToolVersion: z.string().trim().max(64).nullable().optional(),
    maxToolVersion: z.string().trim().max(64).nullable().optional(),
    warning: z.string().max(500).nullable().optional(),
  }),
]);

export async function PATCH(request: Request) {
  const context = await requireModeratorApi(request);
  if (context.response) return context.response;
  const body = await readJsonBody(request);
  if (body.response) return body.response;
  const parsed = inputSchema.safeParse(body.data);
  if (!parsed.success) return jsonError('INVALID_REGISTRY_UPDATE', 'Check the registry update.', 422);
  const input = parsed.data;
  if (input.kind === 'format') {
    const row = await context.prisma.$transaction(async (transaction) => {
      const before = await transaction.macroFormat.findUnique({ where: { slug: input.slug } });
      if (!before) return null;
      const updated = await transaction.macroFormat.update({ where: { slug: input.slug }, data: { enabled: input.enabled, warning: input.warning } });
      const snapshot = JSON.parse(JSON.stringify({ before, after: updated }));
      await transaction.moderationAction.create({ data: { moderatorId: context.user.id, action: 'UPDATE_FORMAT', reason: 'Registry update', targetFormatId: updated.id, snapshot } });
      return updated;
    });
    if (!row) return jsonError('FORMAT_NOT_FOUND', 'Format not found.', 404);
    return Response.json({ format: row });
  }
  if (input.kind === 'tool') {
    const row = await context.prisma.$transaction(async (transaction) => {
      const before = await transaction.replayTool.findUnique({ where: { slug: input.slug } });
      if (!before) return null;
      const updated = await transaction.replayTool.update({ where: { slug: input.slug }, data: { status: input.status } });
      const snapshot = JSON.parse(JSON.stringify({ before, after: updated }));
      await transaction.moderationAction.create({ data: { moderatorId: context.user.id, action: 'UPDATE_REPLAY_TOOL', reason: 'Registry update', targetToolId: updated.id, snapshot } });
      return updated;
    });
    if (!row) return jsonError('TOOL_NOT_FOUND', 'Replay tool not found.', 404);
    return Response.json({ tool: row });
  }
  if (input.supportLevel === 'UNSUPPORTED' && (input.canRead || input.canWrite)) {
    return jsonError('INVALID_COMPATIBILITY_DIRECTION', 'Unsupported entries cannot be marked readable or writable.', 422);
  }
  if (input.supportLevel !== 'UNSUPPORTED' && !input.canRead && !input.canWrite) {
    return jsonError('INVALID_COMPATIBILITY_DIRECTION', 'Choose read, write, or both.', 422);
  }
  const direction = input.supportLevel === 'UNSUPPORTED' ? 'IMPORT' : input.canRead && input.canWrite ? 'BOTH' : input.canRead ? 'IMPORT' : 'EXPORT';
  const verificationFields = {
    verification: input.verification,
    verifiedAt: input.verification === 'verified' ? new Date() : null,
  };
  const row = await context.prisma.$transaction(async (transaction) => {
    const [format, tool] = await Promise.all([
      transaction.macroFormat.findUnique({ where: { slug: input.formatSlug } }),
      transaction.replayTool.findUnique({ where: { slug: input.toolSlug } }),
    ]);
    if (!format || !tool) return null;
    const before = await transaction.formatToolCompatibility.findUnique({ where: { formatId_replayToolId: { formatId: format.id, replayToolId: tool.id } } });
    const updated = await transaction.formatToolCompatibility.upsert({
      where: { formatId_replayToolId: { formatId: format.id, replayToolId: tool.id } },
      create: {
        formatId: format.id,
        replayToolId: tool.id,
      canRead: input.canRead,
      canWrite: input.canWrite,
      direction,
      supportLevel: input.supportLevel,
      recommended: input.recommended,
      minToolVersion: input.minToolVersion,
      maxToolVersion: input.maxToolVersion,
      warning: input.warning,
      ...verificationFields,
    },
      update: {
      canRead: input.canRead,
      canWrite: input.canWrite,
      direction,
      supportLevel: input.supportLevel,
      recommended: input.recommended,
      minToolVersion: input.minToolVersion,
      maxToolVersion: input.maxToolVersion,
      warning: input.warning,
      ...verificationFields,
      },
    });
    const snapshot = JSON.parse(JSON.stringify({ before, after: updated }));
    await transaction.moderationAction.create({ data: { moderatorId: context.user.id, action: 'UPDATE_COMPATIBILITY', reason: 'Registry update', targetFormatId: format.id, targetToolId: tool.id, snapshot } });
    return updated;
  });
  if (!row) return jsonError('REGISTRY_ENTRY_NOT_FOUND', 'Format or replay tool not found.', 404);
  return Response.json({ compatibility: row });
}
