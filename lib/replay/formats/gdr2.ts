import type { MacroExporter, MacroParser } from '../interfaces';
import { ReplayValidationError, sha256Hex, validateCanonicalReplay } from '../schema';
import type {
  CanonicalReplayV1,
  ConversionIssue,
  ExportAssessment,
  ReplayEvent,
  UIntString,
} from '../types';

const VERSION = '1.1.0';
const MAX_INPUTS = 250_000;
const MAX_UINT64 = (1n << 64n) - 1n;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

class BinaryReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get remaining() {
    return this.bytes.length - this.offset;
  }

  readRaw(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
      throw new ReplayValidationError(['GDR2 file is truncated or declares an invalid block size']);
    }
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readVarUint(): bigint {
    let value = 0n;
    let shift = 0n;
    for (let index = 0; index < 10; index += 1) {
      const byte = this.readRaw(1)[0];
      if (index === 9 && (byte & 0xfe) !== 0) {
        throw new ReplayValidationError(['GDR2 varint exceeds uint64 bounds']);
      }
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        if (index > 0 && byte === 0) throw new ReplayValidationError(['GDR2 varint is not canonically encoded']);
        return value;
      }
      shift += 7n;
    }
    throw new ReplayValidationError(['GDR2 varint exceeds 64-bit bounds']);
  }

  readSafeInt(label: string): number {
    const value = this.readVarUint();
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ReplayValidationError([`${label} exceeds JavaScript safe integer bounds`]);
    }
    return Number(value);
  }

  readString(label: string): string {
    const length = this.readSafeInt(`${label} length`);
    if (length > 65_536) throw new ReplayValidationError([`${label} exceeds 64 KiB`]);
    try {
      return decoder.decode(this.readRaw(length));
    } catch {
      throw new ReplayValidationError([`${label} is not valid UTF-8`]);
    }
  }

  readBool(): boolean {
    const value = this.readSafeInt('Boolean');
    if (value !== 0 && value !== 1) throw new ReplayValidationError(['GDR2 boolean must be 0 or 1']);
    return value === 1;
  }

  readFloat32(): number {
    const bytes = this.readRaw(4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getFloat32(0, false);
  }

  readFloat64(): number {
    const bytes = this.readRaw(8);
    return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, false);
  }
}

class BinaryWriter {
  private readonly bytes: number[] = [];

  writeRaw(value: Uint8Array | number[]) {
    this.bytes.push(...value);
  }

  writeVarUint(input: bigint | number) {
    let value = typeof input === 'number' ? BigInt(input) : input;
    if (value < 0n) throw new Error('Cannot write a negative GDR2 varint');
    do {
      let byte = Number(value & 0x7fn);
      value >>= 7n;
      if (value > 0n) byte |= 0x80;
      this.bytes.push(byte);
    } while (value > 0n);
  }

  writeString(value: string) {
    const bytes = encoder.encode(value);
    this.writeVarUint(bytes.length);
    this.writeRaw(bytes);
  }

  writeBool(value: boolean) {
    this.writeVarUint(value ? 1 : 0);
  }

  writeFloat32(value: number) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, value, false);
    this.writeRaw(bytes);
  }

  writeFloat64(value: number) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, false);
    this.writeRaw(bytes);
  }

  finish() {
    return new Uint8Array(this.bytes);
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function rationalFromNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new ReplayValidationError(['GDR2 framerate must be positive and finite']);
  const [coefficient, exponentText = '0'] = value.toString().toLowerCase().split('e');
  const exponent = Number(exponentText);
  const [whole, fraction = ''] = coefficient.split('.');
  const digits = `${whole}${fraction}`.replace(/^0+/, '') || '0';
  let numerator = BigInt(digits);
  let denominator = 1n;
  const scale = fraction.length - exponent;
  if (scale > 0) denominator = 10n ** BigInt(scale);
  else if (scale < 0) numerator *= 10n ** BigInt(-scale);
  const divisor = gcdBigInt(numerator, denominator);
  numerator /= divisor;
  denominator /= divisor;
  if (numerator.toString().length > 32 || denominator.toString().length > 32) {
    throw new ReplayValidationError(['GDR2 framerate precision exceeds canonical bounds']);
  }
  return {
    numerator: numerator.toString() as UIntString,
    denominator: denominator.toString() as UIntString,
  };
}

