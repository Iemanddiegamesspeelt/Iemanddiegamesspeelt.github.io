import { z } from 'zod';
import { getChatGPTUser } from '../../chatgpt-auth';
import { ensureAppUser } from '../../../lib/auth/app-user';
import { getPrisma } from '../../../lib/db/prisma';
import { assertSameOrigin, jsonError, readJsonBody } from '../../../lib/security/request';

export const runtime = 'edge';
const profileInput = z.object({
  username: z.string().trim().toLowerCase().min(3).max(32).regex(/^[a-z0-9][a-z0-9_-]*$/, 'Use letters, numbers, underscores, or hyphens.'),
  displayName: z.string().trim().min(1).max(80),
  bio: z.string().trim().max(500),
}).strict();

export async function GET() {
  const identity = await getChatGPTUser();
  if (!identity) return jsonError('AUTH_REQUIRED', 'Sign in to view your profile.', 401);
  try {
    const user = await ensureAppUser(identity);
    return Response.json({ profile: user.profile });
  } catch { return jsonError('DATABASE_UNAVAILABLE', 'Profile is unavailable right now.', 503); }
}

export async function PATCH(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const identity = await getChatGPTUser();
  if (!identity) return jsonError('AUTH_REQUIRED', 'Sign in to edit your profile.', 401);
  const body = await readJsonBody(request);
  if (body.response) return body.response;
  const parsed = profileInput.safeParse(body.data);
  if (!parsed.success) return jsonError('INVALID_PROFILE', parsed.error.issues[0]?.message ?? 'Check your profile details.', 422);
  const prisma = getPrisma();
  if (!prisma) return jsonError('DATABASE_UNAVAILABLE', 'Profile is unavailable right now.', 503);
  try {
    const user = await ensureAppUser(identity);
    const profile = await prisma.profile.update({ where: { userId: user.id }, data: { username: parsed.data.username, usernameNormalized: parsed.data.username, displayName: parsed.data.displayName, bio: parsed.data.bio || null } });
    return Response.json({ profile });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') return jsonError('USERNAME_TAKEN', 'That username is already taken.', 409);
    return jsonError('PROFILE_UPDATE_FAILED', 'Could not save your profile.', 422);
  }
}
