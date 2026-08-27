import type { MacroExporter } from '../interfaces';
import type {
  CanonicalReplayV1,
  ConversionIssue,
  ExportAssessment,
  ReplayEvent,
  UIntString,
} from '../types';

export type InputEvent = Extract<ReplayEvent, { kind: 'input' }>;
export type PlayerStateEvent = Extract<ReplayEvent, { kind: 'player-state' }>;

export type RateEncoding = 'number' | 'f32' | 'integer-i16' | 'integer-i32' | 'fixed-240' | 'zbot';

export interface InputFormatAssessmentOptions {
  code: string;
  label: string;
  controls: 'jump' | 'all';
  rate: RateEncoding;
  maxFrame: bigint;
  playerStates?: 'forbid' | 're3';
  storesDuration?: boolean;
  storesLevel?: boolean;
  orderRank?: (event: ReplayEvent) => number;
}

const MAX_UINT32 = 0xffff_ffffn;
const encoder = new TextEncoder();

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a || 1n;
}

export function rateKey(replay: CanonicalReplayV1): string {
  const numerator = BigInt(replay.clock.ticksPerSecond.numerator);
  const denominator = BigInt(replay.clock.ticksPerSecond.denominator);
  const divisor = gcd(numerator, denominator);
  return `${numerator / divisor}/${denominator / divisor}`;
}

export function parserRateKey(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) return null;
  const rounded = Math.round(value * 1_000_000);
  if (!Number.isSafeInteger(rounded) || rounded <= 0) return null;
  const numerator = BigInt(rounded);
  const denominator = 1_000_000n;
  const divisor = gcd(numerator, denominator);
  return `${numerator / divisor}/${denominator / divisor}`;
}

export function replayRate(replay: CanonicalReplayV1): number {
  return Number(BigInt(replay.clock.ticksPerSecond.numerator))
    / Number(BigInt(replay.clock.ticksPerSecond.denominator));
}

export function asFloat32(value: number): number {
  return new Float32Array([value])[0]!;
}

function float32Bits(value: number): number {
  const bytes = new ArrayBuffer(4);
  const view = new DataView(bytes);
  view.setFloat32(0, value, true);
  return view.getUint32(0, true);
}

function float32FromBits(value: number): number {
  const bytes = new ArrayBuffer(4);
  const view = new DataView(bytes);
  view.setUint32(0, value >>> 0, true);
  return view.getFloat32(0, true);
}

export function zbotTimingPair(rate: number): { delta: number; speedhack: number; restoredRate: number } | null {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const baseDeltaBits = float32Bits(asFloat32(1 / rate));
  let best: { delta: number; speedhack: number; restoredRate: number; error: number } | null = null;
  for (let deltaOffset = -512; deltaOffset <= 512; deltaOffset += 1) {
    const deltaBits = baseDeltaBits + deltaOffset;
    if (deltaBits <= 0 || deltaBits >= 0x7f80_0000) continue;
    const delta = float32FromBits(deltaBits);
    const baseSpeedBits = float32Bits(asFloat32((1 / delta) / rate));
    for (let speedOffset = -4; speedOffset <= 4; speedOffset += 1) {
      const speedBits = baseSpeedBits + speedOffset;
      if (speedBits <= 0 || speedBits >= 0x7f80_0000) continue;
      const speedhack = float32FromBits(speedBits);
      const restoredRate = (1 / delta) / speedhack;
      const error = Math.abs(restoredRate - rate);
      if (!best || error < best.error) best = { delta, speedhack, restoredRate, error };
      if (error < 0.0000005) return { delta, speedhack, restoredRate };
    }
  }
  return best && best.error < 0.0000005
    ? { delta: best.delta, speedhack: best.speedhack, restoredRate: best.restoredRate }
    : null;
}

export function inputEvents(replay: CanonicalReplayV1): InputEvent[] {
  return replay.events.filter((event): event is InputEvent => event.kind === 'input');
}

export function playerStateEvents(replay: CanonicalReplayV1): PlayerStateEvent[] {
  return replay.events.filter((event): event is PlayerStateEvent => event.kind === 'player-state');
}

export function controlButton(event: InputEvent): 1 | 2 | 3 | null {
  if (event.control.kind === 'jump') return 1;
  if (event.control.kind === 'left') return 2;
  if (event.control.kind === 'right') return 3;
  return null;
}

export function effectiveDuration(replay: CanonicalReplayV1): bigint {
  const last = replay.events.reduce((maximum, event) => {
    const tick = BigInt(event.tick);
    return tick > maximum ? tick : maximum;
  }, 0n);
  if (replay.durationTicks === undefined) return last;
  const declared = BigInt(replay.durationTicks);
  return declared > last ? declared : last;
}

export function safeBaseName(replay: CanonicalReplayV1): string {
  return (replay.level.name?.value ?? replay.level.id?.value ?? 'macro')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'macro';
}