function rationalToNumber(replay: CanonicalReplayV1): number {
  const rate = replay.clock.ticksPerSecond;
  return Number(BigInt(rate.numerator)) / Number(BigInt(rate.denominator));
}

function gcdBigInt(a: bigint, b: bigint): bigint {
  let left = a < 0n ? -a : a;
  let right = b < 0n ? -b : b;
  while (right) [left, right] = [right, left % right];
  return left || 1n;
}

function rationalKey(value: { numerator: UIntString; denominator: UIntString }): string {
  const numerator = BigInt(value.numerator);
  const denominator = BigInt(value.denominator);
  const divisor = gcdBigInt(numerator, denominator);
  return `${numerator / divisor}/${denominator / divisor}`;
}

function effectiveDuration(replay: CanonicalReplayV1): bigint {
  const lastEvent = replay.events.reduce(
    (max, event) => BigInt(event.tick) > max ? BigInt(event.tick) : max,
    0n,
  );
  if (replay.durationTicks === undefined) return lastEvent;
  const declared = BigInt(replay.durationTicks);
  return declared > lastEvent ? declared : lastEvent;
}

function gameplaySnapshot(replay: CanonicalReplayV1) {
  return {
    clock: rationalKey(replay.clock.ticksPerSecond),
    levelId: replay.level.id?.value ?? null,
    levelName: replay.level.name?.value ?? null,
    duration: effectiveDuration(replay).toString(),
    inputs: replay.events
      .filter((event): event is Extract<ReplayEvent, { kind: 'input' }> => event.kind === 'input')
      .map((event) => `${event.tick}:${event.player}:${event.control.kind === 'opaque' ? `${event.control.namespace}/${event.control.code}` : event.control.kind}:${event.state}`),
    deaths: replay.events
      .filter((event): event is Extract<ReplayEvent, { kind: 'death' }> => event.kind === 'death')
      .map((event) => event.tick)
      .sort((a, b) => Number(BigInt(a) - BigInt(b))),
  };
}

function formatGameVersion(raw: number): string {
  if (!raw) return 'unknown';
  const digits = String(raw);
  if (digits.length < 2) return digits;
  return `${digits[0]}.${digits.slice(1)}`;
}

type Gdr2Metadata = {
  formatVersion: number;
  author: string;
  description: string;
  durationSeconds: number;
  gameVersion: number;
  seed: number;
  coins: number;
  ldm: boolean;
  platformer: boolean;
  botName: string;
  botVersion: number;
  inputTag: string;
  replayExtensionBase64?: string;
};

function metadataFrom(replay: CanonicalReplayV1): Gdr2Metadata | null {
  const value = replay.extensions?.['gdr2/metadata'];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const safeInteger = (candidate: unknown) => typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0;
  if (item.formatVersion !== 2
    || typeof item.author !== 'string'
    || typeof item.description !== 'string'
    || typeof item.durationSeconds !== 'number'
    || !Number.isFinite(item.durationSeconds)
    || item.durationSeconds < 0
    || !safeInteger(item.gameVersion)
    || !safeInteger(item.seed)
    || !safeInteger(item.coins)
    || typeof item.ldm !== 'boolean'
    || typeof item.platformer !== 'boolean'
    || typeof item.botName !== 'string'
    || !safeInteger(item.botVersion)
    || typeof item.inputTag !== 'string'
    || (item.replayExtensionBase64 !== undefined && (typeof item.replayExtensionBase64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.replayExtensionBase64)))) return null;
  return {
    formatVersion: item.formatVersion,
    author: item.author,
    description: item.description,
    durationSeconds: item.durationSeconds,
    gameVersion: item.gameVersion as number,
    seed: item.seed as number,
    coins: item.coins as number,
    ldm: item.ldm,
    platformer: item.platformer,
    botName: item.botName,
    botVersion: item.botVersion as number,
    inputTag: item.inputTag,
    replayExtensionBase64: typeof item.replayExtensionBase64 === 'string' ? item.replayExtensionBase64 : undefined,
  };
}

