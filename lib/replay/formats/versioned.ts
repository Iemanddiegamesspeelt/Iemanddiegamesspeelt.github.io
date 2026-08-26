import type { MacroParser } from '../interfaces';
import { ReplayValidationError } from '../schema';
import type { ImportedExtraEvent, ImportedInput, ImportedPlayerState } from './import-utils';
import {
  MAX_IMPORTED_EVENTS,
  ReplayBinaryReader,
  buildImportedReplay,
  bytesStartWith,
} from './import-utils';

const VERSION = '1.0.0';
const YBOT_MAGIC = [0x79, 0x62, 0x6f, 0x74] as const;

function positiveRate(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) {
    throw new ReplayValidationError([`${label} must be positive, finite, and within supported bounds`]);
  }
  return value;
}

function safeCount(value: bigint | number, label: string): number {
  const number = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < 0 || number > MAX_IMPORTED_EVENTS) {
    throw new ReplayValidationError([`${label} exceeds safe parsing bounds`]);
  }
  return number;
}

function readLeb128(reader: ReplayBinaryReader): bigint {
  return reader.readVarUint();
}

async function parseYbot(bytes: Uint8Array) {
  if (!bytesStartWith(bytes, YBOT_MAGIC)) throw new ReplayValidationError(['yBot header is missing']);
  const reader = new ReplayBinaryReader(bytes, 4);
  const replayVersion = reader.readU32LE();
  const metaLength = reader.readU32LE();
  const blobCount = reader.readU32LE();
  if (metaLength < 36 || metaLength > 1_048_576) throw new ReplayValidationError(['yBot metadata length is invalid']);
  if (blobCount > 4_096) throw new ReplayValidationError(['yBot blob count exceeds safe parsing bounds']);
  const metadata = new ReplayBinaryReader(reader.readBytes(metaLength));
  const date = metadata.readI64LE();
  const declaredPresses = metadata.readU64LE();
  const declaredFrames = metadata.readU64LE();
  const rate = positiveRate(metadata.readF32LE(), 'yBot FPS');
  const declaredTotalPresses = metadata.readU64LE();
  for (let index = 0; index < blobCount; index += 1) {
    const length = reader.readU32LE();
    if (length > 1_048_576) throw new ReplayValidationError([`yBot blob ${index} exceeds 1 MiB`]);
    reader.skip(length);
  }

  let frame = 0n;
  const inputs: ImportedInput[] = [];
  const extraEvents: ImportedExtraEvent[] = [];
  while (reader.remaining > 0) {
    if (inputs.length >= MAX_IMPORTED_EVENTS) throw new ReplayValidationError(['yBot replay contains too many inputs']);
    const packed = readLeb128(reader);
    const delta = packed >> 4n;
    if (delta > BigInt(Number.MAX_SAFE_INTEGER) || frame + delta > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ReplayValidationError(['yBot frame exceeds safe parsing bounds']);
    }
    frame += delta;
    const flags = Number(packed & 0xfn);
    const button = flags >> 2;
    if (button < 1 || button > 3) {
      if (reader.remaining < 4) throw new ReplayValidationError(['yBot FPS action is truncated']);
      const fps = reader.readF32LE();
      positiveRate(fps, 'yBot FPS change');
      extraEvents.push({ tick: frame, kind: 'extension', namespace: 'ybot', eventType: 'fps-change', critical: true, payload: { fps } });
      continue;
    }
    inputs.push({ tick: frame, player: (flags & 1) !== 0 ? 1 : 2, button, down: (flags & 2) !== 0 });
  }

  return buildImportedReplay({
    formatId: 'ybot', parserVersion: VERSION, bytes, ticksPerSecond: rate, replayVersion: String(replayVersion), inputs, extraEvents,
    durationTicks: declaredFrames <= BigInt(Number.MAX_SAFE_INTEGER) ? declaredFrames : undefined,
    extensions: {
      'ybot/metadata': {
        date: date.toString(),
        presses: declaredPresses.toString(),
        totalPresses: declaredTotalPresses.toString(),
        blobCount,
      },
    },
  });
}

