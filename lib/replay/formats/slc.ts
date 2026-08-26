import type { MacroParser } from '../interfaces';
import { ReplayValidationError } from '../schema';
import type { ImportedExtraEvent, ImportedInput } from './import-utils';
import {
  MAX_IMPORTED_EVENTS,
  ReplayBinaryReader,
  buildImportedReplay,
  bytesStartWith,
} from './import-utils';

const VERSION = '1.0.0';
const SILL = [0x53, 0x49, 0x4c, 0x4c] as const;
const SLC3 = [0x53, 0x4c, 0x43, 0x33, 0x52, 0x50, 0x4c, 0x59] as const;

function rate(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) throw new ReplayValidationError(['SLC tick rate is invalid']);
  return value;
}

function count(value: number | bigint, label: string): number {
  const number = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < 0 || number > MAX_IMPORTED_EVENTS) throw new ReplayValidationError([`${label} exceeds safe parsing bounds`]);
  return number;
}

function readLittleWidth(reader: ReplayBinaryReader, width: number): bigint {
  if (![1, 2, 4, 8].includes(width)) throw new ReplayValidationError(['SLC integer width is invalid']);
  const bytes = reader.readBytes(width);
  let value = 0n;
  for (let index = 0; index < bytes.length; index += 1) value |= BigInt(bytes[index]!) << BigInt(index * 8);
  return value;
}

function pushSpecial(extraEvents: ImportedExtraEvent[], tick: bigint, code: number, seed?: bigint, tps?: number) {
  if (code === 2) {
    extraEvents.push({ tick, kind: 'death' });
  } else {
    extraEvents.push({
      tick,
      kind: 'extension',
      namespace: 'slc',
      eventType: code === 0 ? 'restart' : code === 1 ? 'full-restart' : 'tps-change',
      critical: true,
      payload: code === 3 ? { tps: tps! } : { seed: seed!.toString() },
    });
  }
}

async function parseSlc1(bytes: Uint8Array) {
  const reader = new ReplayBinaryReader(bytes);
  if (reader.length < 12) throw new ReplayValidationError(['SLC v1 header is truncated']);
  const ticksPerSecond = rate(reader.readF64LE());
  const actionCount = count(reader.readU32LE(), 'SLC v1 input count');
  const expected = 12 + actionCount * 4;
  if (reader.length !== expected && reader.length !== expected + 8) throw new ReplayValidationError(['SLC v1 input table does not match the file length']);
  const inputs: ImportedInput[] = [];
  for (let index = 0; index < actionCount; index += 1) {
    const packed = reader.readU32LE();
    const button = (packed >> 1) & 3;
    if (button < 1 || button > 3) throw new ReplayValidationError([`SLC v1 input ${index} has an invalid button`]);
    inputs.push({ tick: BigInt(packed >>> 4), player: (packed & 8) !== 0 ? 2 : 1, button, down: (packed & 1) !== 0 });
  }
  const seed = reader.remaining === 8 ? reader.readU64LE() : undefined;
  return buildImportedReplay({
    formatId: 'slc', parserVersion: VERSION, bytes, ticksPerSecond, replayVersion: '1', inputs,
    ...(seed !== undefined ? { extensions: { 'slc/seed': seed.toString() } } : {}),
  });
}

function parseSlc2State(reader: ReplayBinaryReader, width: number, frame: bigint, inputs: ImportedInput[], extraEvents: ImportedExtraEvent[]): bigint {
  const state = readLittleWidth(reader, width);
  const nextFrame = frame + (state >> 5n);
  if (nextFrame > BigInt(Number.MAX_SAFE_INTEGER)) throw new ReplayValidationError(['SLC frame exceeds safe parsing bounds']);
  const code = Number((state >> 2n) & 7n);
  if (code >= 1 && code <= 3) {
    inputs.push({ tick: nextFrame, player: (state & 2n) !== 0n ? 2 : 1, button: code, down: (state & 1n) !== 0n });
  } else if (code >= 4 && code <= 6) {
    pushSpecial(extraEvents, nextFrame, code - 4, 0n);
  } else if (code === 7) {
    const nextRate = rate(reader.readF64LE());
    pushSpecial(extraEvents, nextFrame, 3, undefined, nextRate);
  }
  return nextFrame;
}

