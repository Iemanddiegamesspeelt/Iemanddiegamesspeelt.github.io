import type { CanonicalReplayV1, ReplayEvent } from './types';

function makeInputs(count: number, durationTicks: number, includePlayer2 = false): ReplayEvent[] {
  const events: ReplayEvent[] = [];
  const step = Math.max(24, Math.floor(durationTicks / Math.max(1, Math.ceil(count / 2))));
  let tick = 80;
  let order = 0;
  for (let index = 0; index < count; index += 2) {
    const player: 1 | 2 = includePlayer2 && index % 10 === 0 ? 2 : 1;
    events.push({ tick: String(tick) as `${bigint}`, order: order++, kind: 'input', player, control: { kind: 'jump' }, state: 'press' });
    events.push({ tick: String(Math.min(tick + 8, durationTicks)) as `${bigint}`, order: order++, kind: 'input', player, control: { kind: 'jump' }, state: 'release' });
    tick = Math.min(tick + step, durationTicks - 8);
  }
  return events.sort((a, b) => Number(BigInt(a.tick) - BigInt(b.tick)) || a.order - b.order).map((event, index) => ({ ...event, order: index }));
}

export function createDemoReplay(options: {
  levelId: string;
  levelName: string;
  tps: number;
  durationSeconds: number;
  inputCount: number;
  gdVersion: string;
  completion?: number;
  player2?: boolean;
}): CanonicalReplayV1 {
  const durationTicks = Math.round(options.durationSeconds * options.tps);
  return {
    schema: 'macrohub/replay',
    schemaVersion: 1,
    source: {
      formatId: 'development-demo',
      parserVersion: 'seed-1',
      sha256: 'd'.repeat(64),
    },
    clock: {
      ticksPerSecond: { numerator: String(options.tps) as `${bigint}`, denominator: '1' },
    },
    level: {
      id: { value: options.levelId, provenance: { kind: 'source-file' } },
      name: { value: options.levelName, provenance: { kind: 'level-provider', detail: 'Development seed data' } },
    },
    recording: {
      geometryDashVersion: { value: options.gdVersion, provenance: { kind: 'source-file' } },
      declaredRate: {
        value: { kind: 'tps', value: { numerator: String(options.tps) as `${bigint}`, denominator: '1' } },
        provenance: { kind: 'source-file' },
      },
      ...(options.completion === undefined ? {} : { completionPercent: { value: options.completion, provenance: { kind: 'derived' as const } } }),
    },
    durationTicks: String(durationTicks) as `${bigint}`,
    events: makeInputs(options.inputCount, durationTicks, options.player2),
    extensions: {
      'macrohub/demo': { developmentData: true, notice: 'Synthetic events for development preview only' },
    },
  };
}


