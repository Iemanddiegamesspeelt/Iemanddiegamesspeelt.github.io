import { z } from 'zod';
import type { CanonicalReplayV1, JsonValue } from './types';

const uintString = z.string().max(32).regex(/^(0|[1-9]\d*)$/, 'Expected an unsigned integer string');
const finiteNumber = z.number().refine(Number.isFinite, 'Expected a finite number');
const provenance = z
  .object({
    kind: z.enum(['source-file', 'user', 'level-provider', 'derived']),
    detail: z.string().max(500).optional(),
  })
  .strict();

const stringFact = z.object({ value: z.string().max(500), provenance }).strict();
const numberFact = z.object({ value: finiteNumber, provenance }).strict();
const rational = z
  .object({
    numerator: uintString.refine((value) => value !== '0', 'Numerator must be positive'),
    denominator: uintString.refine((value) => value !== '0', 'Denominator must be positive'),
  })
  .strict();

const replayControl = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['jump', 'left', 'right']) }).strict(),
  z.object({ kind: z.literal('opaque'), namespace: z.string().min(1).max(120), code: z.string().min(1).max(120) }).strict(),
]);

const eventBase = {
  tick: uintString,
  order: z.number().int().nonnegative().max(1_000_000),
};

const replayEvent = z.discriminatedUnion('kind', [
  z.object({
    ...eventBase,
    kind: z.literal('input'),
    player: z.union([z.literal(1), z.literal(2)]),
    control: replayControl,
    state: z.enum(['press', 'release']),
  }).strict(),
  z.object({
    ...eventBase,
    kind: z.literal('player-state'),
    player: z.union([z.literal(1), z.literal(2)]),
    x: finiteNumber.optional(),
    y: finiteNumber.optional(),
    rotation: finiteNumber.optional(),
  }).strict(),
  z.object({
    ...eventBase,
    kind: z.literal('death'),
    player: z.union([z.literal(1), z.literal(2)]).optional(),
  }).strict(),
  z.object({
    ...eventBase,
    kind: z.literal('checkpoint'),
    action: z.enum(['create', 'activate', 'remove']),
    checkpointId: z.string().max(120).optional(),
    player: z.union([z.literal(1), z.literal(2)]).optional(),
  }).strict(),
  z.object({
    ...eventBase,
    kind: z.literal('extension'),
    namespace: z.string().min(1).max(120),
    eventType: z.string().min(1).max(120),
    critical: z.boolean(),
    payload: z.unknown(),
  }).strict(),
]);

const canonicalReplaySchema = z
  .object({
    schema: z.literal('macrohub/replay'),
    schemaVersion: z.literal(1),
    source: z.object({
      formatId: z.string().min(1).max(80),
      parserVersion: z.string().min(1).max(80),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict(),
    clock: z.object({ ticksPerSecond: rational }).strict(),
    level: z.object({
      id: stringFact.optional(),
      name: stringFact.optional(),
    }).strict(),
    recording: z.object({
      replayVersion: stringFact.optional(),
      geometryDashVersion: stringFact.optional(),
      declaredRate: z.object({
        value: z.object({ kind: z.enum(['tps', 'fps']), value: rational }).strict(),
        provenance,
      }).strict().optional(),
      completionPercent: numberFact.optional(),
    }).strict(),
    durationTicks: uintString.optional(),
    events: z.array(replayEvent).max(250_000),
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export class ReplayValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems[0] ? `Replay validation failed: ${problems[0]}` : 'Replay validation failed');
    this.name = 'ReplayValidationError';
  }
}

function jsonWeight(value: unknown, depth = 0): number {
  if (depth > 32) throw new ReplayValidationError(['Extension data exceeds the maximum depth']);
  if (value === null || typeof value === 'boolean') return 1;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new ReplayValidationError(['Extension data contains a non-canonical number']);
    return 1;
  }
  if (typeof value === 'string') {
    if (value.length > 65_536) throw new ReplayValidationError(['An extension string exceeds 64 KiB']);
    return value.length;
  }
  if (Array.isArray(value)) return value.reduce((total, item) => total + jsonWeight(item, depth + 1), 0);
  if (typeof value === 'object' && value) {
    return Object.entries(value).reduce((total, [key, item]) => total + key.length + jsonWeight(item, depth + 1), 0);
  }
  throw new ReplayValidationError(['Extension data contains a non-JSON value']);
}

export function validateCanonicalReplay(value: unknown): CanonicalReplayV1 {
  const result = canonicalReplaySchema.safeParse(value);
  if (!result.success) {
    throw new ReplayValidationError(result.error.issues.slice(0, 25).map((issue) => `${issue.path.join('.') || 'replay'}: ${issue.message}`));
  }

  const replay = result.data as CanonicalReplayV1;
  const problems: string[] = [];
  const seen = new Set<string>();
  let previousTick = -1n;
  let previousOrder = -1;
  let lastTick = 0n;

  for (const event of replay.events) {
    const tick = BigInt(event.tick);
    const key = `${event.tick}:${event.order}`;
    if (seen.has(key)) problems.push(`Duplicate event position ${key}`);
    seen.add(key);
    if (tick < previousTick || (tick === previousTick && event.order < previousOrder)) {
      problems.push('Events must be sorted by tick and stable order');
      break;
    }
    previousTick = tick;
    previousOrder = event.order;
    lastTick = tick;
    if (event.kind === 'extension' && jsonWeight(event.payload) > 1_048_576) {
      problems.push('An event extension exceeds 1 MiB');
    }
  }

  if (replay.durationTicks !== undefined && BigInt(replay.durationTicks) < lastTick) {
    problems.push('durationTicks cannot be earlier than the last event');
  }
  if (replay.recording.completionPercent && (replay.recording.completionPercent.value < 0 || replay.recording.completionPercent.value > 100)) {
    problems.push('Completion percentage must be between 0 and 100');
  }
  if (replay.extensions) {
    for (const key of Object.keys(replay.extensions)) {
      if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(key)) problems.push(`Extension key ${key} is not namespaced`);
    }
    if (jsonWeight(replay.extensions) > 1_048_576) problems.push('Replay extensions exceed 1 MiB');
  }
  if (problems.length) throw new ReplayValidationError(problems);
  return replay;
}

export function stableStringify(value: JsonValue | CanonicalReplayV1): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, normalize(item)]));
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
