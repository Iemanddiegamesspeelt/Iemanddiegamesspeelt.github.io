import { getChatGPTUser } from '../../app/chatgpt-auth';

export async function requireApiUser() {
  const user = await getChatGPTUser();
  if (!user) {
    return {
      user: null,
      response: Response.json(
        { error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } },
        { status: 401 },
      ),
    } as const;
  }
  return { user, response: null } as const;
}

export function assertSameOrigin(request: Request): Response | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const requestUrl = new URL(request.url);
  if (new URL(origin).origin !== requestUrl.origin) {
    return Response.json(
      { error: { code: 'INVALID_ORIGIN', message: 'Cross-origin write request rejected.' } },
      { status: 403 },
    );
  }
  return null;
}

export function jsonError(code: string, message: string, status = 400, details?: unknown) {
  return Response.json({ error: { code, message, details } }, { status });
}

export function rejectOversizedRequest(request: Request, maxBytes = 11 * 1024 * 1024): Response | null {
  const raw = request.headers.get('content-length');
  if (!raw) return null;
  const size = Number(raw);
  if (!Number.isFinite(size) || size < 0 || size > maxBytes) {
    return jsonError('REQUEST_TOO_LARGE', 'The request is too large.', 413);
  }
  return null;
}

export async function readJsonBody(request: Request, maxBytes = 64 * 1024): Promise<
  | { data: unknown; response: null }
  | { data: null; response: Response }
> {
  const sizeError = rejectOversizedRequest(request, maxBytes);
  if (sizeError) return { data: null, response: sizeError };
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) return { data: null, response: jsonError('REQUEST_TOO_LARGE', 'The request is too large.', 413) };
  try {
    return { data: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), response: null };
  } catch {
    return { data: null, response: jsonError('INVALID_JSON', 'The request body must be valid JSON.', 400) };
  }
}
