export async function anonymousActorHash(request: Request): Promise<string> {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'local';
  const agent = request.headers.get('user-agent')?.slice(0, 180) ?? 'unknown';
  return hmacActor(`${ip}|${agent}`);
}

export async function userActorHash(userId: string): Promise<string> {
  return hmacActor(`user|${userId}`);
}

async function hmacActor(value: string): Promise<string> {
  const secret = process.env.RATE_LIMIT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') throw new Error('RATE_LIMIT_SECRET is required');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret ?? 'macrohub-local-development-only'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
