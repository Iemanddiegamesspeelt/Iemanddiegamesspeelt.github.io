import { z } from 'zod';
import { getChatGPTUser } from '../../../../chatgpt-auth';
import { ensureAppUser } from '../../../../../lib/auth/app-user';
import { getPrisma } from '../../../../../lib/db/prisma';
import { assertSameOrigin, jsonError, readJsonBody } from '../../../../../lib/security/request';

export const runtime = 'edge';
const reportSchema = z.object({ reason: z.string().trim().min(1).max(80), details: z.string().trim().max(1000).optional() }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const identity = await getChatGPTUser();
  if (!identity) return jsonError('AUTH_REQUIRED', 'Sign in to report a comment.', 401);
  const prisma = getPrisma();
  if (!prisma) return jsonError('DATABASE_UNAVAILABLE', 'Reports are unavailable right now.', 503);
  const body = await readJsonBody(request);
  if (body.response) return body.response;
  const parsed = reportSchema.safeParse(body.data);
  if (!parsed.success) return jsonError('INVALID_REPORT', 'Choose a valid report reason.', 422);
  const { id } = await params;
  const [user, comment] = await Promise.all([ensureAppUser(identity), prisma.comment.findUnique({ where: { id }, select: { id: true } })]);
  if (!comment) return jsonError('COMMENT_NOT_FOUND', 'Comment not found.', 404);
  const report = await prisma.commentReport.upsert({
    where: { commentId_reporterId: { commentId: id, reporterId: user.id } },
    create: { commentId: id, reporterId: user.id, reason: parsed.data.reason, details: parsed.data.details },
    update: { reason: parsed.data.reason, details: parsed.data.details, state: 'OPEN' },
  });
  return Response.json({ report: { id: report.id } });
}
