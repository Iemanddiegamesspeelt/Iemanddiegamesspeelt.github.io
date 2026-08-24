import { z } from 'zod';
import { getChatGPTUser } from '../../../../chatgpt-auth';
import { findAppUser } from '../../../../../lib/auth/app-user';
import { getPrisma } from '../../../../../lib/db/prisma';
import { assertSameOrigin, jsonError, readJsonBody } from '../../../../../lib/security/request';

export const runtime = 'edge';
const bodySchema = z.object({ macroId: z.string().uuid() }).strict();

async function context(request: Request, id: string) {
  const originError = assertSameOrigin(request);
  if (originError) return { response: originError } as const;
  const identity = await getChatGPTUser();
  if (!identity) return { response: jsonError('AUTH_REQUIRED', 'Sign in to manage collections.', 401) } as const;
  const prisma = getPrisma();
  if (!prisma) return { response: jsonError('DATABASE_UNAVAILABLE', 'Collections are unavailable right now.', 503) } as const;
  const user = await findAppUser(identity);
  const collection = user ? await prisma.collection.findUnique({ where: { id }, select: { ownerId: true } }) : null;
  if (!collection || collection.ownerId !== user?.id) return { response: jsonError('COLLECTION_FORBIDDEN', 'You do not own this collection.', 403) } as const;
  return { response: null, prisma } as const;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const value = await context(request, id);
  if (value.response) return value.response;
  const body = await readJsonBody(request);
  if (body.response) return body.response;
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return jsonError('INVALID_MACRO', 'Choose a valid macro.', 422);
  const macro = await value.prisma.macro.findFirst({ where: { id: parsed.data.macroId, publicationState: 'PUBLISHED' }, select: { id: true } });
  if (!macro) return jsonError('MACRO_NOT_FOUND', 'Macro not found.', 404);
  await value.prisma.$transaction(async (transaction) => {
    const added = await transaction.collectionMacro.createMany({ data: [{ collectionId: id, macroId: macro.id }], skipDuplicates: true });
    if (added.count) await transaction.collection.update({ where: { id }, data: { macroCount: { increment: 1 } } });
  });
  return Response.json({ added: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const value = await context(request, id);
  if (value.response) return value.response;
  const body = await readJsonBody(request);
  if (body.response) return body.response;
  const parsed = bodySchema.safeParse(body.data);
  if (!parsed.success) return jsonError('INVALID_MACRO', 'Choose a valid macro.', 422);
  await value.prisma.$transaction(async (transaction) => {
    const removed = await transaction.collectionMacro.deleteMany({ where: { collectionId: id, macroId: parsed.data.macroId } });
    if (removed.count) await transaction.collection.update({ where: { id }, data: { macroCount: { decrement: 1 } } });
  });
  return Response.json({ removed: true });
}
