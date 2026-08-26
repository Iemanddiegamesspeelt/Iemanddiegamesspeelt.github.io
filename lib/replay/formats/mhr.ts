import type { MacroParser } from '../interfaces';
import { ReplayValidationError } from '../schema';
import type { ImportedInput, ImportedPlayerState } from './import-utils';
import {
  ReplayBinaryReader,
  asArray,
  asBoolean,
  asFiniteNumber,
  asInteger,
  asObject,
  assertCount,
  buildImportedReplay,
  bytesStartWith,
  looksLikeJson,
  optionalBoolean,
  optionalFiniteNumber,
  parseUtf8Json,
  toJsonValue,
} from './import-utils';

const JSON_VERSION = '1.0.0';
const BINARY_VERSION = '1.0.0';
const BINARY_MAGIC = [0x48, 0x41, 0x43, 0x4b] as const;
const BINARY_FOOTER = [0xfa, 0x67, 0x55, 0x5a, 0x8d, 0x95, 0x94, 0x07, 0xc9, 0x8c, 0xba, 0x7f, 0x75, 0x9c, 0xef, 0x3c] as const;

function isMhrJson(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const root = value as Record<string, unknown>;
  if (!Array.isArray(root.events) || !root.meta || typeof root.meta !== 'object' || Array.isArray(root.meta)) return false;
  return typeof (root.meta as Record<string, unknown>).fps === 'number';
}

export const mhrJsonParser: MacroParser = {
  implementationVersion: JSON_VERSION,
  async probe(input) {
    if (!looksLikeJson(input.bytes)) return { confidence: 'none', reason: 'MHR JSON must be JSON' };
    try {
      return isMhrJson(parseUtf8Json(input.bytes))
        ? { confidence: 'exact', reason: 'Mega Hack Replay JSON schema found' }
        : { confidence: 'none', reason: 'JSON data is not an MHR replay' };
    } catch {
      return /\.mhr\.json$/i.test(input.filename)
        ? { confidence: 'possible', reason: 'MHR JSON extension found, but the JSON is invalid' }
        : { confidence: 'none', reason: 'No MHR JSON schema' };
    }
  },
  async parse(input) {
    const root = asObject(parseUtf8Json(input.bytes), 'MHR replay');
    if (!isMhrJson(root)) throw new ReplayValidationError(['The file does not match the Mega Hack Replay JSON schema']);
    const meta = asObject(root.meta, 'MHR meta');
    const rate = asFiniteNumber(meta.fps, 'MHR meta.fps');
    const inputs: ImportedInput[] = [];
    const playerStates: ImportedPlayerState[] = [];

    asArray(root.events, 'MHR events').forEach((source, index) => {
      const event = asObject(source, `MHR event ${index}`);
      const tick = BigInt(asInteger(event.frame, `MHR event ${index} frame`));
      const player = optionalBoolean(event.p2, `MHR event ${index} p2`) ? 2 : 1;
      const x = optionalFiniteNumber(event.x, `MHR event ${index} x`);
      const y = optionalFiniteNumber(event.y, `MHR event ${index} y`);
      const rotation = optionalFiniteNumber(event.r, `MHR event ${index} rotation`);
      const acceleration = optionalFiniteNumber(event.a, `MHR event ${index} acceleration`);
      if (event.down !== undefined && event.down !== null) {
        const imported: ImportedInput = {
          tick,
          player,
          button: 1,
          down: asBoolean(event.down, `MHR event ${index} down`),
          ...(x !== undefined ? { x } : {}),
          ...(y !== undefined ? { y } : {}),
          ...(rotation !== undefined ? { rotation } : {}),
        };
        if (acceleration !== undefined) {
          imported.extension = {
            namespace: 'mhr',
            eventType: 'physics-extension',
            critical: true,
            payload: { acceleration },
          };
        }
        inputs.push(imported);
      } else if (x !== undefined || y !== undefined || rotation !== undefined) {
        playerStates.push({ tick, player, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}), ...(rotation !== undefined ? { rotation } : {}) });
      }
    });

    return buildImportedReplay({
      formatId: 'mhr-json',
      parserVersion: JSON_VERSION,
      bytes: input.bytes,
      ticksPerSecond: rate,
      inputs,
      playerStates,
      extensions: {
        'mhr/metadata': {
          tag: typeof root._ === 'string' ? root._ : '',
          meta: toJsonValue(meta),
        },
      },
    });
  },
};

