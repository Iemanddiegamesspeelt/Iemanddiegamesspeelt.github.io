import JSZip from 'jszip';
import { convertUniversalReplay } from '../../lib/replay/conversion';
import { formatRegistry } from '../../lib/replay/registry';
import type { CanonicalReplayV1, ExportArtifact } from '../../lib/replay/types';

export function downloadArtifact(artifact: ExportArtifact) {
  const blob = new Blob([artifact.bytes.slice().buffer], { type: artifact.mediaType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

export async function buildReplayZip(replay: CanonicalReplayV1, targetIds: string[]) {
  const zip = new JSZip();
  const failures: string[] = [];
  let count = 0;
  for (const targetId of targetIds) {
    try {
      const { artifact } = await convertUniversalReplay(replay, targetId);
      const format = formatRegistry.find((item) => item.id === targetId);
      zip.file(`${format?.shortName ?? targetId}-${artifact.filename}`, artifact.bytes);
      count += 1;
    } catch (error) {
      failures.push(`${targetId}: ${error instanceof Error ? error.message : 'conversion failed'}`);
    }
  }
  const readme = [
    'MacroHub conversion package',
    '',
    `${count} replay format${count === 1 ? '' : 's'} generated.`,
    'Use only the file format supported by your installed replay tool and version.',
    'Macro playback is not Geometry Dash leaderboard completion proof.',
    failures.length ? `\nSkipped:\n${failures.map((item) => `- ${item}`).join('\n')}` : '',
  ].join('\n');
  zip.file('README.txt', readme);
  return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), count, failures };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
