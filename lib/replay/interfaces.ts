import type {
  CanonicalReplayV1,
  ConversionIssue,
  ExportArtifact,
  ExportAssessment,
  JsonValue,
  ParseResult,
  ProbeInput,
} from './types';

export interface MacroParser {
  readonly implementationVersion: string;
  probe(input: ProbeInput): Promise<{
    confidence: 'none' | 'possible' | 'strong' | 'exact';
    reason: string;
  }>;
  parse(input: ProbeInput): Promise<ParseResult>;
}

export interface MacroExporter {
  readonly implementationVersion: string;
  assess(
    replay: CanonicalReplayV1,
    options?: Readonly<Record<string, JsonValue>>,
  ): ExportAssessment;
  export(
    replay: CanonicalReplayV1,
    options?: Readonly<Record<string, JsonValue>>,
  ): Promise<ExportArtifact>;
  verifyRoundTrip?(
    source: CanonicalReplayV1,
    reparsed: CanonicalReplayV1,
  ): ConversionIssue[];
}

export interface MacroFormatDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly shortName: string;
  readonly extensions: readonly string[];
  readonly mediaTypes: readonly string[];
  readonly status: 'implemented' | 'planned' | 'disabled';
  readonly summary: string;
  readonly parser?: MacroParser;
  readonly exporter?: MacroExporter;
}

export interface ReplayToolDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly status: 'active' | 'deprecated' | 'planned';
  readonly summary: string;
}

export interface FormatCompatibility {
  readonly formatId: string;
  readonly replayToolId: string;
  readonly direction: 'import' | 'export' | 'both';
  readonly support: 'native' | 'plugin' | 'partial';
  readonly verification: 'verified' | 'community-reported' | 'unknown';
  readonly toolVersionRange?: string;
  readonly recommended?: boolean;
  readonly notes?: string;
}