export const ybotParser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) { return bytesStartWith(input.bytes, YBOT_MAGIC) ? { confidence: 'exact', reason: 'yBot header found' } : /\.ybot$/i.test(input.filename) ? { confidence: 'possible', reason: 'yBot extension found without a valid header' } : { confidence: 'none', reason: 'No yBot header' }; },
  async parse(input) { return parseYbot(input.bytes); },
};

type OmegaClick = { frame: number; type: number; fps?: number };

function decodeOmegaBot2(bytes: Uint8Array) {
  const reader = new ReplayBinaryReader(bytes);
  if (reader.length < 28) throw new ReplayValidationError(['OmegaBot v2 replay is truncated']);
  const initialRate = positiveRate(reader.readF32LE(), 'OmegaBot initial FPS');
  const currentRate = positiveRate(reader.readF32LE(), 'OmegaBot current FPS');
  const replayType = reader.readU32LE();
  const currentClick = reader.readU64LE();
  const count = safeCount(reader.readU64LE(), 'OmegaBot click count');
  if (replayType !== 1) throw new ReplayValidationError(['Only OmegaBot v2 frame replays can be imported']);
  if (currentClick > BigInt(count)) throw new ReplayValidationError(['OmegaBot current-click index is invalid']);
  const clicks: OmegaClick[] = [];
  for (let index = 0; index < count; index += 1) {
    const locationType = reader.readU32LE();
    const location = reader.readU32LE();
    const type = reader.readU32LE();
    if (locationType > 1 || type > 5) throw new ReplayValidationError([`OmegaBot click ${index} has an unknown variant`]);
    const fps = type === 1 ? positiveRate(reader.readF32LE(), `OmegaBot click ${index} FPS`) : undefined;
    if (locationType === 1) clicks.push({ frame: location, type, ...(fps !== undefined ? { fps } : {}) });
  }
  if (reader.remaining !== 0) throw new ReplayValidationError(['OmegaBot v2 replay contains trailing data']);
  return { initialRate, currentRate, clicks, count, currentClick };
}

async function parseOmegaBot2(bytes: Uint8Array) {
  const decoded = decodeOmegaBot2(bytes);
  const inputs: ImportedInput[] = [];
  const extraEvents: ImportedExtraEvent[] = [];
  decoded.clicks.forEach((click) => {
    const tick = BigInt(click.frame);
    if (click.type === 1) {
      extraEvents.push({ tick, kind: 'extension', namespace: 'omegabot', eventType: 'fps-change', critical: true, payload: { fps: click.fps! } });
    } else if (click.type >= 2) {
      inputs.push({ tick, player: click.type >= 4 ? 2 : 1, button: 1, down: click.type === 2 || click.type === 4 });
    }
  });
  return buildImportedReplay({
    formatId: 'omegabot-replay', parserVersion: VERSION, bytes, ticksPerSecond: decoded.initialRate, replayVersion: '2', inputs, extraEvents,
    extensions: { 'omegabot/v2-state': { currentRate: decoded.currentRate, currentClick: decoded.currentClick.toString(), declaredClicks: decoded.count } },
  });
}

export const omegaBot2Parser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) {
    if (!/\.replay$/i.test(input.filename) || bytesStartWith(input.bytes, [0x52, 0x50, 0x4c, 0x59])) return { confidence: 'none', reason: 'Not an OmegaBot v2 candidate' };
    try { decodeOmegaBot2(input.bytes); return { confidence: 'exact', reason: 'Valid complete OmegaBot v2 Bincode replay' }; }
    catch { return { confidence: 'none', reason: 'No OmegaBot v2 schema' }; }
  },
  async parse(input) { return parseOmegaBot2(input.bytes); },
};

function checkedExpectedLength(counts: number[]): number {
  const [p1Frames, p2Frames, p1Inputs, p2Inputs] = counts;
  const expected = 20 + 32 * (p1Frames! + p2Frames!) + 16 * (p1Inputs! + p2Inputs!);
  if (!Number.isSafeInteger(expected)) throw new ReplayValidationError(['ReplayEngine 3 declared size exceeds safe bounds']);
  return expected;
}

