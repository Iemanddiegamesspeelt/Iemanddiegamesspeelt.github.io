import { ReplayValidationError, sha256Hex, validateCanonicalReplay } from '../schema';
import type {
  CanonicalReplayV1,
  ConversionIssue,
  JsonValue,
  NamespacedKey,
  ReplayControl,
  ReplayEvent,
  UIntString,
} from '../types';

export const MAX_IMPORTED_EVENTS = 250_000;
export const MAX_IMPORTED_STRING_BYTES = 1_048_576;

export interface ImportedInput {
  tick: bigint;
  player: 1 | 2;
  button: number;
  down: boolean;
  x?: number;
  y?: number;
  rotation?: number;
  extension?: {
    namespace: string;
    eventType: string;
    critical: boolean;
    payload: JsonValue;
  };
}

export interface ImportedPlayerState {
  tick: bigint;
  player: 1 | 2;
  x?: number;
  y?: number;
  rotation?: number;
}

export type ImportedExtraEvent =
  | { tick: bigint; kind: 'death'; player?: 1 | 2 }
  | {
      tick: bigint;
      kind: 'checkpoint';
      action: 'create' | 'activate' | 'remove';
      checkpointId?: string;
      player?: 1 | 2;
    }
  | {
      tick: bigint;
      kind: 'extension';
      namespace: string;
      eventType: string;
      critical: boolean;
      payload: JsonValue;
    };

export interface ImportedReplay {
  formatId: string;
  parserVersion: string;
  bytes: Uint8Array;
  ticksPerSecond: number;
  levelId?: string;
  levelName?: string;
  replayVersion?: string;
  geometryDashVersion?: string;
  completionPercent?: number;
  durationTicks?: bigint;
  inputs?: ImportedInput[];
  playerStates?: ImportedPlayerState[];
  extraEvents?: ImportedExtraEvent[];
  extensions?: Record<NamespacedKey, JsonValue>;
  diagnostics?: ConversionIssue[];
}

type ReplayEventPayload = ReplayEvent extends infer Event
  ? Event extends ReplayEvent
    ? Omit<Event, 'tick' | 'order'>
    : never
  : never;

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a || 1n;
}

export function rationalFromRate(value: number) {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) {
    throw new ReplayValidationError(['Replay tick rate must be positive, finite, and within supported bounds']);
  }
  const denominator = 1_000_000n;
  const numeratorNumber = Math.round(value * Number(denominator));
  if (!Number.isSafeInteger(numeratorNumber) || numeratorNumber <= 0) {
    throw new ReplayValidationError(['Replay tick rate cannot be represented safely']);
  }
  const numerator = BigInt(numeratorNumber);
  const divisor = gcd(numerator, denominator);
  return {
    numerator: String(numerator / divisor) as UIntString,
    denominator: String(denominator / divisor) as UIntString,
  };
}

export function ticksFromSeconds(seconds: number, rate: number): bigint {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new ReplayValidationError(['Replay duration must be finite and non-negative']);
  }
  const ticks = Math.round(seconds * rate);
  if (!Number.isSafeInteger(ticks) || ticks < 0) {
    throw new ReplayValidationError(['Replay duration exceeds safe parsing bounds']);
  }
  return BigInt(ticks);
}

function finiteOptional(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) throw new ReplayValidationError([`${label} must be finite`]);
  return value;
}

function controlFor(formatId: string, button: number): ReplayControl {
  if (button === 1) return { kind: 'jump' };
  if (button === 2) return { kind: 'left' };
  if (button === 3) return { kind: 'right' };
  return { kind: 'opaque', namespace: formatId, code: String(button) };
}

