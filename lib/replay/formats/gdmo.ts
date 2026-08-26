import type { MacroParser } from '../interfaces';
import { ReplayValidationError } from '../schema';
import type { ImportedExtraEvent, ImportedInput, ImportedPlayerState } from './import-utils';
import {
  MAX_IMPORTED_EVENTS,
  ReplayBinaryReader,
  buildImportedReplay,
  ticksFromSeconds,
} from './import-utils';

const VERSION = '1.0.0';

function positiveRate(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) throw new ReplayValidationError(['GDMO FPS is invalid']);
  return value;
}

async function parseModern(bytes: Uint8Array) {
  const reader = new ReplayBinaryReader(bytes);
  if (reader.length < 12) throw new ReplayValidationError(['GDMO header is truncated']);
  const ticksPerSecond = positiveRate(reader.readF32LE());
  const actionCount = reader.readU32LE();
  const frameCaptureCount = reader.readU32LE();
  if (actionCount > MAX_IMPORTED_EVENTS) throw new ReplayValidationError(['GDMO replay contains too many actions']);
  if (frameCaptureCount !== 0) throw new ReplayValidationError(['This GDMO frame-capture layout is not supported safely']);
  if (bytes.byteLength !== 12 + actionCount * 24) throw new ReplayValidationError(['GDMO action table does not match the file length']);
  const inputs: ImportedInput[] = [];
  const extraEvents: ImportedExtraEvent[] = [];
  for (let index = 0; index < actionCount; index += 1) {
    const down = reader.readU8();
    const playerTwo = reader.readU8();
    const padding = reader.readBytes(2);
    const frame = reader.readU32LE();
    const yAcceleration = reader.readF64LE();
    const x = reader.readF32LE();
    const y = reader.readF32LE();
    if (down > 1 || playerTwo > 1 || ![yAcceleration, x, y].every(Number.isFinite)) throw new ReplayValidationError([`GDMO action ${index} is invalid`]);
    const tick = BigInt(frame);
    inputs.push({ tick, player: playerTwo ? 2 : 1, button: 1, down: down === 1, x, y });
    if (yAcceleration !== 0 || padding.some((byte) => byte !== 0)) {
      extraEvents.push({ tick, kind: 'extension', namespace: 'gdmo', eventType: 'action-physics', critical: true, payload: { yAcceleration, padding: Array.from(padding) } });
    }
  }
  return buildImportedReplay({ formatId: 'gdmo', parserVersion: VERSION, bytes, ticksPerSecond, replayVersion: 'modern', inputs, extraEvents });
}

async function parseLegacy22(bytes: Uint8Array) {
  const reader = new ReplayBinaryReader(bytes);
  const actionCount = reader.readU32LE();
  if (actionCount > MAX_IMPORTED_EVENTS || 4 + actionCount * 16 + 4 > bytes.byteLength) throw new ReplayValidationError(['GDMO 2.2 action count is invalid']);
  const inputs: ImportedInput[] = [];
  const extraEvents: ImportedExtraEvent[] = [];
  for (let index = 0; index < actionCount; index += 1) {
    const seconds = reader.readF64LE();
    const key = reader.readI32LE();
    const down = reader.readU8();
    const playerOne = reader.readU8();
    const padding = reader.readBytes(2);
    if (!Number.isFinite(seconds) || seconds < 0 || down > 1 || playerOne > 1) throw new ReplayValidationError([`GDMO 2.2 action ${index} is invalid`]);
    const tick = ticksFromSeconds(seconds, 240);
    inputs.push({
      tick, player: playerOne ? 1 : 2, button: key, down: down === 1,
      ...(padding.some((byte) => byte !== 0) ? { extension: { namespace: 'gdmo', eventType: 'legacy-action-padding', critical: true, payload: { bytes: Array.from(padding) } } } : {}),
    });
  }
  const correctionCount = reader.readU32LE();
  if (correctionCount > MAX_IMPORTED_EVENTS) throw new ReplayValidationError(['GDMO 2.2 correction count is invalid']);
  if (correctionCount === 0 && reader.remaining !== 0) throw new ReplayValidationError(['GDMO 2.2 replay contains trailing data']);
  const correctionSize = correctionCount === 0 ? 0 : reader.remaining / correctionCount;
  if (correctionCount > 0 && (!Number.isInteger(correctionSize) || (correctionSize !== 56 && correctionSize !== 0x23a8))) {
    throw new ReplayValidationError(['GDMO 2.2 correction records have an unsupported size']);
  }
  const playerStates: ImportedPlayerState[] = [];
  for (let index = 0; index < correctionCount; index += 1) {
    const start = reader.position;
    const seconds = reader.readF64LE();
    const playerOne = reader.readU8();
    const prefixPadding = reader.readBytes(7);
    const yVelocity = reader.readF64LE();
    const xVelocity = reader.readF64LE();
    const x = reader.readF32LE();
    const y = reader.readF32LE();
    const nodeX = reader.readF32LE();
    const nodeY = reader.readF32LE();
    const rotation = reader.readF32LE();
    reader.seek(start + correctionSize);
    if (!Number.isFinite(seconds) || seconds < 0 || playerOne > 1 || ![yVelocity, xVelocity, x, y, nodeX, nodeY, rotation].every(Number.isFinite)) {
      throw new ReplayValidationError([`GDMO 2.2 correction ${index} is invalid`]);
    }
    const tick = ticksFromSeconds(seconds, 240);
    const player = playerOne ? 1 : 2;
    playerStates.push({ tick, player, x, y, rotation });
    extraEvents.push({ tick, kind: 'extension', namespace: 'gdmo', eventType: 'legacy-correction', critical: true, payload: { yVelocity, xVelocity, nodeX, nodeY, prefixPadding: Array.from(prefixPadding), recordSize: correctionSize } });
  }
  return buildImportedReplay({ formatId: 'gdmo', parserVersion: VERSION, bytes, ticksPerSecond: 240, replayVersion: '2.2', inputs, playerStates, extraEvents });
}

export const gdmoParser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) {
    if (!/\.macro$/i.test(input.filename)) return { confidence: 'none', reason: 'Not a GDMO filename' };
    try { await parseModern(input.bytes); return { confidence: 'exact', reason: 'Valid modern GDMO replay' }; } catch {
      try { await parseLegacy22(input.bytes); return { confidence: 'exact', reason: 'Valid GDMO 2.2 replay' }; }
      catch { return { confidence: 'possible', reason: 'GDMO extension found, but no verified layout matched' }; }
    }
  },
  async parse(input) {
    try { return await parseModern(input.bytes); }
    catch (modernError) {
      try { return await parseLegacy22(input.bytes); }
      catch { throw modernError; }
    }
  },
};
