import type { MacroParser } from '../interfaces';
import { ReplayValidationError } from '../schema';
import type { ImportedExtraEvent, ImportedInput, ImportedPlayerState } from './import-utils';
import {
  MAX_IMPORTED_EVENTS,
  ReplayBinaryReader,
  buildImportedReplay,
  bytesStartWith,
  ticksFromSeconds,
} from './import-utils';

const VERSION = '1.0.0';
const textDecoder = new TextDecoder('utf-8', { fatal: true });

function decodeText(bytes: Uint8Array, label: string): string {
  try {
    return textDecoder.decode(bytes).replace(/\r\n?/g, '\n');
  } catch {
    throw new ReplayValidationError([`${label} must be valid UTF-8 text`]);
  }
}

function positiveRate(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) {
    throw new ReplayValidationError([`${label} must be positive, finite, and within supported bounds`]);
  }
  return value;
}

function checkedFrame(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ReplayValidationError([`${label} must be a non-negative safe integer`]);
  }
  return BigInt(value);
}

function exactRecords(bytes: Uint8Array, headerSize: number, recordSize: number, label: string): number {
  if (bytes.byteLength < headerSize || (bytes.byteLength - headerSize) % recordSize !== 0) {
    throw new ReplayValidationError([`${label} has a truncated or misaligned record table`]);
  }
  const count = (bytes.byteLength - headerSize) / recordSize;
  if (count > MAX_IMPORTED_EVENTS) throw new ReplayValidationError([`${label} contains too many inputs`]);
  return count;
}

async function parseZbf(bytes: Uint8Array) {
  const count = exactRecords(bytes, 8, 6, 'zBot replay');
  const reader = new ReplayBinaryReader(bytes);
  const delta = reader.readF32LE();
  const speedhack = reader.readF32LE();
  if (!Number.isFinite(delta) || delta <= 0 || !Number.isFinite(speedhack) || speedhack <= 0) {
    throw new ReplayValidationError(['zBot delta and speedhack values must both be positive and finite']);
  }
  const rate = positiveRate((1 / delta) / speedhack, 'zBot FPS');
  const inputs: ImportedInput[] = [];
  for (let index = 0; index < count; index += 1) {
    const frame = reader.readI32LE();
    const down = reader.readU8();
    const playerOne = reader.readU8();
    if ((down !== 0x30 && down !== 0x31) || (playerOne !== 0x30 && playerOne !== 0x31)) {
      throw new ReplayValidationError([`zBot input ${index} has an invalid ASCII flag`]);
    }
    inputs.push({ tick: checkedFrame(frame, `zBot input ${index} frame`), player: playerOne === 0x31 ? 1 : 2, button: 1, down: down === 0x31 });
  }
  return buildImportedReplay({ formatId: 'zbot', parserVersion: VERSION, bytes, ticksPerSecond: rate, inputs, extensions: { 'zbot/speedhack': speedhack } });
}

export const zbotParser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) {
    if (!/\.zbf$/i.test(input.filename)) return { confidence: 'none', reason: 'Not a ZBF filename' };
    try { await parseZbf(input.bytes); return { confidence: 'exact', reason: 'Valid ZBF frame table' }; }
    catch { return { confidence: 'possible', reason: 'ZBF extension found, but its records are invalid' }; }
  },
  async parse(input) { return parseZbf(input.bytes); },
};

async function parseRush(bytes: Uint8Array) {
  const count = exactRecords(bytes, 2, 5, 'Rush replay');
  const reader = new ReplayBinaryReader(bytes);
  const rate = positiveRate(reader.readI16LE(), 'Rush FPS');
  const inputs: ImportedInput[] = [];
  for (let index = 0; index < count; index += 1) {
    const frame = reader.readI32LE();
    const state = reader.readU8();
    if (state > 3) throw new ReplayValidationError([`Rush input ${index} has an invalid state`]);
    inputs.push({ tick: checkedFrame(frame, `Rush input ${index} frame`), player: (state & 2) !== 0 ? 2 : 1, button: 1, down: (state & 1) !== 0 });
  }
  return buildImportedReplay({ formatId: 'rush', parserVersion: VERSION, bytes, ticksPerSecond: rate, inputs });
}

export const rushParser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) {
    if (!/\.(?:rsh|rush)$/i.test(input.filename)) return { confidence: 'none', reason: 'Not a Rush filename' };
    try { await parseRush(input.bytes); return { confidence: 'exact', reason: 'Valid Rush frame table' }; }
    catch { return { confidence: 'possible', reason: 'Rush extension found, but its records are invalid' }; }
  },
  async parse(input) { return parseRush(input.bytes); },
};

