import { detectReplayFormat } from '../replay/conversion';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_EVENTS = 250_000;

const forbiddenExtensions = new Set([
  '.exe', '.dll', '.com', '.bat', '.cmd', '.ps1', '.sh', '.js', '.mjs', '.html',
  '.htm', '.svg', '.msi', '.scr', '.jar', '.app', '.dmg',
]);

const executableSignatures = [
  [0x4d, 0x5a],
  [0x7f, 0x45, 0x4c, 0x46],
  [0xca, 0xfe, 0xba, 0xbe],
];

export class UnsafeUploadError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'UnsafeUploadError';
  }
}

export function sanitizeFilename(filename: string): string {
  const leaf = filename.normalize('NFC').split(/[\\/]/).pop() ?? 'replay';
  const cleaned = leaf
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[^\p{L}\p{N}._ -]+/gu, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || 'replay';
}

function extensionOf(filename: string): string {
  const lower = filename.toLowerCase();
  for (const extension of ['.macrohub', '.gdr.json', '.mhr.json', '.echo.json']) {
    if (lower.endsWith(extension)) return extension;
  }
  const dot = lower.lastIndexOf('.');
  return dot === -1 ? '' : lower.slice(dot);
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

export async function validateUpload(file: File): Promise<{
  filename: string;
  bytes: Uint8Array;
  detectedFormatId: string;
  contentType: string;
}> {
  if (file.size <= 0) throw new UnsafeUploadError('The selected file is empty.', 'EMPTY_FILE');
  if (file.size > MAX_UPLOAD_BYTES) throw new UnsafeUploadError('Replay files are limited to 10 MiB.', 'FILE_TOO_LARGE');

  const filename = sanitizeFilename(file.name);
  const extension = extensionOf(filename);
  if (forbiddenExtensions.has(extension)) {
    throw new UnsafeUploadError('Executable, script, and active-content files are not accepted.', 'ACTIVE_CONTENT');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (executableSignatures.some((signature) => startsWith(bytes, signature))) {
    throw new UnsafeUploadError('The file signature indicates executable content.', 'EXECUTABLE_SIGNATURE');
  }
  const prefix = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 512)).trimStart().toLowerCase();
  if (prefix.startsWith('<!doctype html') || prefix.startsWith('<html') || prefix.startsWith('<svg') || prefix.startsWith('#!')) {
    throw new UnsafeUploadError('Active content is not accepted as a replay.', 'ACTIVE_CONTENT');
  }

  const detection = await detectReplayFormat({ bytes, filename, mediaType: file.type });
  if (!detection.format) throw new UnsafeUploadError(detection.reason, 'UNRECOGNIZED_FORMAT');
  if (detection.format.status !== 'implemented' || !detection.format.parser) {
    throw new UnsafeUploadError(
      `${detection.format.displayName} is recognized, but its verified parser is not available yet.`,
      'PARSER_NOT_IMPLEMENTED',
    );
  }
  if (!detection.format.extensions.includes(extension)) {
    throw new UnsafeUploadError('The filename extension does not match the detected replay format.', 'EXTENSION_MISMATCH');
  }

  const contentType = detection.format.mediaTypes.includes(file.type)
    ? file.type
    : detection.format.mediaTypes[0] ?? 'application/octet-stream';
  return { filename, bytes, detectedFormatId: detection.format.id, contentType };
}
