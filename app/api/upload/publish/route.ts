import { z } from 'zod';
import { getChatGPTUser } from '../../../chatgpt-auth';
import { AccountAccessError, ensurePersistentUser } from '../../../../lib/auth/app-user';
import { findD1MacroByUploadId, publishD1Macro } from '../../../../lib/db/d1';
import { getPrisma } from '../../../../lib/db/prisma';
import { analyzeReplay } from '../../../../lib/replay/analyze';
import { getFormat } from '../../../../lib/replay/registry';
import { sha256Hex, validateCanonicalReplay } from '../../../../lib/replay/schema';
import { checkRateLimit, rateLimitHeaders } from '../../../../lib/security/rate-limit';
import { assertSameOrigin, jsonError, readJsonBody } from '../../../../lib/security/request';
import { getObjectStorage, randomStorageKey } from '../../../../lib/storage/object-storage';
import { getGeometryDashLevelProvider } from '../../../../lib/services/gd-level-provider';

export const runtime = 'edge';

const publishInput = z.object({
  uploadId: z.string().uuid(),
  levelId: z.string().trim().regex(/^\d{1,20}$/, 'Enter a valid numeric level ID.'),
  levelName: z.string().trim().min(1).max(120),
  creatorName: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().max(4000).optional().default(''),
}).strict();

