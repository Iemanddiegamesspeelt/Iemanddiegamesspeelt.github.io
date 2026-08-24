import { z } from 'zod';
import { getChatGPTUser } from '../../../../chatgpt-auth';
import { ensureAppUser } from '../../../../../lib/auth/app-user';
import { getPrisma } from '../../../../../lib/db/prisma';
import { assertSameOrigin, jsonError, readJsonBody } from '../../../../../lib/security/request';

export const runtime = 'edge';
const reportSchema = z.object({
  verdict: z.enum(['working', 'broken', 'outdated', 'malicious', 'other']),
  details: z.string().trim().max(1000).optional(),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const identity = await getChatGPTUser();
  if (!identity) return jsonError('AUTH_REQUIRED', 'Sign in to report a macro.', 401);
  const prisma = getPrisma();
  if (!prisma) return jsonError('DATABASE_UNAVAILABLE', 'Reports are unavailable right now.', 503);
  const body = await readJsonBody(request);
  if (body.response) return body.response;
  const parsed = reportSchema.safeParse(body.data);
  if (!parsed.success) return jsonError('INVALID_REPORT', 'Choose a valid report type.', 422);
  const { id } = await params;
  const [user, macro] = await Promise.all([
    ensureAppUser(identity),
    prisma.macro.findFirst({ where: { id, publicationState: 'PUBLISHED' }, select: { id: true } }),
  ]);
  if (!macro) return jsonError('MACRO_NOT_FOUND', 'Macro not found.', 404);
  const verdict = parsed.data.verdict.toUpperCase() as 'WORKING' | 'BROKEN' | 'OUTDATED' | 'MALICIOUS' | 'OTHER';
  const report = await prisma.macroReport.upsert({
    where: { macroId_reporterId: { macroId: id, reporterId: user.id } },
    create: { macroId: id, reporterId: user.id, verdict, details: parsed.data.details },
    update: { verdict, details: parsed.data.details, state: 'OPEN', reviewedAt: null, reviewedById: null },
  });
  return Response.json({ report: { id: report.id, verdict: parsed.data.verdict } });
}