function platformerValue(replay: CanonicalReplayV1, metadata: Gdr2Metadata | null): boolean | null {
  if (metadata) return metadata.platformer;
  const mode = replay.extensions?.['geometry-dash/mode'];
  if (mode && typeof mode === 'object' && !Array.isArray(mode) && typeof mode.platformer === 'boolean') return mode.platformer;
  if (replay.events.some((event) => event.kind === 'input' && event.control.kind !== 'opaque' && event.control.kind !== 'jump')) return true;
  return null;
}

function issuesForExport(replay: CanonicalReplayV1): ExportAssessment {
  const issues: ConversionIssue[] = [];
  const metadata = metadataFrom(replay);
  if (replay.extensions?.['gdr2/metadata'] !== undefined && !metadata) {
    return {
      decision: 'blocked',
      issues: [{ code: 'GDR2_METADATA_INVALID', severity: 'error', category: 'invalid-replay', message: 'The stored GDR2 metadata is incomplete or invalid.' }],
    };
  }
  const platformer = platformerValue(replay, metadata);
  if (platformer === null) {
    return {
      decision: 'blocked',
      issues: [{ code: 'GDR2_MODE_UNKNOWN', severity: 'error', category: 'missing-required-data', message: 'GDR2 needs to know whether this is a platformer replay.' }],
    };
  }
  const rate = rationalToNumber(replay);
  if (!Number.isFinite(rate) || rate <= 0) {
    return {
      decision: 'blocked',
      issues: [{ code: 'GDR2_RATE_OUT_OF_RANGE', severity: 'error', category: 'timing-loss', message: 'The replay rate cannot be represented by GDR2.' }],
    };
  }
  if (rationalKey(rationalFromNumber(rate)) !== rationalKey(replay.clock.ticksPerSecond)) {
    return {
      decision: 'blocked',
      issues: [{ code: 'GDR2_RATE_PRECISION_LOSS', severity: 'error', category: 'timing-loss', message: 'The replay rate would lose timing precision in GDR2.' }],
    };
  }
  const levelId = replay.level.id?.value;
  if (levelId !== undefined && (!/^\d+$/.test(levelId) || BigInt(levelId) > 4_294_967_295n)) {
    return {
      decision: 'blocked',
      issues: [{ code: 'GDR2_LEVEL_ID_UNREPRESENTABLE', severity: 'error', category: 'missing-required-data', message: 'The level ID cannot be represented by GDR2.' }],
    };
  }
  const duration = effectiveDuration(replay);
  if (duration > BigInt(Number.MAX_SAFE_INTEGER)) {
    return {
      decision: 'blocked',
      issues: [{ code: 'GDR2_DURATION_OUT_OF_RANGE', severity: 'error', category: 'timing-loss', message: 'The replay duration is outside safe GDR2 conversion bounds.' }],
    };
  }
  const durationSeconds = Number(duration) / rate;
  const float32Duration = new Float32Array([durationSeconds])[0];
  const restoredDuration = BigInt(Math.round(float32Duration * rate));
  if (restoredDuration !== duration) {
    return {
      decision: 'blocked',
      issues: [{ code: 'GDR2_DURATION_PRECISION_LOSS', severity: 'error', category: 'timing-loss', message: 'The replay duration would lose frame precision in GDR2.' }],
    };
  }
  if (metadata?.replayExtensionBase64 || metadata?.inputTag) {
    return {
      decision: 'blocked',
      issues: [{ code: 'GDR2_UNKNOWN_EXTENSION_DATA', severity: 'error', category: 'extension-loss', message: 'This GDR2 replay contains extension data that cannot be safely rewritten.' }],
    };
  }
  const inputEvents = replay.events.filter(
    (event): event is Extract<ReplayEvent, { kind: 'input' }> => event.kind === 'input',
  );
  for (let index = 1; index < inputEvents.length; index += 1) {
    const previous = inputEvents[index - 1];
    const current = inputEvents[index];
    if (previous.tick === current.tick && previous.player === 2 && current.player === 1) {
      return {
        decision: 'blocked',
        issues: [{ code: 'GDR2_SAME_TICK_ORDER_LOSS', severity: 'error', category: 'timing-loss', message: 'GDR2 cannot preserve this same-frame player input order.' }],
      };
    }
  }
  for (const event of replay.events) {
    if (event.kind === 'input' && event.control.kind === 'opaque') {
      return {
        decision: 'blocked',
        issues: [{
          code: 'GDR2_OPAQUE_CONTROL',
          severity: 'error',
          category: 'gameplay-loss',
          message: 'GDR2 cannot represent this opaque input control.',
        }],
      };
    }
    if (event.kind === 'checkpoint') {
      return {
        decision: 'blocked',
        issues: [{
          code: 'GDR2_CHECKPOINTS_UNSUPPORTED',
          severity: 'error',
          category: 'gameplay-loss',
          message: 'GDR2 cannot safely preserve checkpoint actions.',
        }],
      };
    }
    if (event.kind === 'extension' && event.critical) {
      return {
        decision: 'blocked',
        issues: [{
          code: 'GDR2_CRITICAL_EXTENSION',
          severity: 'error',
          category: 'extension-loss',
          message: 'A gameplay-critical extension cannot be represented in a base GDR2 export.',
        }],
      };
    }
  }
  if (replay.events.some((event) => event.kind === 'player-state')) {
    return {
      decision: 'blocked',
      issues: [{ code: 'GDR2_PLAYER_STATE_REQUIRED', severity: 'error', category: 'gameplay-loss', message: 'Player position or rotation data may be required for frame correction and cannot be dropped.' }],
    };
  }
  if (replay.events.some((event) => event.kind === 'death' && event.player !== undefined)) {
    return {
      decision: 'blocked',
      issues: [{ code: 'GDR2_DEATH_PLAYER_REQUIRED', severity: 'error', category: 'gameplay-loss', message: 'GDR2 cannot preserve which player a death event belongs to.' }],
    };
  }
  if (replay.events.some((event) => event.kind === 'extension' && !event.critical)) {
    issues.push({
      code: 'GDR2_NONCRITICAL_EXTENSIONS_REMOVED',
      severity: 'warning',
      category: 'extension-loss',
      message: 'Optional event extension data is not included in the GDR2 file.',
      requiresAcknowledgement: true,
    });
  }
  if (replay.extensions && Object.keys(replay.extensions).some((key) => key !== 'gdr2/metadata' && key !== 'geometry-dash/mode')) {
    issues.push({
      code: 'GDR2_EXTRA_METADATA_REMOVED',
      severity: 'warning',
      category: 'metadata-loss',
      message: 'Extra replay metadata is not included in the GDR2 file.',
      requiresAcknowledgement: true,
    });
  }
  if (!metadata) {
    issues.push({
      code: 'GDR2_OPTIONAL_METADATA_DEFAULTED',
      severity: 'warning',
      category: 'metadata-loss',
      message: 'Source-only author, bot, seed, coin, and detail-mode metadata will be stored as unspecified values.',
      requiresAcknowledgement: true,
    });
  }
  if (replay.recording.completionPercent || replay.recording.replayVersion) {
    issues.push({
      code: 'GDR2_RECORDING_METADATA_REMOVED',
      severity: 'warning',
      category: 'metadata-loss',
      message: 'Completion percentage or source replay version is not stored by GDR2.',
      requiresAcknowledgement: true,
    });
  }
  return {
    decision: 'allowed',
    fidelity: issues.length ? 'metadata-loss' : 'compatible',
    issues,
  };
}

