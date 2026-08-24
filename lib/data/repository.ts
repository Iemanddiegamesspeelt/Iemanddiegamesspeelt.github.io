import 'server-only';
import {
  Prisma,
  type Level as PrismaLevel,
  type Macro as PrismaMacro,
  type MacroFormat,
  type Profile,
  type User,
} from '@prisma/client';
import { getPrisma } from '../db/prisma';
import { getObjectStorage } from '../storage/object-storage';
import { sha256Hex, validateCanonicalReplay } from '../replay/schema';
import { getFormat } from '../replay/registry';
import {
  getLevel as getDemoLevel,
  getMacro as getDemoMacro,
  getMacrosForLevel as getDemoMacrosForLevel,
  getProfile as getDemoProfile,
  levels as demoLevels,
  macros as demoMacros,
  profiles as demoProfiles,
} from './demo';
import type {
  DemonDifficulty,
  LevelDifficulty,
  LevelLength,
  LevelRecord,
  MacroRecord,
  ProfileRecord,
  CollectionRecord,
  CommentRecord,
  WorkingStatus,
} from './types';
import type { BrowseFilters } from './search';

type MacroRow = PrismaMacro & {
  originalFormat: MacroFormat;
  uploader: User & { profile: Profile | null };
  level: PrismaLevel;
  conversionCapabilities?: Array<{
    canonicalHash: string;
    exporterVersion: string;
    quality: string;
    format: MacroFormat & {
      toolCompatibility: Array<{
        canRead: boolean;
        supportLevel: string;
        verification: string;
        recommended: boolean;
        warning: string | null;
        replayTool: { slug: string; name: string; status: string };
      }>;
    };
  }>;
};

const difficultyLabels: Record<string, LevelDifficulty> = {
  AUTO: 'Auto', EASY: 'Easy', NORMAL: 'Normal', HARD: 'Hard', HARDER: 'Harder',
  INSANE: 'Insane', DEMON: 'Demon', UNKNOWN: 'Unknown',
};
const demonLabels: Record<string, DemonDifficulty> = {
  EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard', INSANE: 'Insane', EXTREME: 'Extreme',
};
const lengthLabels: Record<string, LevelLength> = {
  TINY: 'Tiny', SHORT: 'Short', MEDIUM: 'Medium', LONG: 'Long', XL: 'XL',
  PLATFORMER: 'Platformer', UNKNOWN: 'Unknown',
};
const statusLabels: Record<string, WorkingStatus> = {
  WORKING: 'Working',
  UNVERIFIED: 'Unverified',
  POSSIBLY_OUTDATED: 'Possibly outdated',
  BROKEN: 'Broken',
  REMOVED: 'Removed',
};
const accents: LevelRecord['accent'][] = ['violet', 'cyan', 'rose', 'amber', 'emerald', 'blue'];

