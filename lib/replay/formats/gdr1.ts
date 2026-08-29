import { decode } from '@msgpack/msgpack';
import type { MacroParser } from '../interfaces';
import type { ImportedExtraEvent, ImportedInput, ImportedPlayerState } from './import-utils';
import {
  asArray,
  asBoolean,
  asFiniteNumber,
  asInteger,
  asObject,
  buildImportedReplay,
  looksLikeJson,
  optionalFiniteNumber,
  optionalString,
  parseUtf8Json,
  ticksFromSeconds,
  toJsonValue,
} from './import-utils';

const VERSION = '1.0.0';
const ROOT_FIELDS = new Set(['author', 'description', 'duration', 'gameVersion', 'version', 'framerate', 'seed', 'coins', 'ldm', 'bot', 'level', 'inputs', 'frameFixes']);
const INPUT_FIELDS = new Set(['frame', 'btn', '2p', 'down', 'correction']);
const FRAME_FIX_FIELDS = new Set(['frame', 'p1', 'p2']);
const FRAME_STATE_FIELDS = new Set(['x', 'y', 'r']);
function isGdrObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  return Array.isArray(object.inputs)
    && typeof object.gameVersion === 'number'
    && (object.version === undefined || typeof object.version === 'number')
    && (object.bot === undefined || (object.bot !== null && typeof object.bot === 'object' && !Array.isArray(object.bot)))
    && (object.level === undefined || (object.level !== null && typeof object.level === 'object' && !Array.isArray(object.level)));
}

function unknownFields(object: Record<string, unknown>, known: Set<string>) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => !known.has(key) && value !== undefined));
}

async function parseGdr(value: unknown, bytes: Uint8Array, formatId: 'gdr' | 'gdr-json') {
  const root = asObject(value, 'GDR replay');
  if (!isGdrObject(root)) throw new Error('The file does not match the GDR replay schema');
  const rate = root.framerate === undefined ? 240 : asFiniteNumber(root.framerate, 'GDR framerate');
  const sourceInputs = asArray(root.inputs, 'GDR inputs');
  const inputs: ImportedInput[] = [];
  const playerStates: ImportedPlayerState[] = [];
  const extraEvents: ImportedExtraEvent[] = [];

  sourceInputs.forEach((source, index) => {
    const item = asObject(source, `GDR input ${index}`);
    const tick = BigInt(asInteger(item.frame, `GDR input ${index} frame`));
    const player = asBoolean(item['2p'], `GDR input ${index} 2p`) ? 2 : 1;
    const correction = item.correction === undefined ? undefined : asObject(item.correction, `GDR input ${index} correction`);
    const input: ImportedInput = {
      tick,
      player,
      button: asInteger(item.btn, `GDR input ${index} button`),
      down: asBoolean(item.down, `GDR input ${index} down`),
    };

    if (correction) {
      input.x = optionalFiniteNumber(correction.xPos ?? correction.nodeXPos, `GDR input ${index} X position`);
      input.y = optionalFiniteNumber(correction.yPos ?? correction.nodeYPos, `GDR input ${index} Y position`);
      input.rotation = optionalFiniteNumber(correction.rotation, `GDR input ${index} rotation`);
      const correctionExtra = unknownFields(correction, new Set(['xPos', 'nodeXPos', 'yPos', 'nodeYPos', 'rotation', 'player2']));
      if (Object.keys(correctionExtra).length) {
        input.extension = {
          namespace: 'gdr',
          eventType: 'correction-extension',
          critical: true,
          payload: toJsonValue(correctionExtra),
        };
      }
    }

    const extra = unknownFields(item, INPUT_FIELDS);
    if (Object.keys(extra).length) {
      extraEvents.push({
        tick,
        kind: 'extension',
        namespace: 'gdr',
        eventType: 'input-extension',
        critical: true,
        payload: toJsonValue(extra),
      });
    }
    inputs.push(input);
  });

  if (root.frameFixes !== undefined) {
    asArray(root.frameFixes, 'GDR frame fixes').forEach((source, index) => {
      const fix = asObject(source, `GDR frame fix ${index}`);
      const tick = BigInt(asInteger(fix.frame, `GDR frame fix ${index} frame`));
      ([['p1', 1], ['p2', 2]] as const).forEach(([key, player]) => {
        if (fix[key] === undefined || fix[key] === null) return;
        const state = asObject(fix[key], `GDR frame fix ${index} ${key}`);
        const x = optionalFiniteNumber(state.x, `GDR frame fix ${index} ${key}.x`);
        const y = optionalFiniteNumber(state.y, `GDR frame fix ${index} ${key}.y`);
        const rotation = optionalFiniteNumber(state.r, `GDR frame fix ${index} ${key}.r`);
        if (x !== undefined || y !== undefined || rotation !== undefined) {
          playerStates.push({
            tick,
            player,
            ...(x !== undefined ? { x } : {}),
            ...(y !== undefined ? { y } : {}),
            ...(rotation !== undefined ? { rotation } : {}),
          });
        }
        const stateExtra = unknownFields(state, FRAME_STATE_FIELDS);
        if (Object.keys(stateExtra).length) {
          extraEvents.push({
            tick,
            kind: 'extension',
            namespace: 'gdr',
            eventType: 'frame-state-extension',
            critical: true,
            payload: { player, data: toJsonValue(stateExtra) },
          });
        }
      });
      const fixExtra = unknownFields(fix, FRAME_FIX_FIELDS);
      if (Object.keys(fixExtra).length) {
        extraEvents.push({
          tick,
          kind: 'extension',
          namespace: 'gdr',
          eventType: 'frame-fix-extension',
          critical: true,
          payload: toJsonValue(fixExtra),
        });
      }
    });
  }

  const replayExtra = unknownFields(root, ROOT_FIELDS);
  if (Object.keys(replayExtra).length) {
    extraEvents.push({
      tick: 0n,
      kind: 'extension',
      namespace: 'gdr',
      eventType: 'replay-extension',
      critical: true,
      payload: toJsonValue(replayExtra),
    });
  }

  const level = root.level === undefined ? undefined : asObject(root.level, 'GDR level');
  const bot = root.bot === undefined ? undefined : asObject(root.bot, 'GDR bot');
  const durationSeconds = root.duration === undefined ? undefined : asFiniteNumber(root.duration, 'GDR duration');
  const version = root.version === undefined ? undefined : asFiniteNumber(root.version, 'GDR version');
  const gameVersion = asFiniteNumber(root.gameVersion, 'GDR gameVersion');

  return buildImportedReplay({
    formatId,
    parserVersion: VERSION,
    bytes,
    ticksPerSecond: rate,
    levelId: level && level.id !== undefined && asInteger(level.id, 'GDR level id') > 0 ? String(level.id) : undefined,
    levelName: level ? optionalString(level.name, 'GDR level name') : undefined,
    replayVersion: version === undefined ? undefined : String(version),
    geometryDashVersion: String(gameVersion),
    durationTicks: durationSeconds === undefined ? undefined : ticksFromSeconds(durationSeconds, rate),
    inputs,
    playerStates,
    extraEvents,
    extensions: {
      'gdr/metadata': {
        author: optionalString(root.author, 'GDR author') ?? '',
        description: optionalString(root.description, 'GDR description') ?? '',
        seed: root.seed === undefined ? 0 : asFiniteNumber(root.seed, 'GDR seed'),
        coins: root.coins === undefined ? 0 : asFiniteNumber(root.coins, 'GDR coins'),
        ldm: root.ldm === undefined ? false : asBoolean(root.ldm, 'GDR ldm'),
        bot: bot ? toJsonValue(bot) : {},
      },
    },
  });
}

