import type { MacroExporter, MacroParser } from '../interfaces';
import { ReplayValidationError } from '../schema';
import type {
  CanonicalReplayV1,
  ConversionIssue,
  ExportAssessment,
  ReplayEvent,
} from '../types';
import {
  MAX_IMPORTED_EVENTS,
  ReplayBinaryReader,
  buildImportedReplay,
  bytesStartWith,
} from './import-utils';
import type { ImportedExtraEvent, ImportedInput, ImportedPlayerState } from './import-utils';
import {
  ReplayBinaryWriter,
  asFloat32,
  controlButton,
  inputEvents,
  parserRateKey,
  playerStateEvents,
  rateKey,
  replayRate,
  safeBaseName,
  verifyInputRoundTrip,
} from './export-utils';

const VERSION = '1.0.0';
const MAGIC = [0x52, 0x45, 0x34] as const;
const MAX_U64 = 0xffff_ffff_ffff_ffffn;
const PHYSICS_RECORD_BYTES = 25;
const INPUT_RECORD_BYTES = 14;

type PlayerState = Extract<ReplayEvent, { kind: 'player-state' }>;
type ExtensionEvent = Extract<ReplayEvent, { kind: 'extension' }>;

function positiveRate(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) {
    throw new ReplayValidationError(['Replay Engine 4 TPS must be positive, finite, and within supported bounds']);
  }
  return value;
}

function safeCount(value: bigint, label: string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_IMPORTED_EVENTS) {
    throw new ReplayValidationError([`${label} exceeds safe parsing bounds`]);
  }
  return count;
}

function requiredBytes(count: number, recordBytes: number, label: string): number {
  const bytes = count * recordBytes;
  if (!Number.isSafeInteger(bytes)) throw new ReplayValidationError([`${label} declared size exceeds safe parsing bounds`]);
  return bytes;
}

function readPlayer(value: number, label: string): 1 | 2 {
  if (value !== 0 && value !== 1) throw new ReplayValidationError([`${label} has an invalid player flag`]);
  return value === 1 ? 2 : 1;
}

async function parseReplayEngine4(bytes: Uint8Array) {
  if (!bytesStartWith(bytes, MAGIC)) throw new ReplayValidationError(['Replay Engine 4 header is missing']);
  const reader = new ReplayBinaryReader(bytes, MAGIC.length);
  if (reader.remaining < 20) throw new ReplayValidationError(['Replay Engine 4 header is truncated']);

  const rate = positiveRate(reader.readF32LE());
  const physicsCount = safeCount(reader.readU64LE(), 'Replay Engine 4 physics count');
  const physicsBytes = requiredBytes(physicsCount, PHYSICS_RECORD_BYTES, 'Replay Engine 4 physics records');
  if (reader.remaining < physicsBytes + 8) throw new ReplayValidationError(['Replay Engine 4 physics records are truncated']);

  const playerStates: ImportedPlayerState[] = [];
  const extraEvents: ImportedExtraEvent[] = [];
  for (let index = 0; index < physicsCount; index += 1) {
    const tick = reader.readU64LE();
    const x = reader.readF32LE();
    const y = reader.readF32LE();
    const yAcceleration = reader.readF64LE();
    const player = readPlayer(reader.readU8(), `Replay Engine 4 physics record ${index}`);
    if (![x, y, yAcceleration].every(Number.isFinite)) {
      throw new ReplayValidationError([`Replay Engine 4 physics record ${index} contains non-finite data`]);
    }
    playerStates.push({ tick, player, x, y });
    extraEvents.push({
      tick,
      kind: 'extension',
      namespace: 'replayengine4',
      eventType: 'frame-physics',
      critical: true,
      payload: { player, yAcceleration },
    });
  }

  const inputCount = safeCount(reader.readU64LE(), 'Replay Engine 4 input count');
  if (physicsCount + inputCount > MAX_IMPORTED_EVENTS) {
    throw new ReplayValidationError(['Replay Engine 4 contains too many records']);
  }
  const inputBytes = requiredBytes(inputCount, INPUT_RECORD_BYTES, 'Replay Engine 4 input records');
  if (reader.remaining !== inputBytes) throw new ReplayValidationError(['Replay Engine 4 input records do not match the file length']);

  const inputs: ImportedInput[] = [];
  for (let index = 0; index < inputCount; index += 1) {
    const tick = reader.readU64LE();
    const down = reader.readU8();
    const button = reader.readI32LE();
    const player = readPlayer(reader.readU8(), `Replay Engine 4 input ${index}`);
    if ((down !== 0 && down !== 1) || button < 1 || button > 3) {
      throw new ReplayValidationError([`Replay Engine 4 input ${index} contains an invalid field`]);
    }
    inputs.push({ tick, player, button, down: down === 1 });
  }

  return buildImportedReplay({
    formatId: 'replayengine4',
    parserVersion: VERSION,
    bytes,
    ticksPerSecond: rate,
    replayVersion: '4',
    inputs,
    playerStates,
    extraEvents,
    extensions: {
      'replayengine4/metadata': { physicsCount, inputCount },
    },
  });
}

