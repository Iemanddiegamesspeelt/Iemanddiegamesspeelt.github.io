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
const TCM_MAGIC = [0x9f, 0x88, 0x89, 0x84, 0x9f, 0x3b, 0x1d, 0xd8, 0xcc, 0xa1, 0x86, 0x8a, 0x88, 0x99, 0x84, 0x00] as const;

function positiveRate(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) throw new ReplayValidationError(['TCM tick rate is invalid']);
  return value;
}

function u32Varint(reader: ReplayBinaryReader): number {
  const value = reader.readVarUint();
  if (value > 0xffff_ffffn) throw new ReplayValidationError(['TCM varint exceeds 32-bit bounds']);
  return Number(value);
}

function emitRestart(extraEvents: ImportedExtraEvent[], frame: bigint, type: number, seed?: bigint) {
  if (type === 2) extraEvents.push({ tick: frame, kind: 'death' });
  else extraEvents.push({ tick: frame, kind: 'extension', namespace: 'tcm', eventType: type === 0 ? 'restart' : 'full-restart', critical: true, payload: seed === undefined ? {} : { seed: seed.toString() } });
}

function parseV1(reader: ReplayBinaryReader, inputs: ImportedInput[], extraEvents: ImportedExtraEvent[]) {
  const inputCount = u32Varint(reader);
  if (inputCount > MAX_IMPORTED_EVENTS) throw new ReplayValidationError(['TCM v1 contains too many inputs']);
  for (let index = 0; index < inputCount; index += 1) {
    const frame = BigInt(u32Varint(reader));
    const action = reader.readU8();
    const type = action & 7;
    if ((action & 0x38) !== 0 || type > 5) throw new ReplayValidationError([`TCM v1 input ${index} is invalid`]);
    if (type < 3) inputs.push({ tick: frame, player: (action & 0x40) !== 0 ? 2 : 1, button: type + 1, down: (action & 0x80) !== 0 });
    else emitRestart(extraEvents, frame, type - 3);
  }
  if (reader.remaining === 1 && reader.readU8() === 0xcc) return;
  if (reader.remaining !== 0) throw new ReplayValidationError(['TCM v1 contains trailing data']);
}

function deltaWidth(descriptor: number): number {
  return [0, 1, 2, 4][descriptor >>> 1]!;
}

function readDelta(reader: ReplayBinaryReader, descriptor: number, lastDelta: bigint): bigint {
  const width = deltaWidth(descriptor);
  const value = width === 0 ? 0n : (() => {
    const bytes = reader.readBytes(width);
    let result = 0n;
    for (let index = 0; index < bytes.length; index += 1) result |= BigInt(bytes[index]!) << BigInt(index * 8);
    return result;
  })();
  return ((descriptor & 1) !== 0 ? lastDelta : 0n) + value;
}

function parseV2(reader: ReplayBinaryReader, inputs: ImportedInput[], extraEvents: ImportedExtraEvent[]) {
  if (reader.remaining === 0) return;
  let frame = BigInt(u32Varint(reader));
  let lastDelta = 0n;
  let records = 0;
  while (reader.remaining > 0) {
    if (++records > MAX_IMPORTED_EVENTS) throw new ReplayValidationError(['TCM v2 contains too many records']);
    const action = reader.readU8();
    const button = action & 3;
    const descriptor = action >>> 5;
    if (button > 0) {
      const player = (action & 8) !== 0 ? 2 : 1;
      const down = (action & 4) !== 0;
      inputs.push({ tick: frame, player, button, down });
      if ((action & 0x10) !== 0) inputs.push({ tick: frame, player, button, down: !down });
    } else {
      const custom = (action >>> 2) & 3;
      const extra = (action & 0x10) !== 0;
      if (custom === 3) {
        if (extra) extraEvents.push({ tick: frame, kind: 'extension', namespace: 'tcm', eventType: 'bugpoint', critical: true, payload: {} });
        else extraEvents.push({ tick: frame, kind: 'extension', namespace: 'tcm', eventType: 'tps-change', critical: true, payload: { tps: positiveRate(reader.readF32LE()) } });
      } else {
        const seed = extra ? reader.readU64LE() : undefined;
        emitRestart(extraEvents, frame, custom, seed);
        frame = 0n;
      }
    }
    const delta = readDelta(reader, descriptor, lastDelta);
    if (delta !== 0n) lastDelta = delta;
    frame += delta;
    if (frame > 0xffff_ffffn) throw new ReplayValidationError(['TCM v2 frame exceeds 32-bit bounds']);
    if (inputs.length + extraEvents.length > MAX_IMPORTED_EVENTS) throw new ReplayValidationError(['TCM v2 contains too many canonical events']);
  }
}

async function parseTcm(bytes: Uint8Array) {
  if (!bytesStartWith(bytes, TCM_MAGIC)) throw new ReplayValidationError(['TCM header is missing']);
  if (bytes.byteLength < 80) throw new ReplayValidationError(['TCM metadata is truncated']);
  const reader = new ReplayBinaryReader(bytes, 16);
  const replayVersion = reader.readU8();
  const appendCounter = reader.readU8();
  const flags = reader.readU8();
  reader.readU8();
  const rateOrDelta = reader.readF32LE();
  const seed = reader.readU64LE();
  reader.skip(48);
  if (replayVersion !== 1 && replayVersion !== 2) throw new ReplayValidationError(['Only TCM v1 and v2 are supported']);
  if (replayVersion === 1 && flags !== 0) throw new ReplayValidationError(['TCM v1 reserved metadata is invalid']);
  const ticksPerSecond = positiveRate(replayVersion === 2 && (flags & 2) === 0 ? 1 / rateOrDelta : rateOrDelta);
  const inputs: ImportedInput[] = [];
  const extraEvents: ImportedExtraEvent[] = [];
  if (replayVersion === 1) parseV1(reader, inputs, extraEvents);
  else parseV2(reader, inputs, extraEvents);
  return buildImportedReplay({
    formatId: 'tcbot', parserVersion: VERSION, bytes, ticksPerSecond, replayVersion: String(replayVersion), inputs, extraEvents,
    extensions: { 'tcm/metadata': { appendCounter, flags, ...(replayVersion === 2 && (flags & 1) !== 0 && seed !== 0n ? { seed: seed.toString() } : {}) } },
  });
}

export const tcmParser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) { return bytesStartWith(input.bytes, TCM_MAGIC) ? { confidence: 'exact', reason: 'TCM header found' } : /\.tcm$/i.test(input.filename) ? { confidence: 'possible', reason: 'TCM extension found without a valid header' } : { confidence: 'none', reason: 'No TCM header' }; },
  async parse(input) { return parseTcm(input.bytes); },
};