async function parseReplayEngine3(bytes: Uint8Array) {
  const reader = new ReplayBinaryReader(bytes);
  if (reader.length < 20) throw new ReplayValidationError(['ReplayEngine 3 header is truncated']);
  const rate = positiveRate(reader.readF32LE(), 'ReplayEngine 3 FPS');
  const counts = [reader.readU32LE(), reader.readU32LE(), reader.readU32LE(), reader.readU32LE()];
  if (counts.reduce((sum, count) => sum + count, 0) > MAX_IMPORTED_EVENTS) throw new ReplayValidationError(['ReplayEngine 3 contains too many records']);
  if (checkedExpectedLength(counts) !== bytes.byteLength) throw new ReplayValidationError(['ReplayEngine 3 record sizes do not match the file length']);
  const playerStates: ImportedPlayerState[] = [];
  const extraEvents: ImportedExtraEvent[] = [];
  for (let section = 0; section < 2; section += 1) {
    const player = section === 0 ? 1 : 2;
    for (let index = 0; index < counts[section]!; index += 1) {
      const frame = reader.readU32LE();
      const x = reader.readF32LE();
      const y = reader.readF32LE();
      const rotation = reader.readF32LE();
      const yAcceleration = reader.readF64LE();
      const playerTwo = reader.readU8();
      const padding = reader.readBytes(7);
      if (playerTwo > 1 || playerTwo !== section) throw new ReplayValidationError([`ReplayEngine 3 frame ${index} has the wrong player flag`]);
      if (![x, y, rotation, yAcceleration].every(Number.isFinite)) throw new ReplayValidationError([`ReplayEngine 3 frame ${index} contains non-finite physics data`]);
      playerStates.push({ tick: BigInt(frame), player, x, y, rotation });
      if (yAcceleration !== 0 || padding.some((byte) => byte !== 0)) {
        extraEvents.push({ tick: BigInt(frame), kind: 'extension', namespace: 'replayengine3', eventType: 'frame-physics', critical: true, payload: { yAcceleration, padding: Array.from(padding) } });
      }
    }
  }
  const inputs: ImportedInput[] = [];
  for (let section = 0; section < 2; section += 1) {
    const player = section === 0 ? 1 : 2;
    for (let index = 0; index < counts[section + 2]!; index += 1) {
      const frame = reader.readU32LE();
      const down = reader.readU8();
      const paddingA = reader.readBytes(3);
      const button = reader.readI32LE();
      const playerOne = reader.readU8();
      const paddingB = reader.readBytes(3);
      if (down > 1 || playerOne > 1 || playerOne !== (section === 0 ? 1 : 0) || button < 1 || button > 3) {
        throw new ReplayValidationError([`ReplayEngine 3 input ${index} contains an invalid field`]);
      }
      inputs.push({
        tick: BigInt(frame), player, button, down: down === 1,
        ...([...paddingA, ...paddingB].some((byte) => byte !== 0) ? { extension: { namespace: 'replayengine3', eventType: 'input-padding', critical: true, payload: { before: Array.from(paddingA), after: Array.from(paddingB) } } } : {}),
      });
    }
  }
  return buildImportedReplay({ formatId: 'replayengine3', parserVersion: VERSION, bytes, ticksPerSecond: rate, replayVersion: '3', inputs, playerStates, extraEvents });
}

export const replayEngine3Parser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) {
    if (!/\.re3$/i.test(input.filename)) return { confidence: 'none', reason: 'Not a ReplayEngine 3 filename' };
    try { await parseReplayEngine3(input.bytes); return { confidence: 'exact', reason: 'Valid ReplayEngine 3 native-layout replay' }; }
    catch { return { confidence: 'possible', reason: 'RE3 extension found, but its records are invalid' }; }
  },
  async parse(input) { return parseReplayEngine3(input.bytes); },
};
