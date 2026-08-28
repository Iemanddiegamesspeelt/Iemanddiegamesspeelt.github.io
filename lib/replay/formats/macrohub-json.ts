import { decode as decodeMessagePack, encode as encodeMessagePack } from '@msgpack/msgpack';
import type { MacroExporter, MacroParser } from '../interfaces';
import { ReplayValidationError, sha256Hex, validateCanonicalReplay } from '../schema';
import type {
  CanonicalReplayV1,
  ConversionIssue,
  Fact,
  JsonValue,
  Provenance,
  ReplayControl,
  ReplayEvent,
  UIntString,
} from '../types';

const VERSION = '2.0.0';
const MAX_BYTES = 10 * 1024 * 1024;
const MAGIC = Uint8Array.of(0x4d, 0x48, 0x55, 0x42); // MHUB
const CONTAINER_VERSION = 2;
const CODEC_MSGPACK_GZIP = 1;
const HEADER_BYTES = 6;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

const provenanceCodes: Record<Provenance['kind'], number> = {
  'source-file': 0,
  user: 1,
  'level-provider': 2,
  derived: 3,
};
const provenanceKinds = ['source-file', 'user', 'level-provider', 'derived'] as const;

function hasMagic(bytes: Uint8Array): boolean {
  return bytes.length >= HEADER_BYTES && MAGIC.every((byte, index) => bytes[index] === byte);
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
    throw new ReplayValidationError(['The MacroHub compressed payload is invalid']);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function wrapContainer(compressed: Uint8Array): Uint8Array {
  const output = new Uint8Array(HEADER_BYTES + compressed.byteLength);
  output.set(MAGIC, 0);
  output[4] = CONTAINER_VERSION;
  output[5] = CODEC_MSGPACK_GZIP;
  output.set(compressed, HEADER_BYTES);
  return output;
}

function compressedPayload(container: Uint8Array): Uint8Array {
  if (!hasMagic(container)) throw new ReplayValidationError(['The file is not a MacroHub replay']);
  if (container[4] !== CONTAINER_VERSION) throw new ReplayValidationError([`MacroHub container version ${container[4]} is not supported`]);
  if (container[5] !== CODEC_MSGPACK_GZIP) throw new ReplayValidationError(['The MacroHub compression codec is not supported']);
  if (container.byteLength === HEADER_BYTES) throw new ReplayValidationError(['The MacroHub replay payload is empty']);
  return container.slice(HEADER_BYTES);
}

function packUInt(value: UIntString): number | string {
  const integer = BigInt(value);
  return integer <= MAX_SAFE_BIGINT ? Number(integer) : value;
}

function unpackUInt(value: unknown, label: string): UIntString {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value) as UIntString;
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) && value.length <= 32) return value as UIntString;
  throw new ReplayValidationError([`${label} is not a valid unsigned integer`]);
}

function row(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new ReplayValidationError([`${label} is malformed`]);
  return value;
}

function packFact<T>(fact: Fact<T> | undefined): [T, number, string | null] | null {
  return fact ? [fact.value, provenanceCodes[fact.provenance.kind], fact.provenance.detail ?? null] : null;
}

function unpackFact<T>(value: unknown, label: string): Fact<T> | undefined {
  if (value === null) return undefined;
  const packed = row(value, label);
  const kind = provenanceKinds[Number(packed[1])];
  if (!kind) throw new ReplayValidationError([`${label} has invalid provenance`]);
  if (packed[2] !== null && typeof packed[2] !== 'string') throw new ReplayValidationError([`${label} has invalid provenance detail`]);
  return {
    value: packed[0] as T,
    provenance: { kind, ...(typeof packed[2] === 'string' ? { detail: packed[2] } : {}) },
  };
}

function packControl(control: ReplayControl): number | [number, string, string] {
  if (control.kind === 'jump') return 0;
  if (control.kind === 'left') return 1;
  if (control.kind === 'right') return 2;
  if (control.kind === 'opaque') return [3, control.namespace, control.code];
  throw new ReplayValidationError(['Replay control is not supported']);
}

