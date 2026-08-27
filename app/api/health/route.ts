import { getPrisma, isDatabaseConfigured } from '../../../lib/db/prisma';
import { getD1 } from '../../../lib/db/d1';

export const runtime = 'edge';

export async function GET() {
  const configured = isDatabaseConfigured() || Boolean(getD1());
  let database = false;
  if (isDatabaseConfigured()) {
    try {
      const prisma = getPrisma();
      if (prisma) {
        await prisma.$queryRaw`SELECT 1`;
        database = true;
      }
    } catch {
      database = false;
    }
  } else {
    try {
      const d1 = getD1();
      if (d1) {
        const table = await d1.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mh_macros'").first();
        database = Boolean(table);
      }
    } catch {
      database = false;
    }
  }
  const healthy = configured && database;
  return Response.json({ status: healthy ? 'ok' : 'degraded', services: { database, objectStorage: true }, timestamp: new Date().toISOString() }, { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
