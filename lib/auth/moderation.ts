import 'server-only';
import { getChatGPTUser } from '../../app/chatgpt-auth';
import { findAppUser } from './app-user';
import { getPrisma } from '../db/prisma';
import { assertSameOrigin, jsonError } from '../security/request';

export async function requireModeratorApi(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return { response: originError } as const;
  const identity = await getChatGPTUser();
  if (!identity) return { response: jsonError('AUTH_REQUIRED', 'Sign in to continue.', 401) } as const;
  const prisma = getPrisma();
  if (!prisma) return { response: jsonError('DATABASE_UNAVAILABLE', 'Moderation is unavailable right now.', 503) } as const;
  const user = await findAppUser(identity);
  if (!user || (user.role !== 'MODERATOR' && user.role !== 'ADMIN')) return { response: jsonError('MODERATOR_REQUIRED', 'Moderator access required.', 403) } as const;
  return { response: null, prisma, user } as const;
}