async function parseSlc2(bytes: Uint8Array) {
  if (!bytesStartWith(bytes, SILL)) throw new ReplayValidationError(['SLC v2 header is missing']);
  const reader = new ReplayBinaryReader(bytes, 4);
  const ticksPerSecond = rate(reader.readF64LE());
  const metaSize = count(reader.readU64LE(), 'SLC v2 metadata size');
  if (metaSize !== 64) throw new ReplayValidationError(['SLC v2 metadata must be exactly 64 bytes']);
  const meta = new ReplayBinaryReader(reader.readBytes(metaSize));
  const seed = meta.readU64LE();
  const inputCount = count(reader.readU64LE(), 'SLC v2 input count');
  const blobCount = count(reader.readU64LE(), 'SLC v2 blob count');
  const blobs: Array<{ width: number; start: number; length: number }> = [];
  let describedInputs = 0;
  for (let index = 0; index < blobCount; index += 1) {
    const width = Number(reader.readU64LE());
    const start = count(reader.readU64LE(), `SLC v2 blob ${index} start`);
    const length = count(reader.readU64LE(), `SLC v2 blob ${index} length`);
    if (![1, 2, 4, 8].includes(width) || start !== describedInputs || describedInputs + length > MAX_IMPORTED_EVENTS) {
      throw new ReplayValidationError([`SLC v2 blob ${index} has invalid bounds`]);
    }
    describedInputs += length;
    blobs.push({ width, start, length });
  }
  if (describedInputs !== inputCount) throw new ReplayValidationError(['SLC v2 blob lengths do not match the declared input count']);
  const inputs: ImportedInput[] = [];
  const extraEvents: ImportedExtraEvent[] = [];
  let frame = 0n;
  for (const blob of blobs) {
    for (let index = 0; index < blob.length; index += 1) frame = parseSlc2State(reader, blob.width, frame, inputs, extraEvents);
  }
  if (reader.remaining !== 3 || reader.readUtf8(3) !== 'EOM') throw new ReplayValidationError(['SLC v2 footer is missing or trailing data is present']);
  return buildImportedReplay({ formatId: 'slc', parserVersion: VERSION, bytes, ticksPerSecond, replayVersion: '2', inputs, extraEvents, extensions: { 'slc/seed': seed.toString() } });
}

interface Slc3Collector {
  inputs: ImportedInput[];
  extraEvents: ImportedExtraEvent[];
  frame: bigint;
  decoded: number;
}

function emitSlc3State(state: bigint, collector: Slc3Collector) {
  collector.frame += state >> 4n;
  if (collector.frame > BigInt(Number.MAX_SAFE_INTEGER)) throw new ReplayValidationError(['SLC v3 frame exceeds safe parsing bounds']);
  const button = Number((state >> 2n) & 3n);
  const player = (state & 2n) !== 0n ? 2 : 1;
  const down = (state & 1n) !== 0n;
  if (button === 0) {
    collector.inputs.push({ tick: collector.frame, player, button: 1, down: true }, { tick: collector.frame, player, button: 1, down: false });
    collector.decoded += 2;
  } else {
    collector.inputs.push({ tick: collector.frame, player, button, down });
    collector.decoded += 1;
  }
  if (collector.decoded > MAX_IMPORTED_EVENTS) throw new ReplayValidationError(['SLC v3 contains too many actions']);
}

function parseSlc3ActionPayload(reader: ReplayBinaryReader, declaredActions: number): Slc3Collector {
  const collector: Slc3Collector = { inputs: [], extraEvents: [], frame: 0n, decoded: 0 };
  while (collector.decoded < declaredActions) {
    const header = reader.readU16LE();
    const section = header >>> 14;
    if (section === 3) throw new ReplayValidationError(['SLC v3 contains an invalid section type']);
    if (section <= 1) {
      const width = 1 << ((header >>> 12) & 3);
      const stateCount = 1 << ((header >>> 8) & 15);
      const repeats = section === 1 ? 2 ** ((header >>> 3) & 31) : 1;
      if (stateCount * repeats > MAX_IMPORTED_EVENTS || collector.decoded + stateCount * repeats > MAX_IMPORTED_EVENTS) {
        throw new ReplayValidationError(['SLC v3 repeat section exceeds safe expansion bounds']);
      }
      const pattern: bigint[] = [];
      for (let index = 0; index < stateCount; index += 1) pattern.push(readLittleWidth(reader, width));
      for (let repeat = 0; repeat < repeats; repeat += 1) {
        for (const state of pattern) emitSlc3State(state, collector);
      }
    } else {
      const special = (header >>> 10) & 15;
      const width = 1 << ((header >>> 8) & 3);
      if (special > 3) throw new ReplayValidationError(['SLC v3 contains an unknown special action']);
      collector.frame += readLittleWidth(reader, width);
      if (collector.frame > BigInt(Number.MAX_SAFE_INTEGER)) throw new ReplayValidationError(['SLC v3 frame exceeds safe parsing bounds']);
      if (special === 3) pushSpecial(collector.extraEvents, collector.frame, 3, undefined, rate(reader.readF64LE()));
      else pushSpecial(collector.extraEvents, collector.frame, special, reader.readU64LE());
      collector.decoded += 1;
    }
  }
  if (collector.decoded !== declaredActions) throw new ReplayValidationError(['SLC v3 section expansion does not match its declared action count']);
  return collector;
}

