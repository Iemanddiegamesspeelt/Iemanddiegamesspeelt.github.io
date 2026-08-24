import { getGeometryDashLevelProvider } from '../../../../../lib/services/gd-level-provider';
import { jsonError } from '../../../../../lib/security/request';

export const runtime = 'edge';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,20}$/.test(id)) return jsonError('INVALID_LEVEL_ID', 'Enter a valid numeric level ID.', 422);
  try {
    const level = await getGeometryDashLevelProvider().getLevel(id);
    return level ? Response.json({ level }) : jsonError('LEVEL_NOT_FOUND', 'Level metadata was not found.', 404);
  } catch {
    return jsonError('LEVEL_PROVIDER_UNAVAILABLE', 'Level metadata is unavailable right now.', 503);
  }
}
