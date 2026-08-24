import { z } from 'zod';
import { getChatGPTUser } from '../../../../chatgpt-auth';
import { ensureAppUser } from '../../../../../lib/auth/app-user';
import { listCommentsForMacro } from '../../../../../lib/data/repository';
import { getPrisma } from '../../../../../lib/db/prisma';
import { assertSameOrigin, jsonError, readJsonBody } from '../../../../../lib/security/request';

export const runtime = 'edge';
const inputSchema = z.object({ body: z.string().trim().min(1).max(2000), parentId: z.string().uuid().nullable().optional() }).strict();

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return Response.json({ comments: await listCommentsForMacro(id) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const identity = await getChatGPTUser();
  if (!identity) return jsonError('AUTH_REQUIRED', 'Sign in to comment.', 401);
  const prisma = getPrisma();
  if (!prisma) return jsonError('DATABASE_UNAVAILABLE', 'Comments are unavailable right now.', 503);
  const body = await readJsonBody(request);
  if (body.response) return body.response;
  let input: z.infer<typeof inputSchema>;
  try { input = inputSchema.parse(body.data); } catch { return jsonError('INVALID_COMMENT', 'Comment must be between 1 and 2,000 characters.', 422); }
  const [user, macro, parent] = await Promise.all([
    ensureAppUser(identity),
    prisma.macro.findFirst({ where: { id: (await params).id, publicationState: 'PUBLISHED' }, select: { id: true } }),
    input.parentId ? prisma.comment.findUnique({ where: { id: input.parentId }, select: { id: true, macroId: true, parentId: true } }) : Promise.resolve(null),
  ]);
  const { id } = await params;
  if (!macro) return jsonError('MACRO_NOT_FOUND', 'Macro not found.', 404);
  if (input.parentId && (!parent || parent.macroId !== id || parent.parentId)) return jsonError('INVALID_PARENT', 'Replies must belong to a top-level comment on this macro.', 422);
  const comment = await prisma.$transaction(async (transaction) => {
    const created = await transaction.comment.create({ data: { macroId: id, authorId: user.id, parentId: input.parentId ?? null, body: input.body } });
    await transaction.macro.update({ where: { id }, data: { commentCount: { increment: 1 } } });
    return created;
  });
  const profile = user.profile;
  const displayName = profile?.displayName ?? profile?.username ?? identity.displayName;
  return Response.json({ comment: {
    id: comment.id,
    macroId: id,
    authorId: user.id,
    parentId: comment.parentId ?? undefined,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    state: 'visible',
    author: {
      id: user.id,
      username: profile?.username ?? `player-${user.id.slice(0, 8)}`,
      displayName,
      initials: displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
      avatarTone: 'from-violet-500 to-indigo-600',
      bio: profile?.bio ?? '',
      joinedAt: user.createdAt.toISOString(),
      macroCount: profile?.macroCount ?? 0,
      totalDownloads: profile?.totalDownloads ?? 0,
      totalLikes: profile?.totalLikes ?? 0,
      role: user.role.toLowerCase(),
    },
  } }, { status: 201 });
}
