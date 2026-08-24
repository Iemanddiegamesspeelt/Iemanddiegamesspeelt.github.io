import { levels, macros, profiles } from './demo';
import type { DemonDifficulty, LevelDifficulty, LevelLength, WorkingStatus } from './types';
import type { LevelRecord, MacroRecord, ProfileRecord } from './types';

export type BrowseSort = 'newest' | 'oldest' | 'downloads' | 'likes';

export interface BrowseFilters {
  query?: string;
  difficulty?: LevelDifficulty | '';
  demonDifficulty?: DemonDifficulty | '';
  length?: LevelLength | '';
  rate?: string;
  gdVersion?: string;
  format?: string;
  replayTool?: string;
  status?: WorkingStatus | '';
  sort?: BrowseSort;
  page?: number;
  pageSize?: number;
}

export function browseLevels(
  filters: BrowseFilters,
  source: { levels: LevelRecord[]; macros: MacroRecord[]; profiles: ProfileRecord[] } = { levels, macros, profiles },
) {
  const levelById = new Map(source.levels.map((level) => [level.id, level]));
  const profileById = new Map(source.profiles.map((profile) => [profile.id, profile]));
  const query = filters.query?.trim().toLowerCase() ?? '';
  const filteredMacros = source.macros.filter((macro) => {
    const level = levelById.get(macro.levelId);
    const uploader = profileById.get(macro.uploaderId);
    if (!level || !uploader) return false;
    if (query && ![
      level.name,
      level.id,
      level.creator,
      uploader.username,
      uploader.displayName,
      macro.title,
    ].some((value) => value.toLowerCase().includes(query))) return false;
    if (filters.difficulty && level.difficulty !== filters.difficulty) return false;
    if (filters.demonDifficulty && level.demonDifficulty !== filters.demonDifficulty) return false;
    if (filters.length && level.length !== filters.length) return false;
    if (filters.gdVersion && level.gdVersion !== filters.gdVersion) return false;
    if (filters.format && !(macro.availableFormatIds ?? [macro.originalFormatId]).includes(filters.format)) return false;
    if (filters.replayTool && !(macro.compatibleToolIds ?? []).includes(filters.replayTool)) return false;
    if (filters.status && macro.status !== filters.status) return false;
    if (filters.rate) {
      const numericRate = Number(filters.rate);
      if (macro.tps !== numericRate && macro.fps !== numericRate) return false;
    }
    return true;
  });

  const grouped = source.levels
    .map((level) => {
      const matching = filteredMacros.filter((macro) => macro.levelId === level.id);
      const latest = Math.max(...matching.map((macro) => new Date(macro.uploadedAt).getTime()), 0);
      const oldest = Math.min(...matching.map((macro) => new Date(macro.uploadedAt).getTime()), Number.MAX_SAFE_INTEGER);
      return {
        level,
        matchingMacroCount: matching.length,
        matchingDownloads: matching.reduce((sum, macro) => sum + macro.downloadCount, 0),
        matchingLikes: matching.reduce((sum, macro) => sum + macro.likeCount, 0),
        latest,
        oldest,
      };
    })
    .filter((item) => item.matchingMacroCount > 0);

  const sort = filters.sort ?? 'downloads';
  grouped.sort((a, b) => {
    if (sort === 'newest') return b.latest - a.latest;
    if (sort === 'oldest') return a.oldest - b.oldest;
    if (sort === 'likes') return b.matchingLikes - a.matchingLikes;
    return b.matchingDownloads - a.matchingDownloads;
  });

  const pageSize = Math.min(Math.max(filters.pageSize ?? 9, 1), 24);
  const page = Math.max(filters.page ?? 1, 1);
  const total = grouped.length;
  return {
    items: grouped.slice((page - 1) * pageSize, page * pageSize),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function autocomplete(
  query: string,
  limit = 8,
  source: { levels: LevelRecord[]; macros: MacroRecord[]; profiles: ProfileRecord[] } = { levels, macros, profiles },
) {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 2) return [];
  const suggestions = [
    ...source.levels.flatMap((level) => [
      { type: 'level' as const, label: level.name, meta: `Level #${level.id} · by ${level.creator}`, href: `/level/${level.id}` },
      ...(level.creator.toLowerCase().includes(normalized) ? [{ type: 'creator' as const, label: level.creator, meta: 'Level creator', href: `/browse?q=${encodeURIComponent(level.creator)}` }] : []),
    ]),
    ...source.profiles.map((profile) => ({ type: 'uploader' as const, label: profile.displayName, meta: `@${profile.username}`, href: `/profile/${profile.username}` })),
    ...source.macros.map((macro) => ({ type: 'macro' as const, label: macro.title, meta: levelById(source.levels, macro.levelId)?.name ?? 'Macro', href: `/macro/${macro.id}` })),
  ];
  const seen = new Set<string>();
  return suggestions
    .filter((suggestion) => `${suggestion.label} ${suggestion.meta}`.toLowerCase().includes(normalized))
    .filter((suggestion) => {
      const key = `${suggestion.type}:${suggestion.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.min(limit, 12));
}

function levelById(records: LevelRecord[], id: string) {
  return records.find((level) => level.id === id);
}