function unpackControl(value: unknown): ReplayControl {
  if (value === 0) return { kind: 'jump' };
  if (value === 1) return { kind: 'left' };
  if (value === 2) return { kind: 'right' };
  const packed = row(value, 'Replay control');
  if (packed[0] !== 3 || typeof packed[1] !== 'string' || typeof packed[2] !== 'string') {
    throw new ReplayValidationError(['Replay control is malformed']);
  }
  return { kind: 'opaque', namespace: packed[1], code: packed[2] };
}

function packEvents(events: ReplayEvent[]): unknown[][] {
  let previousTick = 0n;
  return events.map((event) => {
    const tick = BigInt(event.tick);
    const delta = packUInt(String(tick - previousTick) as UIntString);
    previousTick = tick;
    if (event.kind === 'input') return [0, delta, event.order, event.player, packControl(event.control), event.state === 'press' ? 1 : 0];
    if (event.kind === 'player-state') return [1, delta, event.order, event.player, event.x ?? null, event.y ?? null, event.rotation ?? null];
    if (event.kind === 'death') return [2, delta, event.order, event.player ?? 0];
    if (event.kind === 'checkpoint') {
      const action = event.action === 'create' ? 0 : event.action === 'activate' ? 1 : 2;
      return [3, delta, event.order, action, event.checkpointId ?? null, event.player ?? 0];
    }
    return [4, delta, event.order, event.namespace, event.eventType, event.critical ? 1 : 0, event.payload];
  });
}

