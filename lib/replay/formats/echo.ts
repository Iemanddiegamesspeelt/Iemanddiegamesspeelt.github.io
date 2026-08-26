import type { MacroParser } from '../interfaces';
import { ReplayValidationError } from '../schema';
import type { ImportedInput } from './import-utils';
import {
  ReplayBinaryReader,
  asArray,
  asBoolean,
  asFiniteNumber,
  asInteger,
  asObject,
  buildImportedReplay,
  bytesStartWith,
  looksLikeJson,
  optionalBoolean,
  optionalFiniteNumber,
  parseUtf8Json,
} from './import-utils';

const VERSION = '1.0.0';
const ECHO_MAGIC = [0x4d, 0x45, 0x54, 0x41] as const;
const ECHO_DEBUG = [0x44, 0x42, 0x47, 0x00] as const;

type EchoVariant = 'binary' | 'binary-debug' | 'json-old' | 'json-new';

function jsonVariant(value: unknown): EchoVariant | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  if (typeof object.FPS === 'number' && Array.isArray(object['Echo Replay'])) return 'json-old';
  if (typeof object.fps === 'number' && Array.isArray(object.inputs)) return 'json-new';
  return null;
}

function physicsExtension(event: Record<string, unknown>, index: number) {
  const velocity = optionalFiniteNumber(event['Y Acceleration'] ?? event.y_vel, `Echo input ${index} Y velocity`);
  return velocity === undefined ? undefined : {
    namespace: 'echo',
    eventType: 'physics-extension',
    critical: true,
    payload: { yVelocity: velocity },
  } as const;
}

async function parseJson(bytes: Uint8Array) {
  const root = asObject(parseUtf8Json(bytes), 'Echo replay');
  const variant = jsonVariant(root);
  if (!variant) throw new ReplayValidationError(['The file does not match a supported Echo JSON schema']);
  const old = variant === 'json-old';
  const rate = asFiniteNumber(old ? root.FPS : root.fps, 'Echo FPS');
  const startFrame = old && root['Starting Frame'] !== undefined
    ? asInteger(root['Starting Frame'], 'Echo starting frame')
    : 0;
  const sourceInputs = asArray(old ? root['Echo Replay'] : root.inputs, 'Echo inputs');
  const inputs: ImportedInput[] = sourceInputs.map((source, index) => {
    const event = asObject(source, `Echo input ${index}`);
    const frame = asInteger(old ? event.Frame : event.frame, `Echo input ${index} frame`) + startFrame;
    const player2 = old
      ? asBoolean(event['Player 2'], `Echo input ${index} Player 2`)
      : optionalBoolean(event.player_2, `Echo input ${index} player_2`) ?? false;
    const x = optionalFiniteNumber(old ? event['X Position'] : event.x_position, `Echo input ${index} X position`);
    const y = optionalFiniteNumber(old ? event['Y Position'] : event.y_position, `Echo input ${index} Y position`);
    const rotation = optionalFiniteNumber(old ? event.Rotation : event.rotation, `Echo input ${index} rotation`);
    return {
      tick: BigInt(frame),
      player: player2 ? 2 : 1,
      button: 1,
      down: asBoolean(old ? event.Hold : event.holding, `Echo input ${index} hold state`),
      ...(x !== undefined ? { x } : {}),
      ...(y !== undefined ? { y } : {}),
      ...(rotation !== undefined ? { rotation } : {}),
      ...(physicsExtension(event, index) ? { extension: physicsExtension(event, index) } : {}),
    };
  });
  return buildImportedReplay({
    formatId: 'echo',
    parserVersion: VERSION,
    bytes,
    ticksPerSecond: rate,
    inputs,
    extensions: { 'echo/metadata': { variant, startFrame } },
  });
}

async function parseBinary(bytes: Uint8Array) {
  if (!bytesStartWith(bytes, ECHO_MAGIC)) throw new ReplayValidationError(['Echo META header is missing']);
  const reader = new ReplayBinaryReader(bytes);
  if (reader.length < 48) throw new ReplayValidationError(['Echo header is truncated']);
  reader.seek(4);
  const debug = bytesStartWith(reader.peekBytes(4), ECHO_DEBUG);
  const eventSize = debug ? 34 : 6;
  reader.seek(24);
  const rate = reader.readF32LE();
  reader.seek(48);
  if (reader.remaining % eventSize !== 0) throw new ReplayValidationError(['Echo event table has a truncated record']);
  const count = reader.remaining / eventSize;
  if (count > 250_000) throw new ReplayValidationError(['Echo event count exceeds the supported limit']);
  const inputs: ImportedInput[] = [];
  for (let index = 0; index < count; index += 1) {
    const frame = reader.readU32LE();
    const down = reader.readU8();
    const player2 = reader.readU8();
    if (down > 1 || player2 > 1) throw new ReplayValidationError([`Echo event ${index} contains an invalid flag`]);
    let x: number | undefined;
    let y: number | undefined;
    let rotation: number | undefined;
    let extension: ImportedInput['extension'];
    if (debug) {
      x = reader.readF32LE();
      const yVelocity = reader.readF64LE();
      const xVelocity = reader.readF64LE();
      y = reader.readF32LE();
      rotation = reader.readF32LE();
      extension = {
        namespace: 'echo',
        eventType: 'physics-extension',
        critical: true,
        payload: { xVelocity, yVelocity },
      };
    }
    inputs.push({ tick: BigInt(frame), player: player2 === 1 ? 2 : 1, button: 1, down: down === 1, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}), ...(rotation !== undefined ? { rotation } : {}), ...(extension ? { extension } : {}) });
  }
  return buildImportedReplay({
    formatId: 'echo',
    parserVersion: VERSION,
    bytes,
    ticksPerSecond: rate,
    inputs,
    extensions: { 'echo/metadata': { variant: debug ? 'binary-debug' : 'binary' } },
  });
}

export const echoParser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) {
    if (bytesStartWith(input.bytes, ECHO_MAGIC)) return { confidence: 'exact', reason: 'Echo META binary header found' };
    if (looksLikeJson(input.bytes)) {
      try {
        const variant = jsonVariant(parseUtf8Json(input.bytes));
        if (variant) return { confidence: 'exact', reason: `Echo ${variant === 'json-old' ? 'legacy' : 'current'} JSON schema found` };
      } catch {
        // Fall through to the extension hint.
      }
    }
    return /\.echo(?:\.json)?$/i.test(input.filename)
      ? { confidence: 'possible', reason: 'Echo extension found without a supported payload signature' }
      : { confidence: 'none', reason: 'No Echo replay signature' };
  },
  async parse(input) {
    return bytesStartWith(input.bytes, ECHO_MAGIC) ? parseBinary(input.bytes) : parseJson(input.bytes);
  },
};
