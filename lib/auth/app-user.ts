import 'server-only';
import type { Prisma, Profile, User } from '@prisma/client';
import { getPrisma } from '../db/prisma';
import { sha256Hex } from '../replay/schema';

export interface AuthIdentity {
  userId: string;
  email: string;
  displayName: string;
  fullName: string | null;
}

export type AppUser = User & { profile: Profile | null };

export class AccountAccessError extends Error {
  constructor() {
    super('This account cannot perform that action.');
    this.name = 'AccountAccessError';
  }
}

function accountCanAct(user: User): boolean {
  return user.state === 'ACTIVE' && (!user.bannedUntil || user.bannedUntil.getTime() <= Date.now());
}

function usernameBase(identity: AuthIdentity) {
  const local = identity.email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') ?? '';
  return local.length >= 3 ? local.slice(0, 22) : 'player';
}

export async function ensureAppUser(identity: AuthIdentity): Promise<AppUser> {
  const prisma = getPrisma();
  if (!prisma) throw new Error('Database is not configured.');
  const existing = await prisma.user.findUnique({
    where: { authProvider_authSubject: { authProvider: 'chatgpt', authSubject: identity.userId } },
    include: { profile: true },
  });
  if (existing) {
    if (!accountCanAct(existing)) throw new AccountAccessError();
    const suffix = (await sha256Hex(new TextEncoder().encode(identity.userId))).slice(0, 7);
    const fallbackUsername = `${usernameBase(identity)}-${suffix}`.slice(0, 32);
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        email: identity.email,
        emailNormalized: identity.email.toLowerCase(),
        profile: existing.profile
          ? { update: { displayName: existing.profile.displayName ?? identity.fullName ?? identity.displayName } }
          : {
              create: {
                username: fallbackUsername,
                usernameNormalized: fallbackUsername,
                displayName: identity.fullName ?? identity.displayName,
              },
            },
      },
      include: { profile: true },
    });
  }

  const suffix = (await sha256Hex(new TextEncoder().encode(identity.userId))).slice(0, 7);
  const username = `${usernameBase(identity)}-${suffix}`.slice(0, 32);
  const data: Prisma.UserCreateInput = {
    authProvider: 'chatgpt',
    authSubject: identity.userId,
    email: identity.email,
    emailNormalized: identity.email.toLowerCase(),
    profile: {
      create: {
        username,
        usernameNormalized: username,
        displayName: identity.fullName ?? identity.displayName,
      },
    },
  };
  return prisma.user.create({ data, include: { profile: true } });
}

export async function findAppUser(identity: AuthIdentity): Promise<AppUser | null> {
  const prisma = getPrisma();
  if (!prisma) return null;
  const user = await prisma.user.findUnique({
    where: { authProvider_authSubject: { authProvider: 'chatgpt', authSubject: identity.userId } },
    include: { profile: true },
  });
  return user && accountCanAct(user) ? user : null;
}