export async function buildImportedReplay(input: ImportedReplay) {
  const clock = rationalFromRate(input.ticksPerSecond);
  const pending: Array<{ tick: bigint; sequence: number; event: ReplayEventPayload }> = [];
  let sequence = 0;

  for (const item of input.inputs ?? []) {
    if (item.tick < 0n) throw new ReplayValidationError(['Input frame cannot be negative']);
    pending.push({
      tick: item.tick,
      sequence: sequence++,
      event: {
        kind: 'input',
        player: item.player,
        control: controlFor(input.formatId, item.button),
        state: item.down ? 'press' : 'release',
      },
    });
    const x = finiteOptional(item.x, 'Player X position');
    const y = finiteOptional(item.y, 'Player Y position');
    const rotation = finiteOptional(item.rotation, 'Player rotation');
    if (x !== undefined || y !== undefined || rotation !== undefined) {
      pending.push({
        tick: item.tick,
        sequence: sequence++,
        event: { kind: 'player-state', player: item.player, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}), ...(rotation !== undefined ? { rotation } : {}) },
      });
    }
    if (item.extension) {
      pending.push({
        tick: item.tick,
        sequence: sequence++,
        event: { kind: 'extension', ...item.extension },
      });
    }
  }

  for (const item of input.playerStates ?? []) {
    if (item.tick < 0n) throw new ReplayValidationError(['Player-state frame cannot be negative']);
    const x = finiteOptional(item.x, 'Player X position');
    const y = finiteOptional(item.y, 'Player Y position');
    const rotation = finiteOptional(item.rotation, 'Player rotation');
    if (x === undefined && y === undefined && rotation === undefined) continue;
    pending.push({
      tick: item.tick,
      sequence: sequence++,
      event: { kind: 'player-state', player: item.player, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}), ...(rotation !== undefined ? { rotation } : {}) },
    });
  }

  for (const item of input.extraEvents ?? []) {
    if (item.tick < 0n) throw new ReplayValidationError(['Replay event frame cannot be negative']);
    const { tick, ...event } = item;
    pending.push({ tick, sequence: sequence++, event });
  }

  if (pending.length > MAX_IMPORTED_EVENTS) {
    throw new ReplayValidationError([`Replay contains more than ${MAX_IMPORTED_EVENTS.toLocaleString('en-US')} canonical events`]);
  }

  pending.sort((left, right) => left.tick < right.tick ? -1 : left.tick > right.tick ? 1 : left.sequence - right.sequence);
  const events = pending.map(({ tick, event }, order) => ({
    ...event,
    tick: String(tick) as UIntString,
    order,
  })) as ReplayEvent[];
  const lastTick = pending.length ? pending[pending.length - 1]!.tick : 0n;
  const durationTicks = input.durationTicks && input.durationTicks > lastTick ? input.durationTicks : lastTick;
  const sourceHash = await sha256Hex(input.bytes);

  const replay: CanonicalReplayV1 = {
    schema: 'macrohub/replay',
    schemaVersion: 1,
    source: { formatId: input.formatId, parserVersion: input.parserVersion, sha256: sourceHash },
    clock: { ticksPerSecond: clock },
    level: {
      ...(input.levelId ? { id: { value: input.levelId, provenance: { kind: 'source-file' as const } } } : {}),
      ...(input.levelName ? { name: { value: input.levelName, provenance: { kind: 'source-file' as const } } } : {}),
    },
    recording: {
      ...(input.replayVersion ? { replayVersion: { value: input.replayVersion, provenance: { kind: 'source-file' as const } } } : {}),
      ...(input.geometryDashVersion ? { geometryDashVersion: { value: input.geometryDashVersion, provenance: { kind: 'source-file' as const } } } : {}),
      declaredRate: { value: { kind: 'tps', value: clock }, provenance: { kind: 'source-file' } },
      ...(input.completionPercent !== undefined ? { completionPercent: { value: input.completionPercent, provenance: { kind: 'source-file' as const } } } : {}),
    },
    durationTicks: String(durationTicks) as UIntString,
    events,
    ...(input.extensions && Object.keys(input.extensions).length ? { extensions: input.extensions } : {}),
  };

  return { replay: validateCanonicalReplay(replay), diagnostics: input.diagnostics ?? [] };
}

export function asObject(value: unknown, label = 'value'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReplayValidationError([`${label} must be an object`]);
  }
  return value as Record<string, unknown>;
}

export function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new ReplayValidationError([`${label} must be an array`]);
  return value;
}

export function asFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ReplayValidationError([`${label} must be a finite number`]);
  }
  return value;
}

export function asInteger(value: unknown, label: string, minimum = 0): number {
  const number = asFiniteNumber(value, label);
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new ReplayValidationError([`${label} must be a safe integer of at least ${minimum}`]);
  }
  return number;
}

export function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new ReplayValidationError([`${label} must be a boolean`]);
  return value;
}

export function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new ReplayValidationError([`${label} must be a string`]);
  return value;
}

export function optionalFiniteNumber(value: unknown, label: string): number | undefined {
  return value === undefined || value === null ? undefined : asFiniteNumber(value, label);
}

export function optionalBoolean(value: unknown, label: string): boolean | undefined {
  return value === undefined || value === null ? undefined : asBoolean(value, label);
}

export function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined || value === null ? undefined : asString(value, label);
}

export function toJsonValue(value: unknown, label = 'extension value', depth = 0): JsonValue {
  if (depth > 32) throw new ReplayValidationError([`${label} is nested too deeply`]);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ReplayValidationError([`${label} contains a non-finite number`]);
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) {
    if (value.byteLength > 65_536) throw new ReplayValidationError([`${label} contains more than 64 KiB of binary data`]);
    return { bytes: Array.from(value) };
  }
  if (Array.isArray(value)) return value.map((item, index) => toJsonValue(item, `${label}[${index}]`, depth + 1));
  if (value && typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      result[key] = toJsonValue(item, `${label}.${key}`, depth + 1);
    }
    return result;
  }
  throw new ReplayValidationError([`${label} contains an unsupported value`]);
}

export function parseUtf8Json(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ReplayValidationError(['Replay is not valid UTF-8 JSON']);
  }
}