export const mhrBinaryParser: MacroParser = {
  implementationVersion: BINARY_VERSION,
  async probe(input) {
    if (bytesStartWith(input.bytes, BINARY_MAGIC)) {
      return { confidence: 'exact', reason: 'Mega Hack Replay HACK header found' };
    }
    return /\.mhr$/i.test(input.filename)
      ? { confidence: 'possible', reason: 'MHR extension found without a valid HACK header' }
      : { confidence: 'none', reason: 'No MHR binary header' };
  },
  async parse(input) {
    const reader = new ReplayBinaryReader(input.bytes);
    if (!bytesStartWith(input.bytes, BINARY_MAGIC)) throw new ReplayValidationError(['MHR HACK header is missing']);
    if (reader.length < 32) throw new ReplayValidationError(['MHR header is truncated']);
    const absoluteHeader = input.bytes[4] === 0x50 && input.bytes[5] === 0x52 && input.bytes[6] === 0x4f && input.bytes[7] === 0x07;
    let version: number;
    let metaSize: number;
    let rate: number;
    let eventSize: number;
    let eventCount: number;
    if (absoluteHeader) {
      version = 7;
      reader.seek(8);
      metaSize = reader.readI32LE();
      if (metaSize < 4 || metaSize > 1_048_576) throw new ReplayValidationError(['MHR metadata size is invalid']);
      rate = reader.readI32LE();
      reader.seek(12 + metaSize);
      reader.skip(8);
      eventSize = reader.readU32LE();
      eventCount = assertCount(reader.readU32LE(), 'MHR event count');
    } else {
      reader.seek(4);
      version = reader.readU16BE();
      reader.readU16BE();
      metaSize = 4;
      reader.seek(12);
      rate = reader.readI32LE();
      reader.seek(24);
      eventSize = reader.readU32LE() || 32;
      eventCount = assertCount(reader.readU32LE(), 'MHR event count');
    }
    if (eventSize < 8 || eventSize > 4_096) throw new ReplayValidationError(['MHR event size is invalid']);
    if (reader.remaining < eventCount * eventSize) throw new ReplayValidationError(['MHR event table is truncated']);
    const inputs: ImportedInput[] = [];

    for (let index = 0; index < eventCount; index += 1) {
      const eventType = reader.readU16LE();
      const downByte = reader.readU8();
      const playerByte = reader.readU8();
      if (downByte > 1 || playerByte > 1) throw new ReplayValidationError([`MHR event ${index} contains an invalid input flag`]);
      const frame = reader.readI32LE();
      if (frame < 0) throw new ReplayValidationError([`MHR event ${index} has a negative frame`]);
      const remaining = reader.readBytes(eventSize - 8);
      const hasExtensionData = eventType > 1 || remaining.some((byte) => byte !== 0);
      inputs.push({
        tick: BigInt(frame),
        player: playerByte === 1 ? 2 : 1,
        button: 1,
        down: downByte === 1,
        ...(hasExtensionData ? {
          extension: {
            namespace: 'mhr',
            eventType: 'binary-event-extension',
            critical: true,
            payload: { type: eventType, data: toJsonValue(remaining) },
          },
        } : {}),
      });
    }
    if (reader.remaining !== 0) {
      if (reader.remaining !== BINARY_FOOTER.length || !bytesStartWith(reader.peekBytes(BINARY_FOOTER.length), BINARY_FOOTER)) {
        throw new ReplayValidationError(['MHR replay contains an unknown trailing block']);
      }
      reader.skip(BINARY_FOOTER.length);
    }

    return buildImportedReplay({
      formatId: 'mhr',
      parserVersion: BINARY_VERSION,
      bytes: input.bytes,
      ticksPerSecond: rate,
      replayVersion: String(version),
      inputs,
      extensions: { 'mhr/metadata': { metaSize, eventSize } },
    });
  },
};
