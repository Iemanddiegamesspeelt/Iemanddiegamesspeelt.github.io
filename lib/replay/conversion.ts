import type { MacroFormatDefinition } from './interfaces';
import { getCompatibility, getFormat, formatRegistry } from './registry';
import { stableStringify, validateCanonicalReplay } from './schema';
import type {
  CanonicalReplayV1,
  ConversionIssue,
  ExportArtifact,
  ExportAssessment,
  ProbeInput,
} from './types';

const confidenceScore = { none: 0, possible: 1, strong: 2, exact: 3 } as const;

export interface ResolvedToolCompatibility {
  replayToolId: string;
  verification: 'verified' | 'community-reported';
  notes?: string;
}

export async function detectReplayFormat(input: ProbeInput): Promise<{
  format: MacroFormatDefinition | null;
  confidence: keyof typeof confidenceScore;
  reason: string;
}> {
  const candidates = await Promise.all(
    formatRegistry
      .filter((format) => format.parser)
      .map(async (format) => {
        try {
          return { format, result: await format.parser!.probe(input) };
        } catch {
          return { format, result: { confidence: 'none' as const, reason: 'Detector rejected the file prefix.' } };
        }
      }),
  );
  candidates.sort((a, b) => confidenceScore[b.result.confidence] - confidenceScore[a.result.confidence]);
  const best = candidates[0];
  if (!best || best.result.confidence === 'none') {
    const extensionMatch = formatRegistry.find((format) =>
      format.extensions.some((extension) => input.filename.toLowerCase().endsWith(extension)),
    );
    if (extensionMatch) {
      return {
        format: extensionMatch,
        confidence: 'possible',
        reason: `${extensionMatch.displayName} is recognized, but its parser is not implemented.`,
      };
    }
    return { format: null, confidence: 'none', reason: 'No supported replay signature was found.' };
  }
  return { format: best.format, confidence: best.result.confidence, reason: best.result.reason };
}

export function assessConversion(
  replay: CanonicalReplayV1,
  targetFormatId: string,
  replayToolId?: string | null,
  resolvedToolCompatibility?: ResolvedToolCompatibility,
): ExportAssessment {
  const target = getFormat(targetFormatId);
  const issues: ConversionIssue[] = [];
  if (!target || target.status !== 'implemented' || !target.exporter) {
    return {
      decision: 'blocked',
      issues: [{
        code: 'EXPORTER_NOT_IMPLEMENTED',
        severity: 'error',
        category: 'unsupported-format',
        message: target
          ? `${target.displayName} is cataloged but has no verified exporter yet.`
          : 'The requested format is not registered.',
      }],
    };
  }
  if (replayToolId) {
    const registryCompatibility = resolvedToolCompatibility ? undefined : getCompatibility(targetFormatId, replayToolId);
    const compatible = resolvedToolCompatibility
      ? resolvedToolCompatibility.replayToolId === replayToolId
      : Boolean(registryCompatibility
        && registryCompatibility.verification !== 'unknown'
        && (registryCompatibility.direction === 'import' || registryCompatibility.direction === 'both'));
    if (!compatible) {
      return {
        decision: 'blocked',
        issues: [{
          code: 'TOOL_FORMAT_NOT_COMPATIBLE',
          severity: 'error',
          category: 'compatibility',
          message: 'This format is not verified as an importable target for the selected replay tool.',
        }],
      };
    }
    const verification = resolvedToolCompatibility?.verification ?? registryCompatibility?.verification;
    if (verification === 'community-reported') {
      issues.push({
        code: 'COMPATIBILITY_NOT_VERIFIED',
        severity: 'warning',
        category: 'compatibility',
        message: resolvedToolCompatibility?.notes ?? registryCompatibility?.notes ?? 'Compatibility is based on community reports.',
        requiresAcknowledgement: false,
      });
    }
  }
  const exporterAssessment = target.exporter.assess(replay);
  if (exporterAssessment.decision === 'blocked') return exporterAssessment;
  return { ...exporterAssessment, issues: [...issues, ...exporterAssessment.issues] };
}

export async function convertReplay(
  replayInput: CanonicalReplayV1,
  targetFormatId: string,
  options: {
    replayToolId?: string | null;
    acknowledgedIssueCodes?: string[];
    resolvedToolCompatibility?: ResolvedToolCompatibility;
  } = {},
): Promise<{ artifact: ExportArtifact; assessment: ExportAssessment }> {
  const replay = validateCanonicalReplay(replayInput);
  const assessment = assessConversion(replay, targetFormatId, options.replayToolId, options.resolvedToolCompatibility);
  if (assessment.decision === 'blocked') {
    throw new ConversionBlockedError(assessment.issues);
  }
  const unacknowledged = assessment.issues.filter(
    (issue) => issue.requiresAcknowledgement && !options.acknowledgedIssueCodes?.includes(issue.code),
  );
  if (unacknowledged.length) throw new ConversionBlockedError(unacknowledged);

  const target = getFormat(targetFormatId);
  if (!target?.exporter) throw new ConversionBlockedError(assessment.issues);
  const artifact = await target.exporter.export(replay);

  if (target.parser) {
    const reparsed = await target.parser.parse({
      bytes: artifact.bytes,
      filename: artifact.filename,
      mediaType: artifact.mediaType,
    });
    const roundTripIssues = target.exporter.verifyRoundTrip
      ? target.exporter.verifyRoundTrip(replay, reparsed.replay)
      : stableStringify(reparsed.replay) === stableStringify(replay)
        ? []
        : [{
            code: 'ROUND_TRIP_MISMATCH',
            severity: 'error' as const,
            category: 'gameplay-loss' as const,
            message: 'Generated replay failed semantic round-trip verification.',
          }];
    if (roundTripIssues.length) {
      throw new ConversionBlockedError(roundTripIssues);
    }
  }

  return { artifact, assessment };
}

export function listAvailableExports(replay: CanonicalReplayV1, replayToolId?: string | null) {
  return formatRegistry
    .map((format) => ({ format, assessment: assessConversion(replay, format.id, replayToolId) }))
    .filter((item) => item.assessment.decision === 'allowed');
}

export class ConversionBlockedError extends Error {
  constructor(public readonly issues: ConversionIssue[]) {
    super(issues.map((issue) => issue.message).join(' '));
    this.name = 'ConversionBlockedError';
  }
}