function optionalFiniteNumber(value: unknown, label: string): number | undefined {
  if (value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ReplayValidationError([`${label} is invalid`]);
  return value;
}

function unpackEvents(value: unknown): ReplayEvent[] {
  const packedEvents = row(value, 'Replay events');
  if (packedEvents.length > 250_000) throw new ReplayValidationError(['Replay contains too many events']);
  let tick = 0n;
  return packedEvents.map((value, index) => {
    const packed = row(value, `Replay event ${index}`);
    tick += BigInt(unpackUInt(packed[1], `Replay event ${index} tick delta`));
    const eventTick = String(tick) as UIntString;
    const order = Number(packed[2]);
    const player = packed[3] === 1 || packed[3] === 2 ? packed[3] : undefined;
    if (packed[0] === 0) {
      if (!player || (packed[5] !== 0 && packed[5] !== 1)) throw new ReplayValidationError([`Replay input ${index} is malformed`]);
      return { tick: eventTick, order, kind: 'input', player, control: unpackControl(packed[4]), state: packed[5] === 1 ? 'press' : 'release' };
    }
    if (packed[0] === 1) {
      if (!player) throw new ReplayValidationError([`Player state ${index} is malformed`]);
      const x = optionalFiniteNumber(packed[4], `Player state ${index} x`);
      const y = optionalFiniteNumber(packed[5], `Player state ${index} y`);
      const rotation = optionalFiniteNumber(packed[6], `Player state ${index} rotation`);
      return { tick: eventTick, order, kind: 'player-state', player, ...(x === undefined ? {} : { x }), ...(y === undefined ? {} : { y }), ...(rotation === undefined ? {} : { rotation }) };
    }
    if (packed[0] === 2) {
      if (packed[3] !== 0 && !player) throw new ReplayValidationError([`Death event ${index} is malformed`]);
      return { tick: eventTick, order, kind: 'death', ...(player ? { player } : {}) };
    }
    if (packed[0] === 3) {
      const action = packed[3] === 0 ? 'create' : packed[3] === 1 ? 'activate' : packed[3] === 2 ? 'remove' : null;
      if (!action || (packed[4] !== null && typeof packed[4] !== 'string') || (packed[5] !== 0 && packed[5] !== 1 && packed[5] !== 2)) {
        throw new ReplayValidationError([`Checkpoint event ${index} is malformed`]);
      }
      return { tick: eventTick, order, kind: 'checkpoint', action, ...(typeof packed[4] === 'string' ? { checkpointId: packed[4] } : {}), ...(packed[5] ? { player: packed[5] as 1 | 2 } : {}) };
    }
    if (packed[0] === 4) {
      if (typeof packed[3] !== 'string' || typeof packed[4] !== 'string' || (packed[5] !== 0 && packed[5] !== 1)) {
        throw new ReplayValidationError([`Extension event ${index} is malformed`]);
      }
      return { tick: eventTick, order, kind: 'extension', namespace: packed[3], eventType: packed[4], critical: packed[5] === 1, payload: packed[6] as JsonValue };
    }
    throw new ReplayValidationError([`Replay event ${index} uses an unknown event type`]);
  });
}

function packReplay(replay: CanonicalReplayV1): unknown[] {
  const declaredRate = replay.recording.declaredRate;
  return [
    1,
    [replay.source.formatId, replay.source.parserVersion, replay.source.sha256],
    [packUInt(replay.clock.ticksPerSecond.numerator), packUInt(replay.clock.ticksPerSecond.denominator)],
    [packFact(replay.level.id), packFact(replay.level.name)],
    [
      packFact(replay.recording.replayVersion),
      packFact(replay.recording.geometryDashVersion),
      declaredRate ? [declaredRate.value.kind === 'tps' ? 0 : 1, packUInt(declaredRate.value.value.numerator), packUInt(declaredRate.value.value.denominator), provenanceCodes[declaredRate.provenance.kind], declaredRate.provenance.detail ?? null] : null,
      packFact(replay.recording.completionPercent),
    ],
    replay.durationTicks === undefined ? null : packUInt(replay.durationTicks),
    packEvents(replay.events),
    replay.extensions ?? null,
  ];
}

function unpackReplay(value: unknown): CanonicalReplayV1 {
  const packed = row(value, 'MacroHub replay');
  if (packed[0] !== 1) throw new ReplayValidationError(['The packed replay schema version is not supported']);
  const source = row(packed[1], 'Replay source');
  const clock = row(packed[2], 'Replay clock');
  const level = row(packed[3], 'Replay level');
  const recording = row(packed[4], 'Replay recording');
  const declared = recording[2] === null ? null : row(recording[2], 'Declared replay rate');
  const declaredKind = declared?.[0] === 0 ? 'tps' : declared?.[0] === 1 ? 'fps' : null;
  const declaredProvenance = declared ? provenanceKinds[Number(declared[3])] : null;
  if (declared && (!declaredKind || !declaredProvenance || (declared[4] !== null && typeof declared[4] !== 'string'))) {
    throw new ReplayValidationError(['Declared replay rate is malformed']);
  }
  const replay: CanonicalReplayV1 = {
    schema: 'macrohub/replay',
    schemaVersion: 1,
    source: {
      formatId: String(source[0] ?? ''),
      parserVersion: String(source[1] ?? ''),
      sha256: String(source[2] ?? ''),
    },
    clock: { ticksPerSecond: { numerator: unpackUInt(clock[0], 'Clock numerator'), denominator: unpackUInt(clock[1], 'Clock denominator') } },
    level: {
      ...(unpackFact<string>(level[0], 'Level ID') ? { id: unpackFact<string>(level[0], 'Level ID') } : {}),
      ...(unpackFact<string>(level[1], 'Level name') ? { name: unpackFact<string>(level[1], 'Level name') } : {}),
    },
    recording: {
      ...(unpackFact<string>(recording[0], 'Replay version') ? { replayVersion: unpackFact<string>(recording[0], 'Replay version') } : {}),
      ...(unpackFact<string>(recording[1], 'Geometry Dash version') ? { geometryDashVersion: unpackFact<string>(recording[1], 'Geometry Dash version') } : {}),
      ...(declared && declaredKind && declaredProvenance ? { declaredRate: {
        value: { kind: declaredKind, value: { numerator: unpackUInt(declared[1], 'Declared rate numerator'), denominator: unpackUInt(declared[2], 'Declared rate denominator') } },
        provenance: { kind: declaredProvenance, ...(typeof declared[4] === 'string' ? { detail: declared[4] } : {}) },
      } } : {}),
      ...(unpackFact<number>(recording[3], 'Completion percentage') ? { completionPercent: unpackFact<number>(recording[3], 'Completion percentage') } : {}),
    },
    ...(packed[5] === null ? {} : { durationTicks: unpackUInt(packed[5], 'Replay duration') }),
    events: unpackEvents(packed[6]),
    ...(packed[7] === null ? {} : { extensions: packed[7] as Record<`${string}/${string}`, JsonValue> }),
  };
  return validateCanonicalReplay(replay);
}

function encodedReplay(replay: CanonicalReplayV1): Uint8Array {
  return encodeMessagePack(packReplay(replay), { sortKeys: true, ignoreUndefined: true });
}

function safeBaseName(filename: string): string {
  return filename
    .replace(/\.macrohub$/i, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'replay';
}

export const macroHubJsonParser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) {
    if (input.bytes.byteLength > MAX_BYTES) return { confidence: 'none', reason: 'File exceeds the 10 MiB limit' };
    if (hasMagic(input.bytes)) {
      if (input.bytes[4] !== CONTAINER_VERSION || input.bytes[5] !== CODEC_MSGPACK_GZIP) {
        return { confidence: 'strong', reason: 'MacroHub container uses an unsupported version or codec' };
      }
      return { confidence: 'exact', reason: 'MacroHub v2 container header found' };
    }
    if (/\.macrohub$/i.test(input.filename)) return { confidence: 'possible', reason: 'MacroHub extension found but the container header is invalid' };
    return { confidence: 'none', reason: 'No MacroHub container header' };
  },
  async parse(input) {
    if (input.bytes.byteLength > MAX_BYTES) throw new ReplayValidationError(['File exceeds the 10 MiB limit']);
    let raw: unknown;
    try {
      const payload = await gunzip(compressedPayload(input.bytes));
      raw = decodeMessagePack(payload, {
        maxStrLength: MAX_BYTES,
        maxBinLength: MAX_BYTES,
        maxArrayLength: 250_010,
        maxMapLength: 250_010,
        maxExtLength: 0,
      });
    } catch (error) {
      if (error instanceof ReplayValidationError) throw error;
      throw new ReplayValidationError(['The MacroHub packed replay is invalid']);
    }
    const replay = unpackReplay(raw);
    const actualHash = await sha256Hex(input.bytes);
    const diagnostics: ConversionIssue[] = [];
    if (replay.source.sha256 !== actualHash) {
      diagnostics.push({
        code: 'SOURCE_HASH_IS_PROVENANCE',
        severity: 'info',
        category: 'metadata-loss',
        message: 'The embedded source hash describes the original imported file, not this MacroHub container.',
      });
    }
    return { replay, diagnostics };
  },
};

