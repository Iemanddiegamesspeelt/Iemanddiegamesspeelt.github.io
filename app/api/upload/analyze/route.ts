import { getChatGPTUser } from '../../../chatgpt-auth';
import { AccountAccessError, ensureAppUser } from '../../../../lib/auth/app-user';
import { analyzeReplay } from '../../../../lib/replay/analyze';
import { detectReplayFormat } from '../../../../lib/replay/conversion';
import { stableStringify } from '../../../../lib/replay/schema';
import { anonymousActorHash } from '../../../../lib/security/actor';
import { checkRateLimit, rateLimitHeaders } from '../../../../lib/security/rate-limit';
import { assertSameOrigin, jsonError, rejectOversizedRequest } from '../../../../lib/security/request';
import { validateUpload, UnsafeUploadError } from '../../../../lib/security/upload';
import { getObjectStorage, randomStorageKey } from '../../../../lib/storage/object-storage';

export const runtime = 'edge';

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const sizeError = rejectOversizedRequest(request);
  if (sizeError) return sizeError;
  const user = await getChatGPTUser();
  if (user) {
    try {
      await ensureAppUser(user);
    } catch (error) {
      if (error instanceof AccountAccessError) return jsonError('ACCOUNT_RESTRICTED', error.message, 403);
      return jsonError('DATABASE_UNAVAILABLE', 'Uploads are not available right now.', 503);
    }
  }
  const actor = user?.userId ?? await anonymousActorHash(request);
  const limit = await checkRateLimit(`analyze:${actor}`, { limit: user ? 30 : 12, windowMs: 60 * 60 * 1000 });
  if (!limit.allowed) {
    return Response.json({ error: { code: 'RATE_LIMITED', message: 'Too many files analyzed. Try again later.' } }, { status: 429, headers: rateLimitHeaders(limit) });
  }

  try {
    const body = await request.formData();
    const file = body.get('file');
    if (!(file instanceof File)) return jsonError('FILE_REQUIRED', 'Choose a replay file to continue.');
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
    const analysis = analyzeReplay(parsed.replay);
    let uploadId: string | null = null;

    if (user) {
      uploadId = crypto.randomUUID();
      const originalKey = randomStorageKey('quarantine', detection.format.extensions[0]);
      const canonicalKey = randomStorageKey('quarantine', '.macrohub.json');
      const manifestKey = `quarantine/manifests/${uploadId}.json`;
      const canonicalBytes = new TextEncoder().encode(stableStringify(parsed.replay));
      const storage = getObjectStorage();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const writtenKeys: string[] = [];
      try {
        await storage.put(originalKey, validated.bytes, {
          contentType: validated.contentType,
          metadata: { owner: user.userId, state: 'quarantine', format: detection.format.id, expiresAt },
        });
        writtenKeys.push(originalKey);
        await storage.put(canonicalKey, canonicalBytes, {
          contentType: 'application/vnd.macrohub.replay+json',
          metadata: { owner: user.userId, state: 'quarantine', schema: '1', expiresAt },
        });
        writtenKeys.push(canonicalKey);
        await storage.put(manifestKey, new TextEncoder().encode(JSON.stringify({
          uploadId,
          userId: user.userId,
          filename: validated.filename,
          originalKey,
          canonicalKey,
          formatId: detection.format.id,
          analysis,
          expiresAt,
        })), {
          contentType: 'application/json',
          metadata: { owner: user.userId, state: 'quarantine-manifest', expiresAt },
        });
      } catch (error) {
        await Promise.allSettled(writtenKeys.map((key) => storage.delete(key)));
        throw error;
      }
    }

    return Response.json({
      uploadId,
      filename: validated.filename,
      sourceFormat: {
        id: detection.format.id,
        name: detection.format.displayName,
        extension: detection.format.extensions[0],
      },
      detection: { confidence: detection.confidence, reason: detection.reason },
      analysis,
      diagnostics: parsed.diagnostics,
    }, { headers: rateLimitHeaders(limit) });
  } catch (error) {
    if (error instanceof UnsafeUploadError) return jsonError(error.code, error.message, 415);
    const message = error instanceof Error ? error.message : 'Replay analysis failed.';
    return jsonError('ANALYSIS_FAILED', message, 422);
  }
}