async function parseKd(bytes: Uint8Array) {
  const count = exactRecords(bytes, 4, 6, 'KD-Bot replay');
  const reader = new ReplayBinaryReader(bytes);
  const rate = positiveRate(reader.readF32LE(), 'KD-Bot FPS');
  const inputs: ImportedInput[] = [];
  for (let index = 0; index < count; index += 1) {
    const frame = reader.readI32LE();
    const down = reader.readU8();
    const playerTwo = reader.readU8();
    if (down > 1 || playerTwo > 1) throw new ReplayValidationError([`KD-Bot input ${index} has an invalid flag`]);
    inputs.push({ tick: checkedFrame(frame, `KD-Bot input ${index} frame`), player: playerTwo ? 2 : 1, button: 1, down: down === 1 });
  }
  return buildImportedReplay({ formatId: 'kdbot', parserVersion: VERSION, bytes, ticksPerSecond: rate, inputs });
}

export const kdbotParser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) {
    if (!/\.kd$/i.test(input.filename)) return { confidence: 'none', reason: 'Not a KD filename' };
    try { await parseKd(input.bytes); return { confidence: 'exact', reason: 'Valid KD-Bot frame table' }; }
    catch { return { confidence: 'possible', reason: 'KD extension found, but its records are invalid' }; }
  },
  async parse(input) { return parseKd(input.bytes); },
};

function parseXbotText(bytes: Uint8Array): { rate: number; inputs: ImportedInput[] } {
  const lines = decodeText(bytes, 'xBot replay').split('\n');
  const rate = positiveRate(Number(lines.shift()?.trim()), 'xBot FPS');
  if (lines.shift()?.trim() !== 'frames') throw new ReplayValidationError(['xBot frame replays must contain the frames header']);
  const inputs: ImportedInput[] = [];
  lines.forEach((raw, lineIndex) => {
    const line = raw.trim();
    if (!line) return;
    const fields = line.split(/\s+/);
    if (fields.length !== 2) throw new ReplayValidationError([`xBot line ${lineIndex + 3} must contain a state and frame`]);
    const state = Number(fields[0]);
    const frame = Number(fields[1]);
    if (!Number.isInteger(state) || state < 0 || state > 3) throw new ReplayValidationError([`xBot line ${lineIndex + 3} has an invalid state`]);
    inputs.push({ tick: checkedFrame(frame, `xBot line ${lineIndex + 3} frame`), player: state > 1 ? 2 : 1, button: 1, down: state % 2 === 1 });
  });
  if (inputs.length > MAX_IMPORTED_EVENTS) throw new ReplayValidationError(['xBot replay contains too many inputs']);
  return { rate, inputs };
}

export const xbotParser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) {
    try {
      const lines = decodeText(input.bytes.slice(0, 4_096), 'xBot replay').split('\n');
      return lines.length >= 2 && /^\d+$/.test(lines[0]!.trim()) && lines[1]!.trim() === 'frames'
        ? { confidence: 'exact', reason: 'xBot frames header found' }
        : { confidence: 'none', reason: 'No xBot frames header' };
    } catch { return /\.xbot$/i.test(input.filename) ? { confidence: 'possible', reason: 'xBot extension found, but the text is invalid' } : { confidence: 'none', reason: 'No xBot text replay' }; }
  },
  async parse(input) {
    const parsed = parseXbotText(input.bytes);
    return buildImportedReplay({ formatId: 'xbot', parserVersion: VERSION, bytes: input.bytes, ticksPerSecond: parsed.rate, inputs: parsed.inputs });
  },
};

function optionalPipeNumber(fields: string[], index: number, label: string): number | undefined {
  if (fields[index] === undefined || fields[index] === '') return undefined;
  const value = Number(fields[index]);
  if (!Number.isFinite(value)) throw new ReplayValidationError([`${label} must be finite`]);
  return value;
}

