import { findMacroRecord } from '../../../../lib/data/repository';
import { jsonError } from '../../../../lib/security/request';

export const runtime = 'edge';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const macro = await findMacroRecord(id);
  return macro ? Response.json({ macro }) : jsonError('MACRO_NOT_FOUND', 'Macro not found.', 404);
}
