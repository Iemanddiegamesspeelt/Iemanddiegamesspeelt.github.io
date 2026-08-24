import { autocompleteRecords } from '../../../lib/data/repository';
import { anonymousActorHash } from '../../../lib/security/actor';
import { checkRateLimit, rateLimitHeaders } from '../../../lib/security/rate-limit';

export const runtime = 'edge';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').slice(0, 120);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 8) || 8, 1), 12);
  const actor = await anonymousActorHash(request);
  const rateLimit = await checkRateLimit(`search:${actor}`, { limit: 120, windowMs: 60 * 1000 });
  if (!rateLimit.allowed) {
    return Response.json({ error: { code: 'RATE_LIMITED', message: 'Too many searches.' } }, { status: 429, headers: rateLimitHeaders(rateLimit) });
  }
  return Response.json({ suggestions: await autocompleteRecords(query, limit) }, {
    headers: { ...rateLimitHeaders(rateLimit), 'Cache-Control': 'private, max-age=15' },
  });
}