export const gdr2Parser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) {
    if (input.bytes.length >= 3 && input.bytes[0] === 0x47 && input.bytes[1] === 0x44 && input.bytes[2] === 0x52) {
      try {
        const version = new BinaryReader(input.bytes.slice(3)).readVarUint();
        return version === 2n
          ? { confidence: 'exact', reason: 'GDR2 version 2 signature found' }
          : { confidence: 'possible', reason: `GDR version ${version.toString()} is recognized but not supported by this parser` };
      } catch {
        return { confidence: 'possible', reason: 'GDR magic found with an invalid version field' };
      }
    }
    if (/\.gdr2$/i.test(input.filename)) return { confidence: 'possible', reason: 'GDR2 extension found without binary magic' };
    return { confidence: 'none', reason: 'No GDR2 signature' };
  },
  async parse(input) {
    const reader = new BinaryReader(input.bytes);
    const magic = decoder.decode(reader.readRaw(3));
    if (magic !== 'GDR') throw new ReplayValidationError(['GDR2 magic is missing']);
    const formatVersion = reader.readSafeInt('Format version');
    if (formatVersion !== 2) throw new ReplayValidationError([`Only GDR2 format version 2 is supported; received version ${formatVersion}`]);
    const inputTag = reader.readString('Input tag');
    const author = reader.readString('Author');
    const description = reader.readString('Description');
    const durationSeconds = reader.readFloat32();
    const gameVersion = reader.readSafeInt('Game version');
    const framerate = reader.readFloat64();
    const seed = reader.readSafeInt('Seed');
    const coins = reader.readSafeInt('Coins');
    const ldm = reader.readBool();
    const platformer = reader.readBool();
    const botName = reader.readString('Bot name');
    const botVersion = reader.readSafeInt('Bot version');
    const levelId = reader.readSafeInt('Level ID');
    const levelName = reader.readString('Level name');

    if (!Number.isFinite(durationSeconds) || durationSeconds < 0) throw new ReplayValidationError(['GDR2 duration is invalid']);
    const replayExtension = reader.readRaw(reader.readSafeInt('Replay extension size'));
    const deathCount = reader.readSafeInt('Death count');
    if (deathCount > MAX_INPUTS) throw new ReplayValidationError(['GDR2 death count exceeds the safety limit']);
    const deaths: bigint[] = [];
    let deathFrame = 0n;
    for (let index = 0; index < deathCount; index += 1) {
      deathFrame += reader.readVarUint();
      if (deathFrame > MAX_UINT64) throw new ReplayValidationError(['GDR2 death frame exceeds uint64 bounds']);
      deaths.push(deathFrame);
    }

    const inputCount = reader.readSafeInt('Input count');
    const p1InputCount = reader.readSafeInt('Player 1 input count');
    if (inputCount > MAX_INPUTS || p1InputCount > inputCount) {
      throw new ReplayValidationError(['GDR2 input count exceeds the safety limit or has an invalid player split']);
    }

    const inputs: Array<{
      frame: bigint;
      player: 1 | 2;
      button: 1 | 2 | 3;
      down: boolean;
      extension?: Uint8Array;
      sourceOrder: number;
    }> = [];
    let previousP1 = 0n;
    let previousP2 = 0n;
    for (let index = 0; index < inputCount; index += 1) {
      const packed = reader.readVarUint();
      const player: 1 | 2 = index < p1InputCount ? 1 : 2;
      const delta = platformer ? packed >> 3n : packed >> 1n;
      const down = (packed & 1n) === 1n;
      const buttonValue = platformer ? Number((packed >> 1n) & 3n) : 1;
      if (buttonValue < 1 || buttonValue > 3) {
        throw new ReplayValidationError(['GDR2 input contains invalid timing or button data']);
      }
      const frame = (player === 1 ? previousP1 : previousP2) + delta;
      if (frame > MAX_UINT64) throw new ReplayValidationError(['GDR2 input frame exceeds uint64 bounds']);
      if (player === 1) previousP1 = frame;
      else previousP2 = frame;
      const extension = inputTag ? reader.readRaw(reader.readSafeInt('Input extension size')) : undefined;
      inputs.push({ frame, player, button: buttonValue as 1 | 2 | 3, down, extension, sourceOrder: index });
    }
    if (reader.remaining !== 0) throw new ReplayValidationError(['GDR2 file contains trailing or malformed data']);

    const events: ReplayEvent[] = [];
    const sorted = inputs.sort((a, b) => a.frame < b.frame ? -1 : a.frame > b.frame ? 1 : a.sourceOrder - b.sourceOrder);
    for (const item of sorted) {
      const order = events.length;
      events.push({
        tick: item.frame.toString() as UIntString,
        order,
        kind: 'input',
        player: item.player,
        control: { kind: item.button === 1 ? 'jump' : item.button === 2 ? 'left' : 'right' },
        state: item.down ? 'press' : 'release',
      });
      if (item.extension?.length) {
        events.push({
          tick: item.frame.toString() as UIntString,
          order: order + 1,
          kind: 'extension',
          namespace: 'gdr2',
          eventType: 'input-extension',
          critical: true,
          payload: { inputTag, inputOrder: order, bytesBase64: toBase64(item.extension) },
        });
      }
    }
    for (const frame of deaths) {
      events.push({ tick: frame.toString() as UIntString, order: events.length, kind: 'death' });
    }
    events.sort((a, b) => {
      const left = BigInt(a.tick);
      const right = BigInt(b.tick);
      return left < right ? -1 : left > right ? 1 : a.order - b.order;
    });
    events.forEach((event, index) => { event.order = index; });
    const finalFrame = events.reduce((max, event) => BigInt(event.tick) > max ? BigInt(event.tick) : max, 0n);
    const declaredDurationNumber = Math.round(durationSeconds * framerate);
    if (!Number.isSafeInteger(declaredDurationNumber) || declaredDurationNumber < 0) {
      throw new ReplayValidationError(['GDR2 duration exceeds safe parsing bounds']);
    }
    const declaredDuration = BigInt(declaredDurationNumber);
    const durationTicks = declaredDuration > finalFrame ? declaredDuration : finalFrame;
    const hash = await sha256Hex(input.bytes);

    const replay: CanonicalReplayV1 = {
      schema: 'macrohub/replay',
      schemaVersion: 1,
      source: { formatId: 'gdr2', parserVersion: VERSION, sha256: hash },
      clock: { ticksPerSecond: rationalFromNumber(framerate) },
      level: {
        ...(levelId ? { id: { value: String(levelId), provenance: { kind: 'source-file' as const } } } : {}),
        ...(levelName ? { name: { value: levelName, provenance: { kind: 'source-file' as const } } } : {}),
      },
      recording: {
        geometryDashVersion: { value: formatGameVersion(gameVersion), provenance: { kind: 'source-file' } },
        declaredRate: {
          value: { kind: 'tps', value: rationalFromNumber(framerate) },
          provenance: { kind: 'source-file' },
        },
      },
      durationTicks: String(durationTicks) as UIntString,
      events,
      extensions: {
        'gdr2/metadata': {
          formatVersion,
          author,
          description,
          durationSeconds,
          gameVersion,
          seed,
          coins,
          ldm,
          platformer,
          botName,
          botVersion,
          inputTag,
          ...(replayExtension.length ? { replayExtensionBase64: toBase64(replayExtension) } : {}),
        },
      },
    };
    return { replay: validateCanonicalReplay(replay), diagnostics: [] };
  },
};

