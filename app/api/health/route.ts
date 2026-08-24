import { getPrisma, isDatabaseConfigured } from '../../../lib/db/prisma';

export const runtime = 'edge';

export async function GET() {
  const configured = isDatabaseConfigured();
  let database = false;
  if (configured) {
    try {
      const prisma = getPrisma();
      if (prisma) {
        await prisma.$queryRaw`SELECT 1`;
        database = true;
      }
    } catch {
      database = false;
    }
  }
  const healthy = configured && database;
  return Response.json({ status: healthy ? 'ok' : 'degraded', services: { database, objectStorage: true }, timestamp: new Date().toISOString() }, { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
