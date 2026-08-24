import { getPrisma } from '../../../../../lib/db/prisma';
import { jsonError } from '../../../../../lib/security/request';
import { getObjectStorage } from '../../../../../lib/storage/object-storage';

export const runtime = 'edge';

export async function GET(_: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const prisma = getPrisma();
  if (!prisma) return jsonError('AVATAR_NOT_FOUND', 'Avatar not found.', 404);
  const profile = await prisma.profile.findUnique({ where: { usernameNormalized: username.toLowerCase() }, select: { avatarStorageKey: true } });
  if (!profile?.avatarStorageKey) return jsonError('AVATAR_NOT_FOUND', 'Avatar not found.', 404);
  const object = await getObjectStorage().get(profile.avatarStorageKey);
  if (!object) return jsonError('AVATAR_NOT_FOUND', 'Avatar not found.', 404);
  return new Response(object.bytes as BodyInit, { headers: { 'Content-Type': object.contentType, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' } });
}
