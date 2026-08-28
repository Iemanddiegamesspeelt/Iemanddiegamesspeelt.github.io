import type { MacroExporter, MacroParser } from '../interfaces';
import { ReplayValidationError, sha256Hex, stableStringify, validateCanonicalReplay } from '../schema';
import type { CanonicalReplayV1, ConversionIssue } from '../types';

const VERSION = '1.1.0';
const MAX_BYTES = 10 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
const probeDecoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function blobFromBytes(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer]);
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = blobFromBytes(bytes).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = blobFromBytes(bytes).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new ReplayValidationError(['The decompressed MacroHub replay exceeds the 10 MiB limit']);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ReplayValidationError) throw error;
    throw new ReplayValidationError(['The MacroHub gzip container is invalid']);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function decodedPayload(bytes: Uint8Array): Promise<Uint8Array> {
  return isGzip(bytes) ? gunzip(bytes) : bytes;
}

function safeBaseName(filename: string): string {
  return filename
    .replace(/\.macrohub$/i, '')
    .replace(/\.macrohub\.json$/i, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'replay';
}

export const macroHubJsonParser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) {
    if (input.bytes.byteLength > MAX_BYTES) return { confidence: 'none', reason: 'File exceeds the 10 MiB limit' };
    let payload: Uint8Array;
    try {
      payload = await decodedPayload(input.bytes);
    } catch {
      return /\.macrohub$/i.test(input.filename)
        ? { confidence: 'possible', reason: 'MacroHub extension found but the gzip container is invalid' }
        : { confidence: 'none', reason: 'No valid MacroHub container found' };
    }
    const prefix = probeDecoder.decode(payload.slice(0, Math.min(payload.length, 512)));
    if (prefix.includes('"schema":"macrohub/replay"') || prefix.includes('"schema": "macrohub/replay"')) {
      return { confidence: 'exact', reason: isGzip(input.bytes) ? 'Compressed MacroHub schema marker found' : 'MacroHub schema marker found' };
    }
    if (/\.macrohub(?:\.json)?$/i.test(input.filename)) {
      return { confidence: 'possible', reason: 'MacroHub extension found but schema marker was not visible' };
    }
    return { confidence: 'none', reason: 'No MacroHub schema marker' };
  },
  async parse(input) {
    if (input.bytes.byteLength > MAX_BYTES) throw new ReplayValidationError(['File exceeds the 10 MiB limit']);
    let raw: unknown;
    try {
      raw = JSON.parse(decoder.decode(await decodedPayload(input.bytes)));
    } catch (error) {
      if (error instanceof ReplayValidationError) throw error;
      throw new ReplayValidationError(['The file is not valid UTF-8 JSON']);
    }
    const replay = validateCanonicalReplay(raw);
    const actualHash = await sha256Hex(input.bytes);
    const diagnostics: ConversionIssue[] = [];
    if (replay.source.sha256 !== actualHash) {
      diagnostics.push({
        code: 'SOURCE_HASH_IS_PROVENANCE',
        severity: 'info',
        category: 'metadata-loss',
        message: 'The embedded source hash describes the original imported file, not this canonical container.',
      });
    }
    return { replay, diagnostics };
  },
};

export const macroHubJsonExporter: MacroExporter = {
  implementationVersion: VERSION,
  assess(replay) {
    try {
      validateCanonicalReplay(replay);
      if (encoder.encode(`${stableStringify(replay)}\n`).byteLength > MAX_BYTES) {
        return {
          decision: 'blocked',
          issues: [{
            code: 'MACROHUB_JSON_TOO_LARGE',
            severity: 'error',
            category: 'unsupported-format',
            message: 'The canonical JSON output would exceed 10 MiB.',
          }],
        };
      }
      return { decision: 'allowed', fidelity: 'lossless', issues: [] };
    } catch (error) {
      return {
        decision: 'blocked',
        issues: [{
          code: 'INVALID_CANONICAL_REPLAY',
          severity: 'error',
          category: 'invalid-replay',
          message: error instanceof Error ? error.message : 'Canonical replay is invalid',
        }],
      };
    }
  },
  async export(replay) {
    validateCanonicalReplay(replay);
    const levelName = replay.level.name?.value ?? replay.level.id?.value ?? 'replay';
    const filename = `${safeBaseName(levelName)}.macrohub`;
    const bytes = encoder.encode(`${stableStringify(replay)}\n`);
    return {
      bytes: await gzip(bytes),
      filename,
      mediaType: 'application/vnd.macrohub.replay+gzip',
      extension: '.macrohub',
    };
  },
};

export function makeMacroHubReplay(input: Omit<CanonicalReplayV1, 'schema' | 'schemaVersion'>): CanonicalReplayV1 {
  return validateCanonicalReplay({ schema: 'macrohub/replay', schemaVersion: 1, ...input });
}

