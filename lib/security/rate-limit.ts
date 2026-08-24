type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let checks = 0;

function removeExpiredBuckets(now: number) {
  checks += 1;
  if (checks % 200 !== 0 && buckets.size < 10_000) return;
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  if (buckets.size > 10_000) {
    const oldest = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt).slice(0, buckets.size - 10_000);
    for (const [key] of oldest) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

function checkLocalRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now();
  removeExpiredBuckets(now);
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, remaining: options.limit - 1, retryAfterSeconds: 0 };
  }
  if (current.count >= options.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }
  current.count += 1;
  return { allowed: true, remaining: options.limit - current.count, retryAfterSeconds: 0 };
}

export async function checkRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  const prisma = getPrisma();
  if (!prisma) return checkLocalRateLimit(key, options);
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / options.windowMs) * options.windowMs);
  const expiresAt = new Date(windowStart.getTime() + options.windowMs * 2);
  try {
    const row = await prisma.rateLimitBucket.upsert({
      where: { bucketKey_windowStart: { bucketKey: key.slice(0, 191), windowStart } },
      create: { bucketKey: key.slice(0, 191), windowStart, count: 1, expiresAt },
      update: { count: { increment: 1 }, expiresAt },
      select: { count: true },
    });
    if ((now & 255) === 0) void prisma.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: new Date(now) } } }).catch(() => undefined);
    const remaining = Math.max(0, options.limit - row.count);
    return {
      allowed: row.count <= options.limit,
      remaining,
      retryAfterSeconds: row.count <= options.limit ? 0 : Math.max(1, Math.ceil((windowStart.getTime() + options.windowMs - now) / 1000)),
    };
  } catch {
    return checkLocalRateLimit(key, options);
  }
}

export function rateLimitHeaders(result: RateLimitResult): HeadersInit {
  return {
    'RateLimit-Remaining': String(result.remaining),
    ...(result.retryAfterSeconds ? { 'Retry-After': String(result.retryAfterSeconds) } : {}),
  };
}
import 'server-only';
import { getPrisma } from '../db/prisma';
