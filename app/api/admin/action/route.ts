import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { requireModeratorApi } from '../../../../lib/auth/moderation';
import { jsonError, readJsonBody } from '../../../../lib/security/request';

export const runtime = 'edge';
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('remove_macro'), targetId: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal('restore_macro'), targetId: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal('remove_comment'), targetId: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal('ban_user'), targetId: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal('set_macro_status'), targetId: z.string().uuid(), status: z.enum(['WORKING', 'UNVERIFIED', 'POSSIBLY_OUTDATED', 'BROKEN']), reason: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal('resolve_report'), targetId: z.string().uuid(), reason: z.string().trim().min(3).max(1000) }),
]);

export async function POST(request: Request) {
  const context = await requireModeratorApi(request);
  if (context.response) return context.response;
  const body = await readJsonBody(request);
  if (body.response) return body.response;
  const parsed = actionSchema.safeParse(body.data);
  if (!parsed.success) return jsonError('INVALID_MODERATION_ACTION', 'Check the moderation action.', 422);
  const input = parsed.data;
  const snapshot: Record<string, unknown> = {};
  let action: 'REMOVE_MACRO' | 'RESTORE_MACRO' | 'REMOVE_COMMENT' | 'BAN_USER' | 'SET_MACRO_STATUS' | 'RESOLVE_REPORT';
  let targets: { targetMacroId?: string; targetCommentId?: string; targetUserId?: string } = {};
  await context.prisma.$transaction(async (transaction) => {
    if (input.action === 'remove_macro' || input.action === 'restore_macro') {
      const before = await transaction.macro.findUnique({ where: { id: input.targetId }, select: { publicationState: true, workingStatus: true, levelId: true, uploaderId: true, publishedAt: true } });
      if (!before) throw new Error('Macro not found');
      Object.assign(snapshot, { before });
      const nextState = input.action === 'remove_macro' ? 'REMOVED' : 'PUBLISHED';
      await transaction.macro.update({ where: { id: input.targetId }, data: { publicationState: nextState, publishedAt: nextState === 'PUBLISHED' ? before.publishedAt ?? new Date() : undefined, deletedAt: input.action === 'remove_macro' ? new Date() : null } });
      const countDelta = before.publicationState === 'PUBLISHED' && nextState !== 'PUBLISHED'
        ? -1
        : before.publicationState !== 'PUBLISHED' && nextState === 'PUBLISHED'
          ? 1
          : 0;
      if (countDelta) {
        await Promise.all([
          transaction.level.update({ where: { id: before.levelId }, data: { macroCount: { increment: countDelta } } }),
          transaction.profile.update({ where: { userId: before.uploaderId }, data: { macroCount: { increment: countDelta } } }),
        ]);
      }
      action = input.action === 'remove_macro' ? 'REMOVE_MACRO' : 'RESTORE_MACRO';
      targets = { targetMacroId: input.targetId };
    } else if (input.action === 'remove_comment') {
      const before = await transaction.comment.findUnique({ where: { id: input.targetId }, select: { state: true, body: true, macroId: true } });
      if (!before) throw new Error('Comment not found');
      Object.assign(snapshot, { before });
      await transaction.comment.update({ where: { id: input.targetId }, data: { state: 'REMOVED', body: '' } });
      if (before.state === 'VISIBLE') await transaction.macro.update({ where: { id: before.macroId }, data: { commentCount: { decrement: 1 } } });
      action = 'REMOVE_COMMENT'; targets = { targetCommentId: input.targetId };
    } else if (input.action === 'ban_user') {
      const before = await transaction.user.findUnique({ where: { id: input.targetId }, select: { state: true } });
      if (!before) throw new Error('User not found');
      Object.assign(snapshot, { before });
      await transaction.user.update({ where: { id: input.targetId }, data: { state: 'BANNED' } });
      action = 'BAN_USER'; targets = { targetUserId: input.targetId };
    } else if (input.action === 'set_macro_status') {
      const before = await transaction.macro.findUnique({ where: { id: input.targetId }, select: { workingStatus: true } });
      if (!before) throw new Error('Macro not found');
      Object.assign(snapshot, { before, after: input.status });
      await transaction.macro.update({ where: { id: input.targetId }, data: { workingStatus: input.status } });
      action = 'SET_MACRO_STATUS'; targets = { targetMacroId: input.targetId };
    } else {
      const report = await transaction.macroReport.update({ where: { id: input.targetId }, data: { state: 'RESOLVED', reviewedById: context.user.id, reviewedAt: new Date() } });
      Object.assign(snapshot, { reportId: report.id, macroId: report.macroId });
      action = 'RESOLVE_REPORT'; targets = { targetMacroId: report.macroId };
    }
    const persistedSnapshot = JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonObject;
    await transaction.moderationAction.create({ data: { moderatorId: context.user.id, action, reason: input.reason, snapshot: persistedSnapshot, ...targets } });
  });
  return Response.json({ ok: true });
}