const manifestSchema = z.object({
  uploadId: z.string().uuid(),
  userId: z.string().min(1),
  filename: z.string().min(1).max(180),
  originalKey: z.string().min(1),
  canonicalKey: z.string().min(1),
  formatId: z.string().min(1),
  expiresAt: z.string().datetime(),
  analysis: z.object({
    geometryDashVersion: z.string().nullable(),
    completionPercent: z.number().min(0).max(100).nullable(),
    rate: z.number().positive().nullable(),
    rateKind: z.enum(['tps', 'fps']),
    inputCount: z.number().int().nonnegative(),
    eventCount: z.number().int().nonnegative(),
    player1Inputs: z.number().int().nonnegative(),
    player2Inputs: z.number().int().nonnegative(),
    durationSeconds: z.number().nonnegative(),
    targets: z.array(z.object({
      id: z.string(),
      fidelity: z.enum(['lossless', 'compatible', 'metadata-loss']).nullable(),
      issues: z.array(z.object({ code: z.string() }).passthrough()),
    }).passthrough()),
  }).passthrough(),
}).passthrough();

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const identity = await getChatGPTUser();
  if (!identity) return jsonError('AUTH_REQUIRED', 'Sign in to publish a macro.', 401);
  const prisma = getPrisma();

  let input: z.infer<typeof publishInput>;
  const body = await readJsonBody(request);
  if (body.response) return body.response;
  try {
    input = publishInput.parse(body.data);
  } catch (error) {
    return jsonError('INVALID_PUBLISH_DETAILS', 'Check the level and macro details.', 422, error instanceof z.ZodError ? error.flatten() : undefined);
  }

  const storage = getObjectStorage();
  let appUser;
  try {
    appUser = await ensurePersistentUser(identity);
  } catch (error) {
    if (error instanceof AccountAccessError) return jsonError('ACCOUNT_RESTRICTED', error.message, 403);
    return jsonError('DATABASE_UNAVAILABLE', 'Publishing is not available right now.', 503);
  }
  const alreadyPublished = prisma
    ? await prisma.macro.findUnique({
        where: { sourceUploadId: input.uploadId },
        select: { id: true, uploaderId: true },
      })
    : await findD1MacroByUploadId(input.uploadId);
  if (alreadyPublished) {
    if (alreadyPublished.uploaderId !== appUser.id) return jsonError('UPLOAD_FORBIDDEN', 'This upload belongs to another account.', 403);
    return Response.json({ macro: { id: alreadyPublished.id } });
  }
  const publishLimit = await checkRateLimit(`publish:${appUser.id}`, { limit: 12, windowMs: 60 * 60 * 1000 });
  if (!publishLimit.allowed) return jsonError('RATE_LIMITED', 'Publish limit reached. Try again later.', 429);
  const manifestKey = `quarantine/manifests/${input.uploadId}.json`;
  const manifestObject = await storage.get(manifestKey);
  if (!manifestObject) return jsonError('UPLOAD_EXPIRED', 'This upload is no longer available. Add the file again.', 410);

  try {
    const manifest = manifestSchema.parse(JSON.parse(new TextDecoder().decode(manifestObject.bytes)));
    if (manifest.userId !== identity.userId || manifest.uploadId !== input.uploadId) {
      return jsonError('UPLOAD_FORBIDDEN', 'This upload belongs to another account.', 403);
    }
    if (Date.parse(manifest.expiresAt) <= Date.now()) {
      return jsonError('UPLOAD_EXPIRED', 'This upload has expired. Add the file again.', 410);
    }
    const format = getFormat(manifest.formatId);
    if (!format?.parser || format.status !== 'implemented') {
      return jsonError('FORMAT_UNAVAILABLE', 'The original file format is not available for publishing.', 422);
    }

    const [originalObject, canonicalObject] = await Promise.all([
      storage.get(manifest.originalKey),
      storage.get(manifest.canonicalKey),
    ]);
    if (!originalObject || !canonicalObject) return jsonError('UPLOAD_INCOMPLETE', 'The uploaded file is incomplete. Add it again.', 410);
    const replay = validateCanonicalReplay(JSON.parse(new TextDecoder().decode(canonicalObject.bytes)));
    const analysis = analyzeReplay(replay);
    const durationSeconds = analysis.durationSeconds;
    if (durationSeconds === null) throw new Error('Replay duration cannot be represented safely.');
    const durationMs = Math.round(durationSeconds * 1000);
    if (!Number.isSafeInteger(durationMs) || durationMs > 2_147_483_647) throw new Error('Replay duration is too large to publish.');
    if (analysis.rate !== null && analysis.rate > 9_999_999.999) throw new Error('Replay rate is too large to publish.');
    const [canonicalHash, originalHash] = await Promise.all([
      sha256Hex(canonicalObject.bytes),
      sha256Hex(originalObject.bytes),
    ]);
    if (replay.source.sha256 !== originalHash || replay.source.formatId !== manifest.formatId) {
      throw new Error('The staged replay no longer matches its original file.');
    }
    if (analysis.levelId && analysis.levelId !== input.levelId) {
      return jsonError('LEVEL_MISMATCH', 'The level ID does not match the replay file.', 422);
    }
    let trustedLevel = null;
    try {
      trustedLevel = await getGeometryDashLevelProvider().getLevel(input.levelId);
    } catch {
      // The uploader-provided fields remain usable when the replaceable metadata provider is offline.
    }
    const levelName = trustedLevel?.name ?? input.levelName;
    const creatorName = trustedLevel?.creator ?? input.creatorName;
    const difficulty = (trustedLevel?.difficulty.toUpperCase() ?? 'UNKNOWN') as 'AUTO' | 'EASY' | 'NORMAL' | 'HARD' | 'HARDER' | 'INSANE' | 'DEMON' | 'UNKNOWN';
    const demonDifficulty = trustedLevel?.demonDifficulty?.toUpperCase() as 'EASY' | 'MEDIUM' | 'HARD' | 'INSANE' | 'EXTREME' | undefined;
    const length = (trustedLevel?.length.toUpperCase() ?? 'UNKNOWN') as 'TINY' | 'SHORT' | 'MEDIUM' | 'LONG' | 'XL' | 'PLATFORMER' | 'UNKNOWN';
    const canonicalStorageKey = randomStorageKey('canonical', '.macrohub.json');
    const originalStorageKey = randomStorageKey('original', format.extensions[0]);
    const readyWrites = await Promise.allSettled([
      storage.put(canonicalStorageKey, canonicalObject.bytes, {
        contentType: 'application/vnd.macrohub.replay+json',
        metadata: { owner: appUser.id, state: 'ready', schema: '1' },
      }),
      storage.put(originalStorageKey, originalObject.bytes, {
        contentType: originalObject.contentType,
        metadata: { owner: appUser.id, state: 'ready', format: format.id },
      }),
    ]);
    const failedReadyWrite = readyWrites.find((result) => result.status === 'rejected');
    if (failedReadyWrite) {
      await Promise.allSettled([
        storage.delete(canonicalStorageKey),
        storage.delete(originalStorageKey),
      ]);
      throw failedReadyWrite.reason;
    }

    if (!prisma) {
      try {
        const macro = await publishD1Macro({
          uploadId: input.uploadId,
          userId: appUser.id,
          level: {
            id: input.levelId,
            name: levelName,
            creator: creatorName,
            difficulty,
            demonDifficulty: demonDifficulty ?? null,
            stars: trustedLevel?.stars ?? null,
            length,
            gdVersion: trustedLevel?.geometryDashVersion ?? null,
          },
          macro: {
            title: input.title,
            description: input.description,
            completion: analysis.completionPercent,
            rateKind: analysis.rateKind,
            rate: analysis.rate,
            inputCount: analysis.inputCount,
            durationSeconds,
            player1Inputs: analysis.player1Inputs,
            player2Inputs: analysis.player2Inputs,
            recordedGdVersion: analysis.geometryDashVersion,
            originalFormatId: format.id,
            canonicalHash,
            canonicalStorageKey,
            originalStorageKey,
            availableFormatIds: analysis.targets
              .filter((target) => target.fidelity && getFormat(target.id)?.exporter)
              .map((target) => target.id),
          },
        });
        await Promise.allSettled([
          storage.delete(manifest.originalKey),
          storage.delete(manifest.canonicalKey),
          storage.delete(manifestKey),
        ]);
        return Response.json({ macro }, { status: 201, headers: rateLimitHeaders(publishLimit) });
      } catch (error) {
        const published = await findD1MacroByUploadId(input.uploadId);
        if (published?.uploaderId === appUser.id) return Response.json({ macro: { id: published.id } });
        await Promise.allSettled([storage.delete(canonicalStorageKey), storage.delete(originalStorageKey)]);
        throw error;
      }
    }

    let macro: { id: string };
    try {
      macro = await prisma.$transaction(async (transaction) => {
        const formatRows = new Map<string, string>();
        for (const target of analysis.targets) {
          const definition = getFormat(target.id);
          if (!definition?.exporter || definition.status !== 'implemented') continue;
          const row = await transaction.macroFormat.upsert({
            where: { slug: definition.id },
            create: {
              slug: definition.id,
              name: definition.displayName,
              defaultExtension: definition.extensions[0],
              mimeTypes: [...definition.mediaTypes],
              implementationStatus: 'IMPLEMENTED',
              enabled: true,
            },
            update: {
              name: definition.displayName,
              defaultExtension: definition.extensions[0],
              mimeTypes: [...definition.mediaTypes],
              implementationStatus: 'IMPLEMENTED',
            },
          });
          if (row.enabled) formatRows.set(definition.id, row.id);
        }
        if (!formatRows.has(format.id)) {
          const row = await transaction.macroFormat.upsert({
            where: { slug: format.id },
            create: {
              slug: format.id,
              name: format.displayName,
              defaultExtension: format.extensions[0],
              mimeTypes: [...format.mediaTypes],
              implementationStatus: 'IMPLEMENTED',
              enabled: true,
            },
            update: { implementationStatus: 'IMPLEMENTED' },
          });
          if (!row.enabled) throw new Error('The original file format is not enabled for publishing.');
          formatRows.set(format.id, row.id);
        }
        const level = await transaction.level.upsert({
          where: { providerKey_externalId: { providerKey: 'geometry-dash', externalId: input.levelId } },
          create: {
            providerKey: 'geometry-dash',
            externalId: input.levelId,
            name: levelName,
            nameNormalized: levelName.toLowerCase(),
            creatorName,
            creatorNormalized: creatorName.toLowerCase(),
            difficulty,
            demonDifficulty,
            length,
            stars: trustedLevel?.stars,
            gdVersion: trustedLevel?.geometryDashVersion,
            metadata: trustedLevel ? { source: trustedLevel.source } : { suppliedByUploader: true },
            metadataFetchedAt: trustedLevel ? new Date(trustedLevel.fetchedAt) : null,
          },
          update: trustedLevel ? {
            name: levelName,
            nameNormalized: levelName.toLowerCase(),
            creatorName,
            creatorNormalized: creatorName.toLowerCase(),
            difficulty,
            demonDifficulty,
            length,
            stars: trustedLevel.stars,
            gdVersion: trustedLevel.geometryDashVersion,
            metadata: { source: trustedLevel.source },
            metadataFetchedAt: new Date(trustedLevel.fetchedAt),
          } : {},
        });
        const created = await transaction.macro.create({
          data: {
            levelId: level.id,
            uploaderId: appUser.id,
            originalFormatId: formatRows.get(format.id)!,
            sourceUploadId: input.uploadId,
            title: input.title,
            titleNormalized: input.title.toLowerCase(),
            description: input.description || null,
            completionBasisPoints: analysis.completionPercent === null ? null : Math.round(analysis.completionPercent * 100),
            tps: analysis.rateKind === 'tps' ? analysis.rate : null,
            fps: analysis.rateKind === 'fps' ? analysis.rate : null,
            inputCount: analysis.inputCount,
            durationMs,
            player1InputCount: analysis.player1Inputs,
            player2InputCount: analysis.player2Inputs,
            recordedGdVersion: analysis.geometryDashVersion,
            publicationState: 'PUBLISHED',
            publishedAt: new Date(),
            canonicalHash,
            canonicalReplay: {
              create: {
                schemaVersion: replay.schemaVersion,
                storageKey: canonicalStorageKey,
                sha256: canonicalHash,
                byteSize: canonicalObject.bytes.byteLength,
                eventCount: replay.events.length,
                extensions: { schema: replay.schema },
              },
            },
            files: {
              create: {
                formatId: formatRows.get(format.id)!,
                kind: 'ORIGINAL',
                storageKey: originalStorageKey,
                sha256: originalHash,
                byteSize: originalObject.bytes.byteLength,
                mimeType: originalObject.contentType,
                extension: format.extensions[0],
                state: 'READY',
              },
            },
            conversionCapabilities: {
              create: analysis.targets.flatMap((target) => {
                const targetFormat = getFormat(target.id);
                const formatId = formatRows.get(target.id);
                if (!targetFormat?.exporter || !formatId || !target.fidelity) return [];
                return [{
                  formatId,
                  quality: target.fidelity === 'lossless' ? 'LOSSLESS' as const : target.fidelity === 'metadata-loss' ? 'OPTIONAL_METADATA_LOSS' as const : 'COMPATIBLE' as const,
                  warningCodes: target.issues.map((issue) => issue.code),
                  canonicalHash,
                  exporterVersion: targetFormat.exporter.implementationVersion,
                }];
              }),
            },
          },
        });
        await transaction.level.update({ where: { id: level.id }, data: { macroCount: { increment: 1 } } });
        await transaction.profile.update({ where: { userId: appUser.id }, data: { macroCount: { increment: 1 } } });
        return created;
      });
    } catch (error) {
      let reconciliationCompleted = false;
      let published: {
        id: string;
        uploaderId: string;
        canonicalReplay: { storageKey: string } | null;
        files: Array<{ storageKey: string }>;
      } | null = null;
      try {
        published = await prisma.macro.findUnique({
          where: { sourceUploadId: input.uploadId },
          select: {
            id: true,
            uploaderId: true,
            canonicalReplay: { select: { storageKey: true } },
            files: { where: { kind: 'ORIGINAL', state: 'READY' }, select: { storageKey: true } },
          },
        });
        reconciliationCompleted = true;
      } catch {
        // Preserve ready objects when the database outcome cannot be determined.
      }
      if (published?.uploaderId === appUser.id) {
        const committedObjectsMatch = published.canonicalReplay?.storageKey === canonicalStorageKey
          && published.files.some((file) => file.storageKey === originalStorageKey);
        if (!committedObjectsMatch) {
          await Promise.allSettled([storage.delete(canonicalStorageKey), storage.delete(originalStorageKey)]);
        }
        macro = { id: published.id };
      } else {
        if (reconciliationCompleted) {
          await Promise.allSettled([storage.delete(canonicalStorageKey), storage.delete(originalStorageKey)]);
        }
        throw error;
      }
    }
    await Promise.allSettled([
      storage.delete(manifest.originalKey),
      storage.delete(manifest.canonicalKey),
      storage.delete(manifestKey),
    ]);
    return Response.json({ macro: { id: macro.id } }, { status: 201, headers: rateLimitHeaders(publishLimit) });
  } catch (error) {
    const published = prisma
      ? await prisma.macro.findUnique({
          where: { sourceUploadId: input.uploadId },
          select: { id: true, uploaderId: true },
        })
      : await findD1MacroByUploadId(input.uploadId);
    if (published?.uploaderId === appUser.id) return Response.json({ macro: { id: published.id } });
    const publicMessages = new Set([
      'Replay duration cannot be represented safely.',
      'Replay duration is too large to publish.',
      'Replay rate is too large to publish.',
      'The staged replay no longer matches its original file.',
      'The original file format is not enabled for publishing.',
    ]);
    const message = error instanceof Error && publicMessages.has(error.message) ? error.message : 'Could not publish the macro.';
    return jsonError('PUBLISH_FAILED', message, 422);
  }
}
