import { z } from 'zod';
import { getChatGPTUser } from '../../../chatgpt-auth';
import { findAppUser } from '../../../../lib/auth/app-user';
import { getPrisma } from '../../../../lib/db/prisma';
import { assertSameOrigin, jsonError, readJsonBody } from '../../../../lib/security/request';

export const runtime = 'edge';

async function ownedComment(request: Request, id: string) {
  const originError = assertSameOrigin(request);
  if (originError) return { response: originError } as const;
  const identity = await getChatGPTUser();
  if (!identity) return { response: jsonError('AUTH_REQUIRED', 'Sign in to manage comments.', 401) } as const;
  const prisma = getPrisma();
  if (!prisma) return { response: jsonError('DATABASE_UNAVAILABLE', 'Comments are unavailable right now.', 503) } as const;
  const user = await findAppUser(identity);
  if (!user) return { response: jsonError('COMMENT_FORBIDDEN', 'You do not own this comment.', 403) } as const;
  const comment = await prisma.comment.findUnique({ where: { id } });
  if (!comment) return { response: jsonError('COMMENT_NOT_FOUND', 'Comment not found.', 404) } as const;
  if (comment.authorId !== user.id) return { response: jsonError('COMMENT_FORBIDDEN', 'You do not own this comment.', 403) } as const;
  return { response: null, prisma, comment } as const;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const value = await ownedComment(request, id);
  if (value.response) return value.response;
  const body = await readJsonBody(request);
  if (body.response) return body.response;
  const parsed = z.object({ body: z.string().trim().min(1).max(2000) }).safeParse(body.data);
  if (!parsed.success) return jsonError('INVALID_COMMENT', 'Comment must be between 1 and 2,000 characters.', 422);
  const comment = await value.prisma.comment.update({ where: { id }, data: { body: parsed.data.body, editedAt: new Date() } });
  return Response.json({ comment });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const value = await ownedComment(request, id);
  if (value.response) return value.response;
  if (value.comment.state === 'VISIBLE') {
    await value.prisma.$transaction([
      value.prisma.comment.update({ where: { id }, data: { state: 'DELETED', body: '' } }),
      value.prisma.macro.update({ where: { id: value.comment.macroId }, data: { commentCount: { decrement: 1 } } }),
    ]);
  }
  return Response.json({ deleted: true });
}
