import { convertReplay, detectReplayFormat } from '../../../lib/replay/conversion';
import { anonymousActorHash } from '../../../lib/security/actor';
import { checkRateLimit, rateLimitHeaders } from '../../../lib/security/rate-limit';
import { assertSameOrigin, jsonError, rejectOversizedRequest } from '../../../lib/security/request';
import { validateUpload, UnsafeUploadError } from '../../../lib/security/upload';

export const runtime = 'edge';

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const sizeError = rejectOversizedRequest(request);
  if (sizeError) return sizeError;
  const actor = await anonymousActorHash(request);
  const limit = await checkRateLimit(`convert:${actor}`, { limit: 20, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return jsonError('RATE_LIMITED', 'Conversion limit reached. Try again later.', 429);

  try {
    const body = await request.formData();
    const file = body.get('file');
    const targetFormatId = body.get('targetFormatId');
    const replayToolId = body.get('replayToolId');
    const acknowledgementValue = body.get('acknowledgedIssueCodes');
    if (!(file instanceof File)) return jsonError('FILE_REQUIRED', 'Choose a replay file.');
    if (typeof targetFormatId !== 'string') return jsonError('TARGET_REQUIRED', 'Choose a target format.');

    const validated = await validateUpload(file);
    const detection = await detectReplayFormat({ bytes: validated.bytes, filename: validated.filename, mediaType: validated.contentType });
    if (!detection.format?.parser) return jsonError('PARSER_NOT_IMPLEMENTED', detection.reason, 422);
    const parsed = await detection.format.parser.parse({ bytes: validated.bytes, filename: validated.filename, mediaType: validated.contentType });
    const acknowledgedIssueCodes = typeof acknowledgementValue === 'string'
      ? JSON.parse(acknowledgementValue) as string[]
      : [];
    const result = await convertReplay(parsed.replay, targetFormatId, {
      replayToolId: typeof replayToolId === 'string' && replayToolId ? replayToolId : null,
      acknowledgedIssueCodes,
    });
    const dispositionName = result.artifact.filename.replace(/[^a-z0-9._-]/gi, '-');
    return new Response(result.artifact.bytes as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': result.artifact.mediaType,
        'Content-Disposition': `attachment; filename="${dispositionName}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'X-MacroHub-Fidelity': result.assessment.decision === 'allowed' ? result.assessment.fidelity : 'blocked',
        ...rateLimitHeaders(limit),
      },
    });
  } catch (error) {
    if (error instanceof UnsafeUploadError) return jsonError(error.code, error.message, 415);
    const details = error && typeof error === 'object' && 'issues' in error ? (error as { issues: unknown }).issues : undefined;
    return jsonError('CONVERSION_BLOCKED', error instanceof Error ? error.message : 'Conversion failed.', 422, details);
  }
}
