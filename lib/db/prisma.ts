import 'server-only';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

declare global {
  var macroHubPrisma: PrismaClient | undefined;
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPrisma(): PrismaClient | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  if (globalThis.macroHubPrisma) return globalThis.macroHubPrisma;
  const adapter = new PrismaNeon({ connectionString });
  const client = new PrismaClient({ adapter, log: ['error'] });
  globalThis.macroHubPrisma = client;
  return client;
}

