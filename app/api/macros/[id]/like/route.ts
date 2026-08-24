import { getChatGPTUser } from '../../../../chatgpt-auth';
import { ensureAppUser } from '../../../../../lib/auth/app-user';
import { getPrisma } from '../../../../../lib/db/prisma';
import { assertSameOrigin, jsonError } from '../../../../../lib/security/request';

export const runtime = 'edge';

async function context(request: Request, id: string) {
  const originError = assertSameOrigin(request);
  if (originError) return { response: originError } as const;
  const identity = await getChatGPTUser();
  if (!identity) return { response: jsonError('AUTH_REQUIRED', 'Sign in to like macros.', 401) } as const;
  const prisma = getPrisma();
  if (!prisma) return { response: jsonError('DATABASE_UNAVAILABLE', 'Likes are unavailable right now.', 503) } as const;
  const [user, macro] = await Promise.all([
    ensureAppUser(identity),
    prisma.macro.findFirst({ where: { id, publicationState: 'PUBLISHED' }, select: { id: true, uploaderId: true } }),
  ]);
  if (!macro) return { response: jsonError('MACRO_NOT_FOUND', 'Macro not found.', 404) } as const;
  return { response: null, prisma, user, macro } as const;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const value = await context(request, id);
  if (value.response) return value.response;
  await value.prisma.$transaction(async (transaction) => {
    const inserted = await transaction.like.createMany({ data: [{ userId: value.user.id, macroId: id }], skipDuplicates: true });
    if (!inserted.count) return;
    await Promise.all([
      transaction.macro.update({ where: { id }, data: { likeCount: { increment: 1 } } }),
      transaction.profile.update({ where: { userId: value.macro.uploaderId }, data: { totalLikes: { increment: 1 } } }),
    ]);
  });
  const macro = await value.prisma.macro.findUnique({ where: { id }, select: { likeCount: true } });
  return Response.json({ liked: true, likeCount: macro?.likeCount ?? 0 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const value = await context(request, id);
  if (value.response) return value.response;
  await value.prisma.$transaction(async (transaction) => {
    const removed = await transaction.like.deleteMany({ where: { userId: value.user.id, macroId: id } });
    if (!removed.count) return;
    await Promise.all([
      transaction.macro.update({ where: { id }, data: { likeCount: { decrement: 1 } } }),
      transaction.profile.update({ where: { userId: value.macro.uploaderId }, data: { totalLikes: { decrement: 1 } } }),
    ]);
  });
  const macro = await value.prisma.macro.findUnique({ where: { id }, select: { likeCount: true } });
  return Response.json({ liked: false, likeCount: macro?.likeCount ?? 0 });
}
