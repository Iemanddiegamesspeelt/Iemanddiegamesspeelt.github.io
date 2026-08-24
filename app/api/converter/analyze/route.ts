import { analyzeReplay } from '../../../../lib/replay/analyze';
import { detectReplayFormat } from '../../../../lib/replay/conversion';
import { anonymousActorHash } from '../../../../lib/security/actor';
import { checkRateLimit, rateLimitHeaders } from '../../../../lib/security/rate-limit';
import { assertSameOrigin, jsonError, rejectOversizedRequest } from '../../../../lib/security/request';
import { validateUpload, UnsafeUploadError } from '../../../../lib/security/upload';

export const runtime = 'edge';

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const sizeError = rejectOversizedRequest(request);
  if (sizeError) return sizeError;
  const actor = await anonymousActorHash(request);
  const limit = await checkRateLimit(`converter-analyze:${actor}`, { limit: 20, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) {
    return Response.json(
      { error: { code: 'RATE_LIMITED', message: 'Analysis limit reached. Try again later.' } },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }

  try {
    const body = await request.formData();
    const file = body.get('file');
    if (!(file instanceof File)) return jsonError('FILE_REQUIRED', 'Choose a replay file.');
    const validated = await validateUpload(file);
    const detection = await detectReplayFormat({
      bytes: validated.bytes,
      filename: validated.filename,
      mediaType: validated.contentType,
    });
    if (!detection.format?.parser) return jsonError('PARSER_NOT_IMPLEMENTED', detection.reason, 422);
    const parsed = await detection.format.parser.parse({
      bytes: validated.bytes,
      filename: validated.filename,
      mediaType: validated.contentType,
    });
    return Response.json({
      uploadId: null,
      filename: validated.filename,
      sourceFormat: {
        id: detection.format.id,
        name: detection.format.displayName,
        extension: detection.format.extensions[0],
      },
      detection: { confidence: detection.confidence, reason: detection.reason },
      analysis: analyzeReplay(parsed.replay),
      diagnostics: parsed.diagnostics,
    }, { headers: { ...rateLimitHeaders(limit), 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof UnsafeUploadError) return jsonError(error.code, error.message, 415);
    return jsonError('ANALYSIS_FAILED', error instanceof Error ? error.message : 'Replay analysis failed.', 422);
  }
}
