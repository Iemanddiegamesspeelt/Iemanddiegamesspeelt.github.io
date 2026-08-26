import type { MacroParser } from '../interfaces';
import { ReplayValidationError } from '../schema';
import type { ImportedExtraEvent, ImportedInput, ImportedPlayerState } from './import-utils';
import {
  asArray,
  asFiniteNumber,
  asInteger,
  asObject,
  buildImportedReplay,
  looksLikeJson,
  optionalFiniteNumber,
  parseUtf8Json,
} from './import-utils';

const VERSION = '1.0.0';

function isTasbot(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  return typeof object.fps === 'number' && Array.isArray(object.macro);
}

export const tasbotJsonParser: MacroParser = {
  implementationVersion: VERSION,
  async probe(input) {
    if (!looksLikeJson(input.bytes)) return { confidence: 'none', reason: 'TASBot replay must be JSON' };
    try {
      return isTasbot(parseUtf8Json(input.bytes))
        ? { confidence: 'exact', reason: 'TASBot macro JSON schema found' }
        : { confidence: 'none', reason: 'JSON data is not a TASBot replay' };
    } catch {
      return { confidence: 'none', reason: 'No TASBot JSON schema' };
    }
  },
  async parse(input) {
    const root = asObject(parseUtf8Json(input.bytes), 'TASBot replay');
    if (!isTasbot(root)) throw new ReplayValidationError(['The file does not match the TASBot replay schema']);
    const rate = asFiniteNumber(root.fps, 'TASBot fps');
    const inputs: ImportedInput[] = [];
    const playerStates: ImportedPlayerState[] = [];
    const extraEvents: ImportedExtraEvent[] = [];

    asArray(root.macro, 'TASBot macro').forEach((source, index) => {
      const event = asObject(source, `TASBot event ${index}`);
      const tick = BigInt(asInteger(event.frame, `TASBot event ${index} frame`));
      ([['player_1', 1], ['player_2', 2]] as const).forEach(([key, player]) => {
        const action = asObject(event[key], `TASBot event ${index} ${key}`);
        const click = asInteger(action.click, `TASBot event ${index} ${key}.click`);
        const x = optionalFiniteNumber(action.x_position, `TASBot event ${index} ${key}.x_position`);
        if (click === 1 || click === 2) {
          inputs.push({ tick, player, button: 1, down: click === 1, ...(x !== undefined ? { x } : {}) });
        } else if (click !== 0) {
          extraEvents.push({
            tick,
            kind: 'extension',
            namespace: 'tasbot',
            eventType: 'unknown-click-state',
            critical: true,
            payload: { player, click },
          });
        } else if (x !== undefined) {
          playerStates.push({ tick, player, x });
        }
      });
    });

    return buildImportedReplay({
      formatId: 'tasbot-json',
      parserVersion: VERSION,
      bytes: input.bytes,
      ticksPerSecond: rate,
      inputs,
      playerStates,
      extraEvents,
      extensions: { 'tasbot/metadata': { schema: 'fps+macro' } },
    });
  },
};
