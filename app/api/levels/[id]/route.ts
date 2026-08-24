import { findLevelRecord, listMacroRecordsForLevel } from '../../../../lib/data/repository';
import { jsonError } from '../../../../lib/security/request';

export const runtime = 'edge';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [level, macros] = await Promise.all([findLevelRecord(id), listMacroRecordsForLevel(id)]);
  return level ? Response.json({ level, macros }) : jsonError('LEVEL_NOT_FOUND', 'Level not found.', 404);
}