export const replayEngine4Parser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) {
    if (bytesStartWith(input.bytes, MAGIC)) {
      try {
        await parseReplayEngine4(input.bytes);
        return { confidence: 'exact', reason: 'Valid GDH Replay Engine 4 binary replay' };
      } catch {
        return { confidence: 'strong', reason: 'RE4 header found, but the replay records are invalid' };
      }
    }
    if (/\.re4$/i.test(input.filename)) return { confidence: 'possible', reason: 'RE4 extension found without a valid header' };
    return { confidence: 'none', reason: 'Not a Replay Engine 4 file' };
  },
  async parse(input) {
    return parseReplayEngine4(input.bytes);
  },
};

function issue(code: string, category: ConversionIssue['category'], message: string): ExportAssessment {
  return { decision: 'blocked', issues: [{ code, severity: 'error', category, message }] };
}

function warning(code: string, message: string): ConversionIssue {
  return {
    code,
    severity: 'warning',
    category: 'metadata-loss',
    message,
    requiresAcknowledgement: true,
  };
}

function physicsPayload(event: ExtensionEvent): { player: 1 | 2; yAcceleration: number } | null {
  if (event.namespace !== 'replayengine4' || event.eventType !== 'frame-physics') return null;
  const payload = event.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const player = payload.player;
  const yAcceleration = payload.yAcceleration;
  if ((player !== 1 && player !== 2) || typeof yAcceleration !== 'number' || !Number.isFinite(yAcceleration)) return null;
  return { player, yAcceleration };
}

function physicsKey(tick: string, player: 1 | 2): string {
  return `${tick}:${player}`;
}

function collectPhysics(replay: CanonicalReplayV1): {
  states: PlayerState[];
  accelerations: Map<string, number[]>;
  consumedExtensions: Set<ExtensionEvent>;
} {
  const accelerations = new Map<string, number[]>();
  const consumedExtensions = new Set<ExtensionEvent>();
  for (const event of replay.events) {
    if (event.kind !== 'extension') continue;
    const payload = physicsPayload(event);
    if (!payload) continue;
    const key = physicsKey(event.tick, payload.player);
    const values = accelerations.get(key) ?? [];
    values.push(payload.yAcceleration);
    accelerations.set(key, values);
    consumedExtensions.add(event);
  }
  return { states: playerStateEvents(replay), accelerations, consumedExtensions };
}

