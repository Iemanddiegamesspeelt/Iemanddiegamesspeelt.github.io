import type { MacroParser } from '../interfaces';
import { ReplayValidationError } from '../schema';
import type { ImportedInput, ImportedPlayerState } from './import-utils';
import {
  MAX_IMPORTED_EVENTS,
  MAX_IMPORTED_STRING_BYTES,
  ReplayBinaryReader,
  buildImportedReplay,
  bytesStartWith,
  ticksFromSeconds,
} from './import-utils';

const VERSION = '1.0.0';
const BINARY_MAGIC = [0xd7, 0x8a, 0x3e, 0x91] as const;
const TEXT_MAGIC = [0x43, 0x4d, 0x4c, 0x00] as const;
const MAX_DECOMPRESSED_BYTES = 32 * 1024 * 1024;

class CmlReader {
  constructor(readonly reader: ReplayBinaryReader, readonly encodedStrings: boolean) {}

  readVarUint() { return this.reader.readVarUint(); }

  readVarInt(): bigint {
    const value = this.readVarUint();
    return (value >> 1n) ^ (-(value & 1n));
  }

  readLength(label: string, maximum = MAX_IMPORTED_EVENTS): number {
    const value = this.readVarUint();
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > maximum) throw new ReplayValidationError([`CML ${label} exceeds safe parsing bounds`]);
    return number;
  }

  readString(label: string): string {
    const length = this.readLength(`${label} length`, MAX_IMPORTED_STRING_BYTES);
    const bytes = this.reader.readBytes(length);
    if (this.encodedStrings) {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = bytes[index]! ^ CmlReader.stringKey(index);
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new ReplayValidationError([`CML ${label} is not valid UTF-8`]); }
  }

  private static stringKey(index: number): number {
    return (index * 0x3d + 0xa7 + Math.floor(index / 2) * 0x11) & 0xff;
  }
}

function finiteF32(reader: ReplayBinaryReader, label: string): number {
  const value = reader.readF32LE();
  if (!Number.isFinite(value)) throw new ReplayValidationError([`CML ${label} must be finite`]);
  return value;
}

async function gunzip(bytes: Uint8Array, declaredSize: number): Promise<Uint8Array> {
  if (declaredSize < 0 || declaredSize > MAX_DECOMPRESSED_BYTES) throw new ReplayValidationError(['CML decompressed body exceeds 32 MiB']);
  try {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    const result = new Uint8Array(await new Response(stream).arrayBuffer());
    if (result.byteLength !== declaredSize) throw new ReplayValidationError(['CML decompressed size does not match its header']);
    return result;
  } catch (error) {
    if (error instanceof ReplayValidationError) throw error;
    throw new ReplayValidationError(['CML gzip body is invalid']);
  }
}

function addChecked(value: bigint, delta: bigint, label: string): bigint {
  const result = value + delta;
  if (result < 0n || result > BigInt(Number.MAX_SAFE_INTEGER)) throw new ReplayValidationError([`CML ${label} is outside safe frame bounds`]);
  return result;
}

