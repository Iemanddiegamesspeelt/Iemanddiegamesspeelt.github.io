import JSZip from 'jszip';
import { convertReplay, detectReplayFormat, listAvailableExports } from '../../../../lib/replay/conversion';
import { anonymousActorHash } from '../../../../lib/security/actor';
import { checkRateLimit } from '../../../../lib/security/rate-limit';
import { assertSameOrigin, jsonError, rejectOversizedRequest } from '../../../../lib/security/request';
import { validateUpload, UnsafeUploadError } from '../../../../lib/security/upload';

export const runtime = 'edge';

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const sizeError = rejectOversizedRequest(request);
  if (sizeError) return sizeError;
  const actor = await anonymousActorHash(request);
  const limit = await checkRateLimit(`convert-all:${actor}`, { limit: 8, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) return jsonError('RATE_LIMITED', 'ZIP conversion limit reached. Try again later.', 429);

  try {
    const body = await request.formData();
    const file = body.get('file');
    const replayToolId = body.get('replayToolId');
    const acknowledgementValue = body.get('acknowledgedIssueCodes');
    if (!(file instanceof File)) return jsonError('FILE_REQUIRED', 'Choose a replay file.');
    const acknowledgedIssueCodes = typeof acknowledgementValue === 'string'
      ? JSON.parse(acknowledgementValue) as string[]
      : [];

    const validated = await validateUpload(file);
    const detection = await detectReplayFormat({ bytes: validated.bytes, filename: validated.filename, mediaType: validated.contentType });
    if (!detection.format?.parser) return jsonError('PARSER_NOT_IMPLEMENTED', detection.reason, 422);
    const parsed = await detection.format.parser.parse({ bytes: validated.bytes, filename: validated.filename, mediaType: validated.contentType });
    const available = listAvailableExports(
      parsed.replay,
      typeof replayToolId === 'string' && replayToolId ? replayToolId : null,
    );
    const requiredAcknowledgements = [...new Set(available.flatMap((target) =>
      target.assessment.decision === 'allowed'
        ? target.assessment.issues.filter((issue) => issue.requiresAcknowledgement).map((issue) => issue.code)
        : [],
    ))];
    const missingAcknowledgements = requiredAcknowledgements.filter((code) => !acknowledgedIssueCodes.includes(code));
    if (missingAcknowledgements.length) {
      return jsonError('ACKNOWLEDGEMENT_REQUIRED', 'Review and accept the conversion notes before downloading the ZIP.', 422, missingAcknowledgements);
    }
    const zip = new JSZip();
    for (const target of available) {
      const result = await convertReplay(parsed.replay, target.format.id, {
        replayToolId: typeof replayToolId === 'string' && replayToolId ? replayToolId : null,
        acknowledgedIssueCodes,
      });
      const safeName = result.artifact.filename.replace(/[^a-z0-9._-]/gi, '-');
      zip.file(`${target.format.id}-${safeName}`, result.artifact.bytes);
    }
    if (!available.length) return jsonError('NO_SAFE_EXPORTS', 'No target formats can be safely generated for this replay.', 422);
    zip.file('README.txt', `MacroHub generated ${available.length} replay format${available.length === 1 ? '' : 's'}.\nCheck that the selected format is supported by your installed replay tool version.\n`);
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return new Response(bytes as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="macrohub-compatible-formats.zip"',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof UnsafeUploadError) return jsonError(error.code, error.message, 415);
    return jsonError('ZIP_CONVERSION_FAILED', error instanceof Error ? error.message : 'ZIP conversion failed.', 422);
  }
}