function assessReplayEngine4(replay: CanonicalReplayV1): ExportAssessment {
  const encodedRate = asFloat32(replayRate(replay));
  if (parserRateKey(encodedRate) !== rateKey(replay)) {
    return issue('RE4_RATE_UNREPRESENTABLE', 'timing-loss', 'RE4 cannot represent this replay rate without changing input timing.');
  }

  const physics = collectPhysics(replay);
  const available = new Map(Array.from(physics.accelerations, ([key, values]) => [key, [...values]]));
  for (const event of replay.events) {
    if (BigInt(event.tick) > MAX_U64) {
      return issue('RE4_FRAME_OUT_OF_RANGE', 'timing-loss', 'RE4 cannot represent one or more replay frames.');
    }
    if (event.kind === 'input') {
      if (!controlButton(event)) return issue('RE4_CONTROL_UNSUPPORTED', 'gameplay-loss', 'RE4 cannot represent one or more gameplay buttons in this replay.');
      continue;
    }
    if (event.kind === 'player-state') {
      if (event.x === undefined || event.y === undefined || event.rotation !== undefined
        || asFloat32(event.x) !== event.x || asFloat32(event.y) !== event.y) {
        return issue('RE4_PLAYER_STATE_UNREPRESENTABLE', 'gameplay-loss', 'RE4 cannot preserve one or more player-state corrections exactly.');
      }
      const key = physicsKey(event.tick, event.player);
      const values = available.get(key);
      if (!values?.length) {
        return issue('RE4_Y_ACCELERATION_MISSING', 'missing-required-data', 'RE4 needs the original Y acceleration for every position correction.');
      }
      values.shift();
      continue;
    }
    if (event.kind === 'death' || event.kind === 'checkpoint') {
      return issue('RE4_GAMEPLAY_EVENT_UNSUPPORTED', 'gameplay-loss', 'RE4 cannot preserve this replay\'s death or checkpoint events.');
    }
    if (event.kind === 'extension' && event.critical && !physics.consumedExtensions.has(event)) {
      return issue('RE4_CRITICAL_EXTENSION', 'extension-loss', 'RE4 cannot preserve a gameplay-critical format extension.');
    }
  }
  if (Array.from(available.values()).some((values) => values.length)) {
    return issue('RE4_PHYSICS_EXTENSION_ORPHANED', 'invalid-replay', 'RE4 physics data does not match a player-state correction.');
  }

  const optionalExtensionEvents = replay.events.some((event) => event.kind === 'extension' && !event.critical);
  const containerExtensions = Object.entries(replay.extensions ?? {})
    .some(([key]) => key !== 'replayengine4/metadata');
  const optionalMetadata = optionalExtensionEvents
    || containerExtensions
    || Boolean(replay.level.id || replay.level.name)
    || Boolean(replay.recording.geometryDashVersion || replay.recording.completionPercent)
    || (replay.recording.replayVersion?.value !== undefined && replay.recording.replayVersion.value !== '4');
  const issues = optionalMetadata
    ? [warning('RE4_OPTIONAL_METADATA_REMOVED', 'RE4 preserves its gameplay records, but does not store this replay\'s optional level or recording metadata.')]
    : [];
  return { decision: 'allowed', fidelity: issues.length ? 'metadata-loss' : 'lossless', issues };
}

function yAccelerationQueues(replay: CanonicalReplayV1): Map<string, number[]> {
  return new Map(Array.from(collectPhysics(replay).accelerations, ([key, values]) => [key, [...values]]));
}

function accelerationSignature(replay: CanonicalReplayV1): string[] {
  return replay.events.flatMap((event) => {
    if (event.kind !== 'extension') return [];
    const payload = physicsPayload(event);
    return payload ? [`${event.tick}:${payload.player}:${payload.yAcceleration}`] : [];
  });
}

export const replayEngine4Exporter: MacroExporter = {
  implementationVersion: VERSION,
  assess: assessReplayEngine4,
  async export(replay) {
    const assessment = assessReplayEngine4(replay);
    if (assessment.decision === 'blocked') throw new ReplayValidationError(assessment.issues.map((item) => item.message));

    const states = playerStateEvents(replay);
    const inputs = inputEvents(replay);
    const accelerations = yAccelerationQueues(replay);
    const writer = new ReplayBinaryWriter();
    writer.writeBytes(MAGIC);
    writer.writeF32LE(replayRate(replay));
    writer.writeU64LE(BigInt(states.length));
    for (const event of states) {
      const values = accelerations.get(physicsKey(event.tick, event.player));
      const yAcceleration = values?.shift();
      if (yAcceleration === undefined) throw new ReplayValidationError(['RE4 Y acceleration is missing']);
      writer.writeU64LE(BigInt(event.tick));
      writer.writeF32LE(event.x!);
      writer.writeF32LE(event.y!);
      writer.writeF64LE(yAcceleration);
      writer.writeU8(event.player === 2 ? 1 : 0);
    }
    writer.writeU64LE(BigInt(inputs.length));
    for (const event of inputs) {
      writer.writeU64LE(BigInt(event.tick));
      writer.writeU8(event.state === 'press' ? 1 : 0);
      writer.writeI32LE(controlButton(event)!);
      writer.writeU8(event.player === 2 ? 1 : 0);
    }
    return {
      bytes: writer.finish(),
      filename: `${safeBaseName(replay)}.re4`,
      extension: '.re4',
      mediaType: 'application/octet-stream',
    };
  },
  verifyRoundTrip(source, reparsed) {
    const issues = verifyInputRoundTrip(source, reparsed, { playerStates: true });
    if (JSON.stringify(accelerationSignature(source)) !== JSON.stringify(accelerationSignature(reparsed))) {
      issues.push({
        code: 'RE4_ROUND_TRIP_PHYSICS_MISMATCH',
        severity: 'error',
        category: 'gameplay-loss',
        message: 'The generated RE4 file changed one or more physics corrections.',
      });
    }
    return issues;
  },
};
