import { detectReplayFormat } from './conversion';
import type { CanonicalReplayV1, ProbeInput } from './types';

export function hasRecordedPath(replay: CanonicalReplayV1): boolean {
  return replay.events.some((event) => event.kind === 'player-state' && Number.isFinite(event.x) && Number.isFinite(event.y));
}

// Older importers preserved the original file but did not extract its frame fixes.
// Recovery is read-only and must never make a usable macro fail to load.
export async function recoverRecordedPath(
  canonicalReplay: CanonicalReplayV1,
  loadOriginal: () => Promise<ProbeInput | null>,
): Promise<CanonicalReplayV1> {
  if (hasRecordedPath(canonicalReplay)) return canonicalReplay;
  try {
    const original = await loadOriginal();
    if (!original) return canonicalReplay;
    const detection = await detectReplayFormat(original);
    if (!detection.format?.parser) return canonicalReplay;
    const { replay } = await detection.format.parser.parse(original);
    return hasRecordedPath(replay) ? replay : canonicalReplay;
  } catch {
    return canonicalReplay;
  }
}