async function parseSlc3(bytes: Uint8Array) {
  if (!bytesStartWith(bytes, SLC3)) throw new ReplayValidationError(['SLC v3 header is missing']);
  if (bytes.at(-1) !== 0xcc) throw new ReplayValidationError(['SLC v3 footer is missing']);
  const reader = new ReplayBinaryReader(bytes, 8);
  const metaSize = reader.readU16LE();
  if (metaSize !== 64) throw new ReplayValidationError(['SLC v3 metadata must be exactly 64 bytes']);
  const ticksPerSecond = rate(reader.readF64LE());
  const seed = reader.readU64LE();
  const replayVersion = reader.readU32LE();
  const build = reader.readU32LE();
  reader.skip(40);
  const inputs: ImportedInput[] = [];
  const extraEvents: ImportedExtraEvent[] = [];
  while (reader.remaining > 1) {
    const atomId = reader.readU32LE();
    const payloadSizeBig = reader.readU64LE();
    const payloadSize = Number(payloadSizeBig);
    if (!Number.isSafeInteger(payloadSize) || payloadSize < 0 || payloadSize > reader.remaining - 1) {
      if (!(atomId === 1 && payloadSize === 0)) throw new ReplayValidationError(['SLC v3 atom size is invalid']);
    }
    if (atomId === 1) {
      const start = reader.position;
      const declaredActions = count(reader.readU64LE(), 'SLC v3 action count');
      const parsed = parseSlc3ActionPayload(reader, declaredActions);
      if (payloadSize !== 0 && reader.position - start !== payloadSize) throw new ReplayValidationError(['SLC v3 action atom did not consume its declared payload']);
      inputs.push(...parsed.inputs);
      extraEvents.push(...parsed.extraEvents);
    } else if (atomId === 0 || atomId === 2) {
      reader.skip(payloadSize);
    } else {
      throw new ReplayValidationError(['SLC v3 contains an unknown atom type']);
    }
    if (inputs.length + extraEvents.length > MAX_IMPORTED_EVENTS) throw new ReplayValidationError(['SLC v3 contains too many canonical events']);
  }
  if (reader.remaining !== 1 || reader.readU8() !== 0xcc) throw new ReplayValidationError(['SLC v3 footer is invalid']);
  return buildImportedReplay({
    formatId: 'slc', parserVersion: VERSION, bytes, ticksPerSecond, replayVersion: String(replayVersion), inputs, extraEvents,
    extensions: { 'slc/v3-metadata': { seed: seed.toString(), build } },
  });
}

export const slcParser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) {
    if (bytesStartWith(input.bytes, SLC3)) return { confidence: 'exact', reason: 'SLC v3 header found' };
    if (bytesStartWith(input.bytes, SILL)) return { confidence: 'exact', reason: 'SLC v2 header found' };
    if (!/\.slc$/i.test(input.filename)) return { confidence: 'none', reason: 'Not an SLC filename' };
    try { await parseSlc1(input.bytes); return { confidence: 'exact', reason: 'Valid SLC v1 action table' }; }
    catch { return { confidence: 'possible', reason: 'SLC extension found, but no supported SLC layout matched' }; }
  },
  async parse(input) {
    if (bytesStartWith(input.bytes, SLC3)) return parseSlc3(input.bytes);
    if (bytesStartWith(input.bytes, SILL)) return parseSlc2(input.bytes);
    return parseSlc1(input.bytes);
  },
};