function parseXdbotText(bytes: Uint8Array): { rate: number; inputs: ImportedInput[]; playerStates: ImportedPlayerState[]; extraEvents: ImportedExtraEvent[] } {
  const lines = decodeText(bytes, 'xdBot replay').split('\n');
  let rate: number | undefined;
  const inputs: ImportedInput[] = [];
  const playerStates: ImportedPlayerState[] = [];
  const extraEvents: ImportedExtraEvent[] = [];
  lines.forEach((raw, lineIndex) => {
    const line = raw.trim();
    if (!line) return;
    const fields = line.split('|').map((field) => field.trim());
    if (fields.length === 1) {
      if (rate !== undefined) throw new ReplayValidationError([`xdBot line ${lineIndex + 1} contains an unexpected scalar`]);
      rate = positiveRate(Number(fields[0]), 'xdBot FPS');
      return;
    }
    if (fields.length < 5) throw new ReplayValidationError([`xdBot line ${lineIndex + 1} is missing required fields`]);
    const frame = checkedFrame(Number(fields[0]), `xdBot line ${lineIndex + 1} frame`);
    const down = Number(fields[1]);
    const button = Number(fields[2]);
    const playerOne = Number(fields[3]);
    const positionOnly = Number(fields[4]);
    if (![0, 1].includes(down) || ![1, 2, 3].includes(button) || ![0, 1].includes(playerOne) || ![0, 1].includes(positionOnly)) {
      throw new ReplayValidationError([`xdBot line ${lineIndex + 1} has an invalid input flag`]);
    }
    const player = playerOne === 1 ? 1 : 2;
    const fullPhysics = fields.length >= 17;
    const base = fullPhysics && player === 2 ? 11 : 5;
    const x = optionalPipeNumber(fields, base, `xdBot line ${lineIndex + 1} X position`);
    const y = optionalPipeNumber(fields, base + 1, `xdBot line ${lineIndex + 1} Y position`);
    const upsideDown = fullPhysics ? optionalPipeNumber(fields, base + 2, `xdBot line ${lineIndex + 1} upside-down flag`) : undefined;
    const rotation = fullPhysics ? optionalPipeNumber(fields, base + 3, `xdBot line ${lineIndex + 1} rotation`) : undefined;
    const xVelocity = fullPhysics ? optionalPipeNumber(fields, base + 4, `xdBot line ${lineIndex + 1} X velocity`) : undefined;
    const yVelocity = fullPhysics ? optionalPipeNumber(fields, base + 5, `xdBot line ${lineIndex + 1} Y velocity`) : undefined;
    if (upsideDown !== undefined && upsideDown !== 0 && upsideDown !== 1) throw new ReplayValidationError([`xdBot line ${lineIndex + 1} upside-down flag is invalid`]);
    const extension = upsideDown !== undefined || xVelocity !== undefined || yVelocity !== undefined
      ? { namespace: 'xdbot', eventType: 'physics-extension', critical: true, payload: { ...(upsideDown !== undefined ? { upsideDown: upsideDown === 1 } : {}), ...(xVelocity !== undefined ? { xVelocity } : {}), ...(yVelocity !== undefined ? { yVelocity } : {}) } } as const
      : undefined;
    if (positionOnly === 1) {
      if (x !== undefined || y !== undefined || rotation !== undefined) playerStates.push({ tick: frame, player, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}), ...(rotation !== undefined ? { rotation } : {}) });
      if (extension) extraEvents.push({ tick: frame, kind: 'extension', ...extension });
      return;
    }
    inputs.push({ tick: frame, player, button, down: down === 1, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}), ...(rotation !== undefined ? { rotation } : {}), ...(extension ? { extension } : {}) });
  });
  if (rate === undefined) throw new ReplayValidationError(['xdBot replay is missing its FPS line']);
  if (inputs.length > MAX_IMPORTED_EVENTS) throw new ReplayValidationError(['xdBot replay contains too many inputs']);
  return { rate, inputs, playerStates, extraEvents };
}

export const xdbotParser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) {
    if (!/\.xd$/i.test(input.filename)) return { confidence: 'none', reason: 'Not an xdBot filename' };
    try { parseXdbotText(input.bytes); return { confidence: 'exact', reason: 'Valid xdBot pipe-delimited replay' }; }
    catch { return { confidence: 'possible', reason: 'xdBot extension found, but its records are invalid' }; }
  },
  async parse(input) {
    const parsed = parseXdbotText(input.bytes);
    return buildImportedReplay({ formatId: 'xdbot', parserVersion: VERSION, bytes: input.bytes, ticksPerSecond: parsed.rate, inputs: parsed.inputs, playerStates: parsed.playerStates, extraEvents: parsed.extraEvents });
  },
};

