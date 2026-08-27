import { assessConversion } from './conversion';
import { formatCompatibilityRegistry, formatRegistry } from './registry';
import type { CanonicalReplayV1 } from './types';

export function analyzeReplay(replay: CanonicalReplayV1) {
  const inputEvents = replay.events.filter((event) => event.kind === 'input');
  const player1Inputs = inputEvents.filter((event) => event.player === 1).length;
  const player2Inputs = inputEvents.filter((event) => event.player === 2).length;
  const rate = Number(BigInt(replay.clock.ticksPerSecond.numerator)) / Number(BigInt(replay.clock.ticksPerSecond.denominator));
  const durationTicks = replay.durationTicks ? Number(BigInt(replay.durationTicks)) : replay.events.reduce((max, event) => Math.max(max, Number(BigInt(event.tick))), 0);
  const targets = formatRegistry
    .filter((format) => Boolean(format.exporter))
    .map((format) => {
      const assessment = assessConversion(replay, format.id);
      return {
        id: format.id,
        name: format.displayName,
        shortName: format.shortName,
        extension: format.extensions[0],
        available: assessment.decision === 'allowed',
        fidelity: assessment.decision === 'allowed' ? assessment.fidelity : null,
        issues: assessment.issues,
        compatibleToolIds: formatCompatibilityRegistry
          .filter((item) => item.formatId === format.id && item.verification !== 'unknown' && (item.direction === 'import' || item.direction === 'both'))
          .map((item) => item.replayToolId),
        toolCompatibility: formatCompatibilityRegistry
          .filter((item) => item.formatId === format.id && item.verification !== 'unknown' && (item.direction === 'import' || item.direction === 'both'))
          .map((item) => ({
            toolId: item.replayToolId,
            verification: item.verification,
            recommended: item.recommended ?? false,
            note: item.notes ?? null,
          })),
      };
    });

  return {
    levelId: replay.level.id?.value ?? null,
    levelName: replay.level.name?.value ?? null,
    geometryDashVersion: replay.recording.geometryDashVersion?.value ?? null,
    completionPercent: replay.recording.completionPercent?.value ?? null,
    rate: Number.isFinite(rate) ? rate : null,
    rateKind: replay.recording.declaredRate?.value.kind ?? 'tps',
    inputCount: inputEvents.length,
    eventCount: replay.events.length,
    player1Inputs,
    player2Inputs,
    durationSeconds: rate > 0 ? durationTicks / rate : null,
    timeline: inputEvents.slice(0, 80).map((event) => ({
      tick: event.tick,
      player: event.player,
      state: event.state,
      control: event.control.kind,
    })),
    targets,
  };
}
