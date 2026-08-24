import type { Metadata } from 'next';
import { BrowseClient } from '../../components/level/browse-client';
import { browseLevelRecords } from '../../lib/data/repository';
import { formatRegistry, replayToolRegistry } from '../../lib/replay/registry';

export const metadata: Metadata = {
  title: 'Browse macros',
  description: 'Search the MacroHub Geometry Dash macro library by level, creator, uploader, format, and replay tool.',
};

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === 'string' ? params[key] as string : '';
  const filters = {
    focus: value('focus'),
    difficulty: value('difficulty'),
    demonDifficulty: value('demonDifficulty'),
    length: value('length'),
    rate: value('rate'),
    gdVersion: value('gdVersion'),
    format: value('format'),
    replayTool: value('replayTool'),
    status: value('status'),
    sort: value('sort'),
  };
  const query = value('q');
  const result = await browseLevelRecords({
    query,
    difficulty: filters.difficulty as never,
    demonDifficulty: filters.demonDifficulty as never,
    length: filters.length as never,
    rate: filters.rate,
    gdVersion: filters.gdVersion,
    format: filters.format,
    replayTool: filters.replayTool,
    status: filters.status as never,
    sort: (filters.sort || 'newest') as never,
    page: Math.max(Number(value('page')) || 1, 1),
    pageSize: 12,
  });
  return (
    <BrowseClient
      query={query}
      filters={filters}
      items={result.items}
      total={result.total}
      page={result.page}
      totalPages={result.totalPages}
      formats={formatRegistry.map((format) => ({ id: format.id, label: format.extensions.join(' / ') }))}
      tools={replayToolRegistry.map((tool) => ({ id: tool.id, label: tool.displayName }))}
    />
  );
}