function representationRate(replay: CanonicalReplayV1, encoding: RateEncoding): number | null {
  const rate = replayRate(replay);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (encoding === 'fixed-240') return rateKey(replay) === '240/1' ? 240 : null;
  if (encoding === 'integer-i16') return Number.isInteger(rate) && rate <= 32_767 ? rate : null;
  if (encoding === 'integer-i32') return Number.isInteger(rate) && rate <= 2_147_483_647 ? rate : null;
  if (encoding === 'f32') return asFloat32(rate);
  if (encoding === 'zbot') return zbotTimingPair(rate)?.restoredRate ?? null;
  return rate;
}

function orderCanRoundTrip(replay: CanonicalReplayV1, rank: (event: ReplayEvent) => number): boolean {
  let lastTick: string | null = null;
  let lastRank = -1;
  for (const event of replay.events) {
    if (event.kind !== 'input' && event.kind !== 'player-state') continue;
    if (event.tick !== lastTick) {
      lastTick = event.tick;
      lastRank = -1;
    }
    const currentRank = rank(event);
    if (currentRank < lastRank) return false;
    lastRank = currentRank;
  }
  return true;
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

function blocked(code: string, category: ConversionIssue['category'], message: string): ExportAssessment {
  return { decision: 'blocked', issues: [{ code, severity: 'error', category, message }] };
}

export function assessInputFormat(
  replay: CanonicalReplayV1,
  options: InputFormatAssessmentOptions,
): ExportAssessment {
  const encodedRate = representationRate(replay, options.rate);
  if (encodedRate === null || parserRateKey(encodedRate) !== rateKey(replay)) {
    return blocked(
      `${options.code}_RATE_UNREPRESENTABLE`,
      'timing-loss',
      `${options.label} cannot represent this replay rate without changing input timing.`,
    );
  }

  for (const event of replay.events) {
    const tick = BigInt(event.tick);
    if (tick > options.maxFrame) {
      return blocked(
        `${options.code}_FRAME_OUT_OF_RANGE`,
        'timing-loss',
        `${options.label} cannot represent one or more replay frames.`,
      );
    }
    if (event.kind === 'input') {
      const button = controlButton(event);
      if (!button || (options.controls === 'jump' && button !== 1)) {
        return blocked(
          `${options.code}_CONTROL_UNSUPPORTED`,
          'gameplay-loss',
          `${options.label} cannot represent one or more gameplay buttons in this replay.`,
        );
      }
    } else if (event.kind === 'player-state') {
      if (options.playerStates !== 're3') {
        return blocked(
          `${options.code}_PLAYER_STATE_UNSUPPORTED`,
          'gameplay-loss',
          `${options.label} cannot safely preserve the replay's position or rotation corrections.`,
        );
      }
      if (event.x === undefined || event.y === undefined || event.rotation === undefined
        || asFloat32(event.x) !== event.x || asFloat32(event.y) !== event.y || asFloat32(event.rotation) !== event.rotation) {
        return blocked(
          `${options.code}_PLAYER_STATE_PRECISION`,
          'gameplay-loss',
          `${options.label} cannot preserve a player-state correction exactly.`,
        );
      }
    } else if (event.kind === 'death' || event.kind === 'checkpoint') {
      return blocked(
        `${options.code}_GAMEPLAY_EVENT_UNSUPPORTED`,
        'gameplay-loss',
        `${options.label} cannot preserve this replay's death or checkpoint events.`,
      );
    } else if (event.kind === 'extension' && event.critical) {
      return blocked(
        `${options.code}_CRITICAL_EXTENSION`,
        'extension-loss',
        `${options.label} cannot preserve a gameplay-critical format extension.`,
      );
    }
  }

  if (options.orderRank && !orderCanRoundTrip(replay, options.orderRank)) {
    return blocked(
      `${options.code}_SAME_TICK_ORDER`,
      'timing-loss',
      `${options.label} cannot preserve the order of same-frame events in this replay.`,
    );
  }

  const issues: ConversionIssue[] = [];
  const hasOptionalExtensionEvents = replay.events.some((event) => event.kind === 'extension' && !event.critical);
  const hasContainerMetadata = Boolean(replay.extensions && Object.keys(replay.extensions).length);
  const hasLevelMetadata = !options.storesLevel && Boolean(replay.level.id || replay.level.name);
  const hasRecordingMetadata = Boolean(
    replay.recording.replayVersion
    || replay.recording.geometryDashVersion
    || replay.recording.completionPercent,
  );
  const lastEvent = replay.events.reduce((maximum, event) => {
    const tick = BigInt(event.tick);
    return tick > maximum ? tick : maximum;
  }, 0n);
  const hasExtraDuration = !options.storesDuration
    && replay.durationTicks !== undefined
    && BigInt(replay.durationTicks) > lastEvent;
  if (hasOptionalExtensionEvents || hasContainerMetadata || hasLevelMetadata || hasRecordingMetadata || hasExtraDuration) {
    issues.push(warning(
      `${options.code}_OPTIONAL_METADATA_REMOVED`,
      `${options.label} keeps the gameplay inputs, but some optional replay metadata is not part of this file format.`,
    ));
  }
  return {
    decision: 'allowed',
    fidelity: issues.length ? 'metadata-loss' : 'compatible',
    issues,
  };
}

function inputSignature(replay: CanonicalReplayV1): string[] {
  return inputEvents(replay).map((event) => {
    const button = controlButton(event);
    return `${event.tick}:${event.player}:${button ?? 'opaque'}:${event.state}`;
  });
}

function stateSignature(replay: CanonicalReplayV1): string[] {
  return playerStateEvents(replay).map((event) => (
    `${event.tick}:${event.player}:${event.x ?? ''}:${event.y ?? ''}:${event.rotation ?? ''}`
  ));
}

export function verifyInputRoundTrip(
  source: CanonicalReplayV1,
  reparsed: CanonicalReplayV1,
  options: { playerStates?: boolean } = {},
): ConversionIssue[] {
  const issues: ConversionIssue[] = [];
  if (rateKey(source) !== rateKey(reparsed)) {
    issues.push({
      code: 'ROUND_TRIP_RATE_MISMATCH',
      severity: 'error',
      category: 'timing-loss',
      message: 'The generated replay changed its effective replay rate.',
    });
  }
  if (JSON.stringify(inputSignature(source)) !== JSON.stringify(inputSignature(reparsed))) {
    issues.push({
      code: 'ROUND_TRIP_INPUT_MISMATCH',
      severity: 'error',
      category: 'gameplay-loss',
      message: 'The generated replay changed one or more gameplay inputs.',
    });
  }
  if (options.playerStates && JSON.stringify(stateSignature(source)) !== JSON.stringify(stateSignature(reparsed))) {
    issues.push({
      code: 'ROUND_TRIP_PLAYER_STATE_MISMATCH',
      severity: 'error',
      category: 'gameplay-loss',
      message: 'The generated replay changed one or more player-state corrections.',
    });
  }
  return issues;
}

export function makeExporter(
  implementationVersion: string,
  assess: MacroExporter['assess'],
  exportReplay: MacroExporter['export'],
  verifyRoundTrip: NonNullable<MacroExporter['verifyRoundTrip']> = verifyInputRoundTrip,
): MacroExporter {
  return { implementationVersion, assess, export: exportReplay, verifyRoundTrip };
}

export function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

export class ReplayBinaryWriter {
  private buffer = new Uint8Array(1_024);
  private view = new DataView(this.buffer.buffer);
  private cursor = 0;

  get length() { return this.cursor; }

  private ensure(extra: number) {
    const needed = this.cursor + extra;
    if (needed <= this.buffer.length) return;
    let length = this.buffer.length;
    while (length < needed) length *= 2;
    const next = new Uint8Array(length);
    next.set(this.buffer);
    this.buffer = next;
    this.view = new DataView(next.buffer);
  }

  writeBytes(bytes: Uint8Array | readonly number[]) {
    this.ensure(bytes.length);
    this.buffer.set(bytes, this.cursor);
    this.cursor += bytes.length;
  }

  writeU8(value: number) { this.ensure(1); this.view.setUint8(this.cursor, value); this.cursor += 1; }
  writeU16LE(value: number) { this.ensure(2); this.view.setUint16(this.cursor, value, true); this.cursor += 2; }
  writeI16LE(value: number) { this.ensure(2); this.view.setInt16(this.cursor, value, true); this.cursor += 2; }
  writeU32LE(value: number) { this.ensure(4); this.view.setUint32(this.cursor, value, true); this.cursor += 4; }
  writeI32LE(value: number) { this.ensure(4); this.view.setInt32(this.cursor, value, true); this.cursor += 4; }
  writeF32LE(value: number) { this.ensure(4); this.view.setFloat32(this.cursor, value, true); this.cursor += 4; }
  writeF64LE(value: number) { this.ensure(8); this.view.setFloat64(this.cursor, value, true); this.cursor += 8; }
  writeU64LE(value: bigint) { this.ensure(8); this.view.setBigUint64(this.cursor, value, true); this.cursor += 8; }
  writeI64LE(value: bigint) { this.ensure(8); this.view.setBigInt64(this.cursor, value, true); this.cursor += 8; }

  writeVarUint(input: bigint | number) {
    let value = typeof input === 'number' ? BigInt(input) : input;
    if (value < 0n) throw new Error('Cannot encode a negative unsigned varint');
    do {
      let byte = Number(value & 0x7fn);
      value >>= 7n;
      if (value > 0n) byte |= 0x80;
      this.writeU8(byte);
    } while (value > 0n);
  }

  writeVarInt(value: bigint) {
    this.writeVarUint((value << 1n) ^ (value >> 63n));
  }

  writeLengthPrefixedString(value: string) {
    const bytes = encoder.encode(value);
    this.writeVarUint(bytes.length);
    this.writeBytes(bytes);
  }

  finish(): Uint8Array { return this.buffer.slice(0, this.cursor); }
}

export function checkedFrame(event: ReplayEvent, maximum = MAX_UINT32): number {
  const tick = BigInt(event.tick);
  if (tick < 0n || tick > maximum) throw new Error('Replay frame is outside the target format range');
  return Number(tick);
}

export function uintString(value: bigint): UIntString {
  return value.toString() as UIntString;
}