function mapLevel(row: PrismaLevel): LevelRecord {
  return {
    id: row.externalId,
    name: row.name,
    creator: row.creatorName,
    difficulty: difficultyLabels[row.difficulty] ?? 'Unknown',
    demonDifficulty: row.demonDifficulty ? demonLabels[row.demonDifficulty] : undefined,
    stars: row.stars ?? undefined,
    length: lengthLabels[row.length] ?? 'Unknown',
    gdVersion: row.gdVersion ?? undefined,
    macroCount: row.macroCount,
    totalDownloads: row.totalDownloads,
    accent: accents[Math.abs(row.externalId.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % accents.length],
    isDemo: row.isDemo,
  };
}

function mapProfile(user: User & { profile: Profile | null }): ProfileRecord {
  const profile = user.profile;
  const displayName = profile?.displayName ?? profile?.username ?? user.email.split('@')[0] ?? 'Player';
  return {
    id: user.id,
    username: profile?.username ?? `player-${user.id.slice(0, 8)}`,
    displayName,
    initials: displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
    avatarTone: 'from-violet-500 to-indigo-600',
    avatarUrl: profile?.avatarStorageKey ? `/api/profile/avatar/${encodeURIComponent(profile.username)}` : undefined,
    bio: profile?.bio ?? '',
    joinedAt: user.createdAt.toISOString(),
    macroCount: profile?.macroCount ?? 0,
    totalDownloads: profile?.totalDownloads ?? 0,
    totalLikes: profile?.totalLikes ?? 0,
    role: user.role.toLowerCase() as ProfileRecord['role'],
  };
}

function mapMacro(row: MacroRow): MacroRecord {
  const supportedVerification = (value: string): value is 'verified' | 'community-reported' => value === 'verified' || value === 'community-reported';
  const activeCapabilities = row.conversionCapabilities?.filter((capability) => {
    const implementation = getFormat(capability.format.slug);
    return capability.canonicalHash === row.canonicalHash
      && capability.quality !== 'BLOCKED'
      && capability.format.enabled
      && implementation?.exporter?.implementationVersion === capability.exporterVersion;
  }) ?? [];
  return {
    id: row.id,
    levelId: row.level.externalId,
    uploaderId: row.uploaderId,
    title: row.title,
    description: row.description ?? '',
    completion: row.completionBasisPoints === null ? undefined : row.completionBasisPoints / 100,
    tps: row.tps ? Number(row.tps) : undefined,
    fps: row.fps ? Number(row.fps) : undefined,
    inputCount: row.inputCount,
    durationSeconds: row.durationMs / 1000,
    player1Inputs: row.player1InputCount,
    player2Inputs: row.player2InputCount,
    recordedGdVersion: row.recordedGdVersion ?? undefined,
    originalFormatId: row.originalFormat.slug,
    uploadedAt: (row.publishedAt ?? row.createdAt).toISOString(),
    downloadCount: row.downloadCount,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    status: statusLabels[row.workingStatus] ?? 'Unverified',
    isDemo: row.isDemo,
    availableFormatIds: activeCapabilities.map((capability) => capability.format.slug),
    compatibleToolIds: [...new Set(activeCapabilities.flatMap((capability) => capability.format.toolCompatibility
      .filter((item) => item.canRead && item.supportLevel !== 'UNSUPPORTED' && supportedVerification(item.verification) && item.replayTool.status === 'ACTIVE')
      .map((item) => item.replayTool.slug)))],
    formatCapabilities: activeCapabilities.map((capability) => ({
      formatId: capability.format.slug,
      tools: capability.format.toolCompatibility
        .filter((item) => item.canRead && item.supportLevel !== 'UNSUPPORTED' && supportedVerification(item.verification) && item.replayTool.status === 'ACTIVE')
        .map((item) => ({
          id: item.replayTool.slug,
          name: item.replayTool.name,
          recommended: item.recommended,
          supportLevel: item.supportLevel as 'NATIVE' | 'COMPATIBLE' | 'EXPERIMENTAL',
          verification: item.verification as 'verified' | 'community-reported',
          warning: item.warning ?? undefined,
        })),
    })),
  };
}

export interface BrowseLevelItem {
  level: LevelRecord;
  matchingMacroCount: number;
  matchingDownloads: number;
  matchingLikes: number;
}

type BrowseLevelRow = PrismaLevel & {
  matchingMacroCount: bigint;
  matchingDownloads: bigint;
  matchingLikes: bigint;
  totalRows: bigint;
};

const reverseLookup = (labels: Record<string, string>, value?: string) =>
  value ? Object.entries(labels).find(([, label]) => label === value)?.[0] : undefined;

export async function browseLevelRecords(filters: BrowseFilters) {
  const prisma = getPrisma();
  if (!prisma) {
    const { browseLevels } = await import('./search');
    return browseLevels(filters, { levels: demoLevels, macros: demoMacros, profiles: demoProfiles });
  }
  const pageSize = Math.min(Math.max(filters.pageSize ?? 12, 1), 24);
  const page = Math.max(filters.page ?? 1, 1);
  const conditions: Prisma.Sql[] = [Prisma.sql`m."publicationState" = 'PUBLISHED'`];
  const query = filters.query?.trim();
  if (query) {
    const pattern = `%${query}%`;
    conditions.push(Prisma.sql`(
      l."name" ILIKE ${pattern} OR l."externalId" ILIKE ${pattern} OR
      l."creatorName" ILIKE ${pattern} OR m."title" ILIKE ${pattern} OR
      p."username" ILIKE ${pattern} OR COALESCE(p."displayName", '') ILIKE ${pattern}
    )`);
  }
  const difficulty = reverseLookup(difficultyLabels, filters.difficulty);
  if (difficulty) conditions.push(Prisma.sql`l."difficulty" = ${difficulty}::"LevelDifficulty"`);
  const demonDifficulty = reverseLookup(demonLabels, filters.demonDifficulty);
  if (demonDifficulty) conditions.push(Prisma.sql`l."demonDifficulty" = ${demonDifficulty}::"DemonDifficulty"`);
  const length = reverseLookup(lengthLabels, filters.length);
  if (length) conditions.push(Prisma.sql`l."length" = ${length}::"LevelLength"`);
  if (filters.gdVersion) conditions.push(Prisma.sql`l."gdVersion" = ${filters.gdVersion}`);
  const workingStatus = reverseLookup(statusLabels, filters.status);
  if (workingStatus) conditions.push(Prisma.sql`m."workingStatus" = ${workingStatus}::"MacroWorkingStatus"`);
  if (filters.rate && Number.isFinite(Number(filters.rate))) {
    const rate = Number(filters.rate);
    conditions.push(Prisma.sql`(m."tps" = ${rate} OR m."fps" = ${rate})`);
  }
  if (filters.format) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "MacroConversionCapability" capability
      JOIN "MacroFormat" format ON format."id" = capability."formatId"
      WHERE capability."macroId" = m."id" AND format."slug" = ${filters.format}
        AND format."enabled" AND format."implementationStatus" = 'IMPLEMENTED'
        AND capability."quality" <> 'BLOCKED'
        AND capability."canonicalHash" = m."canonicalHash"
    )`);
  }
  if (filters.replayTool) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "MacroConversionCapability" capability
      JOIN "MacroFormat" format ON format."id" = capability."formatId"
      JOIN "FormatToolCompatibility" compatibility ON compatibility."formatId" = format."id"
      JOIN "ReplayTool" tool ON tool."id" = compatibility."replayToolId"
      WHERE capability."macroId" = m."id" AND tool."slug" = ${filters.replayTool}
        AND tool."status" = 'ACTIVE' AND format."enabled" AND format."implementationStatus" = 'IMPLEMENTED'
        AND capability."quality" <> 'BLOCKED' AND capability."canonicalHash" = m."canonicalHash"
        AND compatibility."canRead" AND compatibility."supportLevel" <> 'UNSUPPORTED'
        AND compatibility."verification" IN ('verified', 'community-reported')
    )`);
  }
  const order = filters.sort === 'oldest'
    ? Prisma.sql`matching."oldest" ASC`
    : filters.sort === 'downloads'
      ? Prisma.sql`matching."matchingDownloads" DESC, matching."latest" DESC`
      : filters.sort === 'likes'
        ? Prisma.sql`matching."matchingLikes" DESC, matching."latest" DESC`
        : Prisma.sql`matching."latest" DESC`;
  const rows = await prisma.$queryRaw<BrowseLevelRow[]>(Prisma.sql`
    WITH matching AS (
      SELECT
        m."levelId",
        COUNT(*)::bigint AS "matchingMacroCount",
        COALESCE(SUM(m."downloadCount"), 0)::bigint AS "matchingDownloads",
        COALESCE(SUM(m."likeCount"), 0)::bigint AS "matchingLikes",
        MAX(m."publishedAt") AS "latest",
        MIN(m."publishedAt") AS "oldest"
      FROM "Macro" m
      JOIN "Level" l ON l."id" = m."levelId"
      JOIN "User" uploader ON uploader."id" = m."uploaderId"
      LEFT JOIN "Profile" p ON p."userId" = uploader."id"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY m."levelId"
    )
    SELECT l.*, matching."matchingMacroCount", matching."matchingDownloads", matching."matchingLikes",
      COUNT(*) OVER()::bigint AS "totalRows"
    FROM matching
    JOIN "Level" l ON l."id" = matching."levelId"
    ORDER BY ${order}
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `);
  const total = Number(rows[0]?.totalRows ?? 0n);
  return {
    items: rows.map((row) => ({
      level: mapLevel(row),
      matchingMacroCount: Number(row.matchingMacroCount),
      matchingDownloads: Number(row.matchingDownloads),
      matchingLikes: Number(row.matchingLikes),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

const macroInclude = {
  originalFormat: true,
  uploader: { include: { profile: true } },
  level: true,
  conversionCapabilities: {
    include: {
      format: {
        include: {
          toolCompatibility: { include: { replayTool: true } },
        },
      },
    },
  },
} satisfies Prisma.MacroInclude;

export async function listLevelRecords(): Promise<LevelRecord[]> {
  const prisma = getPrisma();
  if (!prisma) return demoLevels;
  const rows = await prisma.level.findMany({ orderBy: { totalDownloads: 'desc' }, take: 100 });
  return rows.map(mapLevel);
}

export async function findLevelRecord(externalId: string): Promise<LevelRecord | undefined> {
  const prisma = getPrisma();
  if (!prisma) return getDemoLevel(externalId);
  const row = await prisma.level.findUnique({
    where: { providerKey_externalId: { providerKey: 'geometry-dash', externalId } },
  });
  return row ? mapLevel(row) : undefined;
}

export async function listMacroRecords(): Promise<MacroRecord[]> {
  const prisma = getPrisma();
  if (!prisma) return demoMacros;
  const rows = await prisma.macro.findMany({
    where: { publicationState: 'PUBLISHED' },
    include: macroInclude,
    orderBy: { publishedAt: 'desc' },
    take: 100,
  });
  return rows.map((row) => mapMacro(row as MacroRow));
}

export async function listMacroRecordsForLevel(externalLevelId: string): Promise<MacroRecord[]> {
  const prisma = getPrisma();
  if (!prisma) return getDemoMacrosForLevel(externalLevelId);
  const rows = await prisma.macro.findMany({
    where: {
      publicationState: 'PUBLISHED',
      level: { providerKey: 'geometry-dash', externalId: externalLevelId },
    },
    include: macroInclude,
    orderBy: { downloadCount: 'desc' },
    take: 100,
  });
  return rows.map((row) => ({ ...mapMacro(row as MacroRow), levelId: externalLevelId }));
}

export async function findMacroRecord(id: string, withCanonical = false): Promise<MacroRecord | undefined> {
  const prisma = getPrisma();
  if (!prisma) return getDemoMacro(id);
  const row = await prisma.macro.findFirst({
    where: { id, publicationState: 'PUBLISHED' },
    include: { ...macroInclude, canonicalReplay: true },
  });
  if (!row) return undefined;
  const macro = { ...mapMacro(row as MacroRow), levelId: row.level.externalId };
  if (withCanonical && row.canonicalReplay) {
    const object = await getObjectStorage().get(row.canonicalReplay.storageKey);
    if (object) {
      const hash = await sha256Hex(object.bytes);
      if (hash !== row.canonicalReplay.sha256 || hash !== row.canonicalHash) throw new Error('Stored replay integrity check failed.');
      macro.canonical = validateCanonicalReplay(JSON.parse(new TextDecoder().decode(object.bytes)));
    }
  }
  return macro;
}

export async function listMacroRecordsForProfile(userId: string): Promise<MacroRecord[]> {
  const prisma = getPrisma();
  if (!prisma) return demoMacros.filter((macro) => macro.uploaderId === userId);
  const rows = await prisma.macro.findMany({
    where: { uploaderId: userId, publicationState: 'PUBLISHED' },
    include: macroInclude,
    orderBy: { publishedAt: 'desc' },
    take: 100,
  });
  return rows.map((row) => mapMacro(row as MacroRow));
}

export async function listCommentsForMacro(macroId: string): Promise<Array<CommentRecord & { author: ProfileRecord }>> {
  const prisma = getPrisma();
  if (!prisma) return [];
  const rows = await prisma.comment.findMany({
    where: { macroId, state: { in: ['VISIBLE', 'DELETED'] } },
    include: { author: { include: { profile: true } } },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  return rows.map((row) => ({
    id: row.id,
    macroId: row.macroId,
    authorId: row.authorId,
    parentId: row.parentId ?? undefined,
    body: row.state === 'DELETED' ? '' : row.body,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString(),
    state: row.state.toLowerCase() as CommentRecord['state'],
    author: mapProfile(row.author),
  }));
}

export async function listPublicCollectionRecords(): Promise<CollectionRecord[]> {
  const prisma = getPrisma();
  if (!prisma) return [];
  const rows = await prisma.collection.findMany({
    where: { visibility: 'PUBLIC' },
    include: { macros: { select: { macroId: true }, orderBy: [{ position: 'asc' }, { addedAt: 'asc' }] } },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  return rows.map((row, index) => ({
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    description: row.description ?? '',
    visibility: 'public',
    macroIds: row.macros.map((item) => item.macroId),
    updatedAt: row.updatedAt.toISOString(),
    accent: (['violet', 'cyan', 'rose', 'amber'] as const)[index % 4],
  }));
}

export async function listCollectionRecordsForOwner(ownerId: string): Promise<CollectionRecord[]> {
  const prisma = getPrisma();
  if (!prisma) return [];
  const rows = await prisma.collection.findMany({
    where: { ownerId },
    include: { macros: { select: { macroId: true }, orderBy: [{ position: 'asc' }, { addedAt: 'asc' }] } },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  return rows.map((row, index) => ({
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    description: row.description ?? '',
    visibility: row.visibility.toLowerCase() as CollectionRecord['visibility'],
    macroIds: row.macros.map((item) => item.macroId),
    updatedAt: row.updatedAt.toISOString(),
    accent: (['violet', 'cyan', 'rose', 'amber'] as const)[index % 4],
  }));
}

export async function findCollectionRecord(id: string, viewerId?: string): Promise<CollectionRecord | undefined> {
  const prisma = getPrisma();
  if (!prisma) return undefined;
  const row = await prisma.collection.findFirst({
    where: {
      id,
      OR: [
        { visibility: { in: ['PUBLIC', 'UNLISTED'] } },
        ...(viewerId ? [{ ownerId: viewerId }] : []),
      ],
    },
    include: { macros: { select: { macroId: true }, orderBy: [{ position: 'asc' }, { addedAt: 'asc' }] } },
  });
  if (!row) return undefined;
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    description: row.description ?? '',
    visibility: row.visibility.toLowerCase() as CollectionRecord['visibility'],
    macroIds: row.macros.map((item) => item.macroId),
    updatedAt: row.updatedAt.toISOString(),
    accent: 'violet',
  };
}

export async function listMacroRecordsByIds(ids: string[]): Promise<MacroRecord[]> {
  if (!ids.length) return [];
  const boundedIds = ids.slice(0, 500);
  const prisma = getPrisma();
  if (!prisma) return demoMacros.filter((macro) => boundedIds.includes(macro.id));
  const rows = await prisma.macro.findMany({
    where: { id: { in: boundedIds }, publicationState: 'PUBLISHED' },
    include: macroInclude,
  });
  const order = new Map(boundedIds.map((id, index) => [id, index]));
  return rows.map((row) => mapMacro(row as MacroRow)).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function findProfileRecord(username: string): Promise<ProfileRecord | undefined> {
  const prisma = getPrisma();
  if (!prisma) return getDemoProfile(username);
  const profile = await prisma.profile.findUnique({
    where: { usernameNormalized: username.toLowerCase() },
    include: { user: true },
  });
  return profile ? mapProfile({ ...profile.user, profile }) : undefined;
}

export async function listProfileRecords(): Promise<ProfileRecord[]> {
  const prisma = getPrisma();
  if (!prisma) return demoProfiles;
  const rows = await prisma.user.findMany({
    where: { state: 'ACTIVE' },
    include: { profile: true },
    orderBy: { profile: { totalDownloads: 'desc' } },
    take: 100,
  });
  return rows.map(mapProfile);
}

export type SearchSuggestion = {
  type: 'level' | 'creator' | 'uploader' | 'macro';
  label: string;
  meta: string;
  href: string;
};

export async function autocompleteRecords(query: string, limit = 8): Promise<SearchSuggestion[]> {
  const normalized = query.trim();
  if (normalized.length < 2) return [];
  const prisma = getPrisma();
  if (!prisma) {
    const { autocomplete } = await import('./search');
    return autocomplete(normalized, limit, { levels: demoLevels, macros: demoMacros, profiles: demoProfiles });
  }
  const take = Math.min(Math.max(limit, 1), 12);
  const [levels, profiles, macros] = await Promise.all([
    prisma.level.findMany({
      where: { OR: [
        { name: { contains: normalized, mode: 'insensitive' } },
        { externalId: { contains: normalized, mode: 'insensitive' } },
        { creatorName: { contains: normalized, mode: 'insensitive' } },
      ] },
      select: { externalId: true, name: true, creatorName: true },
      orderBy: { totalDownloads: 'desc' },
      take,
    }),
    prisma.profile.findMany({
      where: { OR: [
        { username: { contains: normalized, mode: 'insensitive' } },
        { displayName: { contains: normalized, mode: 'insensitive' } },
      ], user: { state: 'ACTIVE' } },
      select: { username: true, displayName: true },
      orderBy: { totalDownloads: 'desc' },
      take,
    }),
    prisma.macro.findMany({
      where: { publicationState: 'PUBLISHED', title: { contains: normalized, mode: 'insensitive' } },
      select: { id: true, title: true, level: { select: { name: true } } },
      orderBy: { downloadCount: 'desc' },
      take,
    }),
  ]);
  const suggestions: SearchSuggestion[] = [];
  for (const level of levels) {
    suggestions.push({ type: 'level', label: level.name, meta: `Level #${level.externalId} · by ${level.creatorName}`, href: `/level/${level.externalId}` });
    if (level.creatorName.toLowerCase().includes(normalized.toLowerCase())) {
      suggestions.push({ type: 'creator', label: level.creatorName, meta: 'Level creator', href: `/browse?q=${encodeURIComponent(level.creatorName)}` });
    }
  }
  for (const profile of profiles) suggestions.push({ type: 'uploader', label: profile.displayName ?? profile.username, meta: `@${profile.username}`, href: `/profile/${profile.username}` });
  for (const macro of macros) suggestions.push({ type: 'macro', label: macro.title, meta: macro.level.name, href: `/macro/${macro.id}` });
  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    const key = `${suggestion.type}:${suggestion.label.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, take);
}
