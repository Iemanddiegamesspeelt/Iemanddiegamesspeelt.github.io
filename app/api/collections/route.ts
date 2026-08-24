import { z } from 'zod';
import { getChatGPTUser } from '../../chatgpt-auth';
import { ensureAppUser, findAppUser } from '../../../lib/auth/app-user';
import { listCollectionRecordsForOwner, listPublicCollectionRecords } from '../../../lib/data/repository';
import { getPrisma } from '../../../lib/db/prisma';
import { assertSameOrigin, jsonError, readJsonBody } from '../../../lib/security/request';

export const runtime = 'edge';
const inputSchema = z.object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(1000).optional().default(''), visibility: z.enum(['public', 'unlisted', 'private']).default('public') }).strict();

export async function GET(request: Request) {
  const mine = new URL(request.url).searchParams.get('mine') === '1';
  if (!mine) return Response.json({ collections: await listPublicCollectionRecords() });
  const identity = await getChatGPTUser();
  if (!identity) return jsonError('AUTH_REQUIRED', 'Sign in to view your collections.', 401);
  const user = await findAppUser(identity);
  return Response.json({ collections: user ? await listCollectionRecordsForOwner(user.id) : [] });
}

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const identity = await getChatGPTUser();
  if (!identity) return jsonError('AUTH_REQUIRED', 'Sign in to create a collection.', 401);
  const body = await readJsonBody(request);
  if (body.response) return body.response;
  const parsed = inputSchema.safeParse(body.data);
  if (!parsed.success) return jsonError('INVALID_COLLECTION', parsed.error.issues[0]?.message ?? 'Check the collection details.', 422);
  const prisma = getPrisma();
  if (!prisma) return jsonError('DATABASE_UNAVAILABLE', 'Collections are unavailable right now.', 503);
  const user = await ensureAppUser(identity);
  const baseSlug = parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'collection';
  const slug = `${baseSlug}-${crypto.randomUUID().slice(0, 7)}`;
  const row = await prisma.collection.create({ data: { ownerId: user.id, name: parsed.data.name, slugNormalized: slug, description: parsed.data.description || null, visibility: parsed.data.visibility.toUpperCase() as 'PUBLIC' | 'UNLISTED' | 'PRIVATE' } });
  return Response.json({ collection: { id: row.id, ownerId: row.ownerId, name: row.name, description: row.description ?? '', visibility: parsed.data.visibility, macroIds: [], updatedAt: row.updatedAt.toISOString(), accent: 'violet' } }, { status: 201 });
}