async function parseCml(bytes: Uint8Array) {
  const encodedStrings = bytesStartWith(bytes, BINARY_MAGIC);
  if (!encodedStrings && !bytesStartWith(bytes, TEXT_MAGIC)) throw new ReplayValidationError(['CML header is missing']);
  const outer = new CmlReader(new ReplayBinaryReader(bytes, 4), encodedStrings);
  const versionBig = outer.readVarUint();
  const version = Number(versionBig);
  if (![1, 2, 3, 5, 6].includes(version)) throw new ReplayValidationError([`CML version ${versionBig.toString()} is not supported`]);
  let cml = outer;
  if (version >= 5) {
    const declaredSize = outer.readLength('decompressed size', MAX_DECOMPRESSED_BYTES);
    const body = await gunzip(outer.reader.readBytes(outer.reader.remaining), declaredSize);
    cml = new CmlReader(new ReplayBinaryReader(body), encodedStrings);
  }

  const author = cml.readString('author');
  const description = cml.readString('description');
  const accuracy = finiteF32(cml.reader, 'accuracy');
  const duration = finiteF32(cml.reader, 'duration');
  const speedhack = finiteF32(cml.reader, 'speedhack');
  const fps = finiteF32(cml.reader, 'FPS');
  if (fps <= 0 || speedhack <= 0 || duration < 0) throw new ReplayValidationError(['CML timing metadata is invalid']);
  const unknownA = cml.readVarInt();
  const unknownB = cml.readVarInt();
  const unknownFlagByte = cml.reader.readU8();
  if (unknownFlagByte > 1) throw new ReplayValidationError(['CML metadata boolean is invalid']);
  const declaredLastFrame = cml.readVarInt();
  const botName = cml.readString('bot name');
  const botVersion = cml.readString('bot version');
  const seed = cml.readVarUint();
  const macroName = cml.readString('macro name');
  const scale = version >= 5 ? 1_000_000 : 1;
  const ticksPerSecond = fps * scale;
  if (!Number.isFinite(ticksPerSecond) || ticksPerSecond <= 0 || ticksPerSecond > 1_000_000_000) throw new ReplayValidationError(['CML effective tick rate is outside supported bounds']);

  const inputCount = cml.readLength('input count');
  const inputs: ImportedInput[] = [];
  let frame = 0n;
  for (let index = 0; index < inputCount; index += 1) {
    frame = addChecked(frame, cml.readVarInt(), `input ${index} frame`);
    const flags = cml.reader.readU8();
    inputs.push({ tick: frame, player: (flags & 2) !== 0 ? 2 : 1, button: (flags >>> 2) & 15, down: (flags & 1) !== 0 });
  }

  const frameFixCount = cml.readLength('frame-fix count');
  const playerStates: ImportedPlayerState[] = [];
  const accum = [0n, 0n, 0n, 0n, 0n, 0n];
  let playerOneValid = true;
  let playerTwoValid = true;
  let baseFrame = 0n;
  const flat = version === 1 || version >= 5;
  let expandedFixes = 0;
  for (let groupIndex = 0; groupIndex < frameFixCount; groupIndex += 1) {
    baseFrame = addChecked(baseFrame, cml.readVarInt(), `frame-fix group ${groupIndex}`);
    const groupLength = flat ? 1 : cml.readLength(`frame-fix group ${groupIndex} length`);
    if (expandedFixes + groupLength > MAX_IMPORTED_EVENTS) throw new ReplayValidationError(['CML frame-fix groups expand beyond safe bounds']);
    for (let offset = 0; offset < groupLength; offset += 1) {
      const currentFrame = baseFrame + BigInt(offset);
      const flags = cml.reader.readU8();
      for (let index = 0; index < 6; index += 1) if ((flags & (1 << index)) !== 0) accum[index] = accum[index]! + cml.readVarInt();
      if ((flags & 0x40) !== 0) {
        const value = cml.reader.readU8();
        if (value > 1) throw new ReplayValidationError(['CML player-one validity flag is invalid']);
        playerOneValid = value === 1;
      }
      if ((flags & 0x80) !== 0) {
        const value = cml.reader.readU8();
        if (value > 1) throw new ReplayValidationError(['CML player-two validity flag is invalid']);
        playerTwoValid = value === 1;
      }
      if (playerOneValid) playerStates.push({ tick: currentFrame, player: 1, x: Number(accum[0]!) / 1000, y: Number(accum[1]!) / 1000, rotation: Number(accum[2]!) / 1000 });
      if (playerTwoValid && (accum[3] !== 0n || accum[4] !== 0n || accum[5] !== 0n)) playerStates.push({ tick: currentFrame, player: 2, x: Number(accum[3]!) / 1000, y: Number(accum[4]!) / 1000, rotation: Number(accum[5]!) / 1000 });
      expandedFixes += 1;
    }
    if (!flat && groupLength > 0) baseFrame += BigInt(groupLength - 1);
  }
  if (cml.reader.remaining !== 0) throw new ReplayValidationError(['CML replay contains trailing data']);
  const durationTicks = duration > 0 ? ticksFromSeconds(duration, ticksPerSecond) : undefined;
  return buildImportedReplay({
    formatId: 'cml', parserVersion: VERSION, bytes, ticksPerSecond, replayVersion: String(version), inputs, playerStates,
    ...(durationTicks !== undefined ? { durationTicks } : {}),
    extensions: {
      'cml/metadata': {
        author, description, accuracy, speedhack, unknownA: unknownA.toString(), unknownB: unknownB.toString(), unknownFlag: unknownFlagByte === 1,
        declaredLastFrame: declaredLastFrame.toString(), botName, botVersion, seed: seed.toString(), macroName, encodedStrings,
      },
    },
  });
}

export const cmlParser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) {
    return bytesStartWith(input.bytes, BINARY_MAGIC) || bytesStartWith(input.bytes, TEXT_MAGIC)
      ? { confidence: 'exact', reason: 'CML header found' }
      : /\.cml$/i.test(input.filename)
        ? { confidence: 'possible', reason: 'CML extension found without a valid header' }
        : { confidence: 'none', reason: 'No CML header' };
  },
  async parse(input) { return parseCml(input.bytes); },
};