function decodeMessagePack(bytes: Uint8Array): unknown {
  return decode(bytes);
}

export const gdrParser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) {
    if (looksLikeJson(input.bytes)) return { confidence: 'none', reason: 'GDR MessagePack is binary' };
    try {
      const value = decodeMessagePack(input.bytes);
      return isGdrObject(value)
        ? { confidence: 'exact', reason: 'GDR MessagePack schema found' }
        : { confidence: 'none', reason: 'MessagePack data is not a GDR replay' };
    } catch {
      return /\.gdr$/i.test(input.filename)
        ? { confidence: 'possible', reason: 'GDR extension found, but the MessagePack payload is invalid' }
        : { confidence: 'none', reason: 'No GDR MessagePack schema' };
    }
  },
  async parse(input) {
    return parseGdr(decodeMessagePack(input.bytes), input.bytes, 'gdr');
  },
};

export const gdrJsonParser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) {
    if (!looksLikeJson(input.bytes)) return { confidence: 'none', reason: 'GDR JSON must be JSON' };
    try {
      const value = parseUtf8Json(input.bytes);
      return isGdrObject(value)
        ? { confidence: 'exact', reason: 'GDR JSON schema found' }
        : { confidence: 'none', reason: 'JSON data is not a GDR replay' };
    } catch {
      return /\.gdr\.json$/i.test(input.filename)
        ? { confidence: 'possible', reason: 'GDR JSON extension found, but the JSON is invalid' }
        : { confidence: 'none', reason: 'No GDR JSON schema' };
    }
  },
  async parse(input) {
    return parseGdr(parseUtf8Json(input.bytes), input.bytes, 'gdr-json');
  },
};
