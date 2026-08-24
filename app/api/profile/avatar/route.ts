import { getChatGPTUser } from '../../../chatgpt-auth';
import { ensureAppUser } from '../../../../lib/auth/app-user';
import { getPrisma } from '../../../../lib/db/prisma';
import { assertSameOrigin, jsonError, rejectOversizedRequest } from '../../../../lib/security/request';
import { getObjectStorage, randomStorageKey } from '../../../../lib/storage/object-storage';

export const runtime = 'edge';
const types = new Map([
  ['image/png', { extension: '.png', magic: [0x89, 0x50, 0x4e, 0x47] }],
  ['image/jpeg', { extension: '.jpg', magic: [0xff, 0xd8, 0xff] }],
  ['image/webp', { extension: '.webp', magic: [0x52, 0x49, 0x46, 0x46] }],
]);

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const sizeError = rejectOversizedRequest(request, 2_500_000);
  if (sizeError) return sizeError;
  const identity = await getChatGPTUser();
  if (!identity) return jsonError('AUTH_REQUIRED', 'Sign in to upload an avatar.', 401);
  const prisma = getPrisma();
  if (!prisma) return jsonError('DATABASE_UNAVAILABLE', 'Avatar upload is unavailable right now.', 503);
  const form = await request.formData();
  const file = form.get('avatar');
  if (!(file instanceof File) || file.size <= 0 || file.size > 2 * 1024 * 1024) return jsonError('INVALID_AVATAR', 'Choose an image up to 2 MiB.', 415);
  const definition = types.get(file.type);
  if (!definition) return jsonError('INVALID_AVATAR_TYPE', 'Use PNG, JPEG, or WebP.', 415);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!definition.magic.every((byte, index) => bytes[index] === byte) || (file.type === 'image/webp' && new TextDecoder().decode(bytes.slice(8, 12)) !== 'WEBP')) return jsonError('INVALID_AVATAR_DATA', 'The image contents do not match its file type.', 415);
  const user = await ensureAppUser(identity);
  const key = randomStorageKey('avatar', definition.extension);
  const storage = getObjectStorage();
  await storage.put(key, bytes, { contentType: file.type, metadata: { owner: user.id } });
  const previous = user.profile?.avatarStorageKey;
  await prisma.profile.update({ where: { userId: user.id }, data: { avatarStorageKey: key } });
  if (previous) await storage.delete(previous).catch(() => undefined);
  return Response.json({ avatarUrl: `/api/profile/avatar/${encodeURIComponent(user.profile!.username)}?v=${Date.now()}` });
}
