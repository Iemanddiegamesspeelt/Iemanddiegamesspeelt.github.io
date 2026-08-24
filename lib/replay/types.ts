export type UIntString = `${bigint}`;
export type NamespacedKey = `${string}/${string}`;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface Rational {
  numerator: UIntString;
  denominator: UIntString;
}

export interface Provenance {
  kind: 'source-file' | 'user' | 'level-provider' | 'derived';
  detail?: string;
}

export interface Fact<T> {
  value: T;
  provenance: Provenance;
}

export type ReplayControl =
  | { kind: 'jump' | 'left' | 'right' }
  | { kind: 'opaque'; namespace: string; code: string };

export type ReplayEvent =
  | {
      tick: UIntString;
      order: number;
      kind: 'input';
      player: 1 | 2;
      control: ReplayControl;
      state: 'press' | 'release';
    }
  | {
      tick: UIntString;
      order: number;
      kind: 'player-state';
      player: 1 | 2;
      x?: number;
      y?: number;
      rotation?: number;
    }
  | {
      tick: UIntString;
      order: number;
      kind: 'death';
      player?: 1 | 2;
    }
  | {
      tick: UIntString;
      order: number;
      kind: 'checkpoint';
      action: 'create' | 'activate' | 'remove';
      checkpointId?: string;
      player?: 1 | 2;
    }
  | {
      tick: UIntString;
      order: number;
      kind: 'extension';
      namespace: string;
      eventType: string;
      critical: boolean;
      payload: JsonValue;
    };

export interface CanonicalReplayV1 {
  schema: 'macrohub/replay';
  schemaVersion: 1;
  source: {
    formatId: string;
    parserVersion: string;
    sha256: string;
  };
  clock: {
    ticksPerSecond: Rational;
  };
  level: {
    id?: Fact<string>;
    name?: Fact<string>;
  };
  recording: {
    replayVersion?: Fact<string>;
    geometryDashVersion?: Fact<string>;
    declaredRate?: Fact<{
      kind: 'tps' | 'fps';
      value: Rational;
    }>;
    completionPercent?: Fact<number>;
  };
  durationTicks?: UIntString;
  events: ReplayEvent[];
  extensions?: Record<NamespacedKey, JsonValue>;
}

export type ConversionIssueCategory =
  | 'unsupported-format'
  | 'invalid-replay'
  | 'missing-required-data'
  | 'gameplay-loss'
  | 'timing-loss'
  | 'metadata-loss'
  | 'extension-loss'
  | 'compatibility';

export interface ConversionIssue {
  code: string;
  severity: 'info' | 'warning' | 'error';
  category: ConversionIssueCategory;
  message: string;
  paths?: string[];
  requiresAcknowledgement?: boolean;
}

export type ExportAssessment =
  | { decision: 'blocked'; issues: ConversionIssue[] }
  | {
      decision: 'allowed';
      fidelity: 'lossless' | 'compatible' | 'metadata-loss';
      issues: ConversionIssue[];
    };

export interface ExportArtifact {
  bytes: Uint8Array;
  filename: string;
  mediaType: string;
  extension: string;
}

export interface ProbeInput {
  bytes: Uint8Array;
  filename: string;
  mediaType?: string;
}

export interface ParseResult {
  replay: CanonicalReplayV1;
  diagnostics: ConversionIssue[];
}