export function looksLikeJson(bytes: Uint8Array): boolean {
  const prefix = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 128)).trimStart();
  return prefix.startsWith('{') || prefix.startsWith('[');
}

export class ReplayBinaryReader {
  private readonly view: DataView;
  private cursor: number;

  constructor(private readonly bytes: Uint8Array, offset = 0) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.cursor = offset;
    if (offset < 0 || offset > bytes.byteLength) throw new ReplayValidationError(['Binary replay offset is out of bounds']);
  }

  get position() { return this.cursor; }
  get length() { return this.bytes.byteLength; }
  get remaining() { return this.length - this.cursor; }

  seek(position: number) {
    if (!Number.isSafeInteger(position) || position < 0 || position > this.length) {
      throw new ReplayValidationError(['Binary replay seek is out of bounds']);
    }
    this.cursor = position;
  }

  skip(length: number) { this.seek(this.cursor + length); }

  private require(length: number) {
    if (!Number.isSafeInteger(length) || length < 0 || this.cursor + length > this.length) {
      throw new ReplayValidationError(['Replay file is truncated or declares an invalid block size']);
    }
  }

  readBytes(length: number): Uint8Array {
    this.require(length);
    const result = this.bytes.slice(this.cursor, this.cursor + length);
    this.cursor += length;
    return result;
  }

  peekBytes(length: number): Uint8Array {
    this.require(length);
    return this.bytes.slice(this.cursor, this.cursor + length);
  }

  readU8() { this.require(1); return this.bytes[this.cursor++]!; }
  readI8() { const value = this.readU8(); return value > 0x7f ? value - 0x100 : value; }
  readBool() { const value = this.readU8(); if (value > 1) throw new ReplayValidationError(['Replay boolean must be encoded as 0 or 1']); return value === 1; }
  readU16LE() { this.require(2); const value = this.view.getUint16(this.cursor, true); this.cursor += 2; return value; }
  readU16BE() { this.require(2); const value = this.view.getUint16(this.cursor, false); this.cursor += 2; return value; }
  readI16LE() { this.require(2); const value = this.view.getInt16(this.cursor, true); this.cursor += 2; return value; }
  readU32LE() { this.require(4); const value = this.view.getUint32(this.cursor, true); this.cursor += 4; return value; }
  readU32BE() { this.require(4); const value = this.view.getUint32(this.cursor, false); this.cursor += 4; return value; }
  readI32LE() { this.require(4); const value = this.view.getInt32(this.cursor, true); this.cursor += 4; return value; }
  readF32LE() { this.require(4); const value = this.view.getFloat32(this.cursor, true); this.cursor += 4; return value; }
  readF64LE() { this.require(8); const value = this.view.getFloat64(this.cursor, true); this.cursor += 8; return value; }
  readU64LE() { this.require(8); const value = this.view.getBigUint64(this.cursor, true); this.cursor += 8; return value; }
  readI64LE() { this.require(8); const value = this.view.getBigInt64(this.cursor, true); this.cursor += 8; return value; }
  readU64BE() { this.require(8); const value = this.view.getBigUint64(this.cursor, false); this.cursor += 8; return value; }

  readCString(maxBytes = MAX_IMPORTED_STRING_BYTES): string {
    const start = this.cursor;
    const maximum = Math.min(this.length, start + maxBytes + 1);
    while (this.cursor < maximum && this.bytes[this.cursor] !== 0) this.cursor += 1;
    if (this.cursor >= maximum || this.cursor >= this.length) {
      throw new ReplayValidationError(['Replay contains an unterminated or oversized string']);
    }
    const raw = this.bytes.slice(start, this.cursor);
    this.cursor += 1;
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      throw new ReplayValidationError(['Replay contains invalid UTF-8 text']);
    }
  }

  readUtf8(length: number): string {
    if (length > MAX_IMPORTED_STRING_BYTES) throw new ReplayValidationError(['Replay string exceeds 1 MiB']);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(this.readBytes(length));
    } catch {
      throw new ReplayValidationError(['Replay contains invalid UTF-8 text']);
    }
  }

  readVarUint(): bigint {
    let result = 0n;
    let shift = 0n;
    for (let index = 0; index < 10; index += 1) {
      const byte = this.readU8();
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
    }
    throw new ReplayValidationError(['Replay varint exceeds 64-bit bounds']);
  }
}

export function assertCount(count: number | bigint, label: string): number {
  const numeric = typeof count === 'bigint' ? Number(count) : count;
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > MAX_IMPORTED_EVENTS) {
    throw new ReplayValidationError([`${label} exceeds the supported event limit`]);
  }
  return numeric;
}

export function bytesStartWith(bytes: Uint8Array, signature: readonly number[] | Uint8Array): boolean {
  return signature.length <= bytes.length && Array.from(signature).every((byte, index) => bytes[index] === byte);
}

export function ascii(bytes: Uint8Array): string {
  return new TextDecoder('ascii').decode(bytes);
}