function parseAmethystText(bytes: Uint8Array): ImportedInput[] {
  const lines = decodeText(bytes, 'Amethyst replay').split('\n').map((line) => line.trim());
  while (lines.at(-1) === '') lines.pop();
  let cursor = 0;
  const inputs: ImportedInput[] = [];
  const readGroup = (player: 1 | 2, down: boolean) => {
    const count = Number(lines[cursor++]);
    if (!Number.isSafeInteger(count) || count < 0 || count > MAX_IMPORTED_EVENTS) throw new ReplayValidationError(['Amethyst replay contains an invalid group count']);
    for (let index = 0; index < count; index += 1) {
      const seconds = Number(lines[cursor++]);
      if (!Number.isFinite(seconds) || seconds < 0) throw new ReplayValidationError(['Amethyst replay contains an invalid action time']);
      inputs.push({ tick: ticksFromSeconds(seconds, 240), player, button: 1, down });
    }
  };
  readGroup(1, true); readGroup(1, false); readGroup(2, true); readGroup(2, false);
  if (cursor !== lines.length) throw new ReplayValidationError(['Amethyst replay contains trailing data']);
  if (inputs.length > MAX_IMPORTED_EVENTS) throw new ReplayValidationError(['Amethyst replay contains too many inputs']);
  return inputs;
}

export const amethystParser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) {
    if (!/\.thyst$/i.test(input.filename)) return { confidence: 'none', reason: 'Not an Amethyst filename' };
    try { parseAmethystText(input.bytes); return { confidence: 'exact', reason: 'Valid Amethyst four-group replay' }; }
    catch { return { confidence: 'possible', reason: 'Amethyst extension found, but its groups are invalid' }; }
  },
  async parse(input) { return buildImportedReplay({ formatId: 'amethyst', parserVersion: VERSION, bytes: input.bytes, ticksPerSecond: 240, inputs: parseAmethystText(input.bytes) }); },
};

const FBRP = [0x46, 0x42, 0x52, 0x50] as const;

async function parseFembot(bytes: Uint8Array) {
  if (!bytesStartWith(bytes, FBRP)) throw new ReplayValidationError(['Fembot FBRP header is missing']);
  const count = exactRecords(bytes, 8, 65, 'Fembot replay');
  const reader = new ReplayBinaryReader(bytes, 4);
  const rate = positiveRate(reader.readF32LE(), 'Fembot FPS');
  const inputs: ImportedInput[] = [];
  for (let index = 0; index < count; index += 1) {
    const state = reader.readU8();
    if (state > 3) throw new ReplayValidationError([`Fembot input ${index} has an invalid state`]);
    const frame = reader.readU32LE();
    const reserved = reader.readBytes(60);
    inputs.push({
      tick: BigInt(frame), player: (state & 2) !== 0 ? 2 : 1, button: 1, down: (state & 1) !== 0,
      ...(reserved.some((byte) => byte !== 0) ? { extension: { namespace: 'fembot', eventType: 'reserved-record-data', critical: true, payload: { bytes: Array.from(reserved) } } } : {}),
    });
  }
  return buildImportedReplay({ formatId: 'fembot', parserVersion: VERSION, bytes, ticksPerSecond: rate, inputs });
}

export const fembotParser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) { return bytesStartWith(input.bytes, FBRP) ? { confidence: 'exact', reason: 'Fembot FBRP header found' } : /\.freplay$/i.test(input.filename) ? { confidence: 'possible', reason: 'Fembot extension found without a valid header' } : { confidence: 'none', reason: 'No Fembot header' }; },
  async parse(input) { return parseFembot(input.bytes); },
};

const RPLY = [0x52, 0x50, 0x4c, 0x59] as const;

async function parseReplayBot(bytes: Uint8Array) {
  if (!bytesStartWith(bytes, RPLY)) throw new ReplayValidationError(['ReplayBot RPLY header is missing']);
  const count = exactRecords(bytes, 10, 5, 'ReplayBot replay');
  const reader = new ReplayBinaryReader(bytes, 4);
  const version = reader.readU8();
  const kind = reader.readU8();
  if (version !== 2 || kind !== 1) throw new ReplayValidationError(['Only ReplayBot v2 frame replays are supported']);
  const rate = positiveRate(reader.readF32LE(), 'ReplayBot FPS');
  const inputs: ImportedInput[] = [];
  for (let index = 0; index < count; index += 1) {
    const frame = reader.readU32LE();
    const state = reader.readU8();
    if (state > 3) throw new ReplayValidationError([`ReplayBot input ${index} has an invalid state`]);
    inputs.push({ tick: BigInt(frame), player: (state & 2) !== 0 ? 2 : 1, button: 1, down: (state & 1) !== 0 });
  }
  return buildImportedReplay({ formatId: 'replaybot', parserVersion: VERSION, bytes, ticksPerSecond: rate, replayVersion: String(version), inputs });
}

export const replayBotParser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) { return bytesStartWith(input.bytes, RPLY) ? { confidence: 'exact', reason: 'ReplayBot RPLY header found' } : { confidence: 'none', reason: 'No ReplayBot header' }; },
  async parse(input) { return parseReplayBot(input.bytes); },
};