export const gdr2Exporter: MacroExporter = {
  implementationVersion: VERSION,
  assess: issuesForExport,
  verifyRoundTrip(source, reparsed) {
    if (JSON.stringify(gameplaySnapshot(source)) === JSON.stringify(gameplaySnapshot(reparsed))) return [];
    return [{
      code: 'GDR2_ROUND_TRIP_MISMATCH',
      severity: 'error',
      category: 'gameplay-loss',
      message: 'Generated GDR2 data did not preserve the replay timing and inputs.',
    }];
  },
  async export(replay) {
    validateCanonicalReplay(replay);
    const assessment = issuesForExport(replay);
    if (assessment.decision === 'blocked') throw new ReplayValidationError(assessment.issues.map((issue) => issue.message));
    const metadata = metadataFrom(replay);
    const rate = rationalToNumber(replay);
    const inputEvents = replay.events.filter((event): event is Extract<ReplayEvent, { kind: 'input' }> => event.kind === 'input');
    const deathEvents = replay.events.filter((event): event is Extract<ReplayEvent, { kind: 'death' }> => event.kind === 'death');
    const platformer = platformerValue(replay, metadata);
    if (platformer === null) throw new ReplayValidationError(['GDR2 platformer mode is unknown']);
    const byTick = (a: Extract<ReplayEvent, { kind: 'input' }>, b: Extract<ReplayEvent, { kind: 'input' }>) => {
      const left = BigInt(a.tick);
      const right = BigInt(b.tick);
      return left < right ? -1 : left > right ? 1 : a.order - b.order;
    };
    const p1 = inputEvents.filter((event) => event.player === 1).sort(byTick);
    const p2 = inputEvents.filter((event) => event.player === 2).sort(byTick);
    const durationSeconds = Number(effectiveDuration(replay)) / rate;
    const levelId = replay.level.id?.value && /^\d+$/.test(replay.level.id.value) ? Number(replay.level.id.value) : 0;
    if (!Number.isSafeInteger(levelId) || levelId < 0 || levelId > 4_294_967_295) {
      throw new ReplayValidationError(['Level ID cannot be represented by GDR2']);
    }

    const writer = new BinaryWriter();
    writer.writeRaw([0x47, 0x44, 0x52]);
    writer.writeVarUint(2);
    writer.writeString('');
    writer.writeString(metadata?.author ?? '');
    writer.writeString(metadata?.description ?? '');
    writer.writeFloat32(durationSeconds);
    writer.writeVarUint(metadata?.gameVersion ?? 0);
    writer.writeFloat64(rate);
    writer.writeVarUint(metadata?.seed ?? 0);
    writer.writeVarUint(metadata?.coins ?? 0);
    writer.writeBool(metadata?.ldm ?? false);
    writer.writeBool(platformer);
    writer.writeString(metadata?.botName ?? '');
    writer.writeVarUint(metadata?.botVersion ?? 0);
    writer.writeVarUint(levelId);
    writer.writeString(replay.level.name?.value ?? '');
    writer.writeVarUint(0);

    const deaths = deathEvents.map((event) => BigInt(event.tick)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    writer.writeVarUint(deaths.length);
    let previousDeath = 0n;
    for (const death of deaths) {
      writer.writeVarUint(death - previousDeath);
      previousDeath = death;
    }

    writer.writeVarUint(inputEvents.length);
    writer.writeVarUint(p1.length);
    const writeInputs = (items: typeof p1) => {
      let previous = 0n;
      for (const event of items) {
        const frame = BigInt(event.tick);
        const delta = frame - previous;
        const control = event.control.kind;
        if (control === 'opaque') throw new ReplayValidationError(['Opaque input cannot be exported to GDR2']);
        const button = control === 'jump' ? 1n : control === 'left' ? 2n : 3n;
        const packed = platformer
          ? (delta << 3n) | (button << 1n) | (event.state === 'press' ? 1n : 0n)
          : (delta << 1n) | (event.state === 'press' ? 1n : 0n);
        writer.writeVarUint(packed);
        previous = frame;
      }
    };
    writeInputs(p1);
    writeInputs(p2);

    const baseName = (replay.level.name?.value ?? replay.level.id?.value ?? 'macro')
      .replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'macro';
    return {
      bytes: writer.finish(),
      filename: `${baseName}.gdr2`,
      mediaType: 'application/vnd.gdr2',
      extension: '.gdr2',
    };
  },
};
