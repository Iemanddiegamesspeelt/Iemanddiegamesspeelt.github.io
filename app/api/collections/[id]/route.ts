import { z } from 'zod';
import { getChatGPTUser } from '../../../chatgpt-auth';
import { findAppUser } from '../../../../lib/auth/app-user';
import { findCollectionRecord } from '../../../../lib/data/repository';
import { getPrisma } from '../../../../lib/db/prisma';
import { assertSameOrigin, jsonError, readJsonBody } from '../../../../lib/security/request';

export const runtime = 'edge';
const patchSchema = z.object({ name: z.string().trim().min(1).max(100).optional(), description: z.string().trim().max(1000).optional(), visibility: z.enum(['public', 'unlisted', 'private']).optional() }).strict();

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const identity = await getChatGPTUser();
  const user = identity ? await findAppUser(identity) : null;
  const collection = await findCollectionRecord(id, user?.id);
  return collection ? Response.json({ collection }) : jsonError('COLLECTION_NOT_FOUND', 'Collection not found.', 404);
}

async function ownerContext(request: Request, id: string) {
  const originError = assertSameOrigin(request);
  if (originError) return { response: originError } as const;
  const identity = await getChatGPTUser();
  if (!identity) return { response: jsonError('AUTH_REQUIRED', 'Sign in to manage collections.', 401) } as const;
  const prisma = getPrisma();
  if (!prisma) return { response: jsonError('DATABASE_UNAVAILABLE', 'Collections are unavailable right now.', 503) } as const;
  const user = await findAppUser(identity);
  const collection = user ? await prisma.collection.findUnique({ where: { id } }) : null;
  if (!collection || collection.ownerId !== user?.id) return { response: jsonError('COLLECTION_FORBIDDEN', 'You do not own this collection.', 403) } as const;
  return { response: null, prisma, collection } as const;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await ownerContext(request, id);
  if (context.response) return context.response;
  const body = await readJsonBody(request);
  if (body.response) return body.response;
  const parsed = patchSchema.safeParse(body.data);
  if (!parsed.success) return jsonError('INVALID_COLLECTION', 'Check the collection details.', 422);
  const row = await context.prisma.collection.update({ where: { id }, data: { name: parsed.data.name, description: parsed.data.description, visibility: parsed.data.visibility?.toUpperCase() as 'PUBLIC' | 'UNLISTED' | 'PRIVATE' | undefined } });
  return Response.json({ collection: row });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await ownerContext(request, id);
  if (context.response) return context.response;
  await context.prisma.collection.delete({ where: { id } });
  return Response.json({ deleted: true });
}