export const macroHubJsonExporter: MacroExporter = {
  implementationVersion: VERSION,
  assess(replay) {
    try {
      const validated = validateCanonicalReplay(replay);
      if (encodedReplay(validated).byteLength > MAX_BYTES) {
        return {
          decision: 'blocked',
          issues: [{
            code: 'MACROHUB_REPLAY_TOO_LARGE',
            severity: 'error',
            category: 'unsupported-format',
            message: 'The lossless packed replay would exceed 10 MiB.',
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
    const validated = validateCanonicalReplay(replay);
    const packed = encodedReplay(validated);
    if (packed.byteLength > MAX_BYTES) throw new ReplayValidationError(['The lossless packed replay exceeds 10 MiB']);
    const levelName = validated.level.name?.value ?? validated.level.id?.value ?? 'replay';
    return {
      bytes: wrapContainer(await gzip(packed)),
      filename: `${safeBaseName(levelName)}.macrohub`,
      mediaType: 'application/vnd.macrohub.replay',
      extension: '.macrohub',
    };
  },
};

export function makeMacroHubReplay(input: Omit<CanonicalReplayV1, 'schema' | 'schemaVersion'>): CanonicalReplayV1 {
  return validateCanonicalReplay({ schema: 'macrohub/replay', schemaVersion: 1, ...input });
}
