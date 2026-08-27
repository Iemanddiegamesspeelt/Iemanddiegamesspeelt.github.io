import 'server-only';
import { env } from 'cloudflare:workers';
import type { AuthIdentity } from '../auth/app-user';
import type { LevelRecord, MacroRecord, ProfileRecord } from '../data/types';
import { formatCompatibilityRegistry, getFormat, getReplayTool } from '../replay/registry';
import { sha256Hex, validateCanonicalReplay } from '../replay/schema';
import { getObjectStorage } from '../storage/object-storage';

type D1UserRow = {
  id: string;
  auth_subject: string;
  email: string;
  username: string;
  display_name: string;
  joined_at: string;
  state: string;
  macro_count: number;
  total_downloads: number;
  total_likes: number;
};

type D1LevelRow = {
  external_id: string;
  name: string;
  creator: string;
  difficulty: string;
  demon_difficulty: string | null;
  stars: number | null;
  length: string;
  gd_version: string | null;
  macro_count: number;
  total_downloads: number;
};

type D1MacroRow = {
  id: string;
  source_upload_id: string;
  level_id: string;
  uploader_id: string;
  original_format_id: string;
  title: string;
  description: string | null;
  completion: number | null;
  rate_kind: string;
  rate: number | null;
  input_count: number;
  duration_seconds: number;
  player1_inputs: number;
  player2_inputs: number;
  recorded_gd_version: string | null;
  canonical_hash: string;
  canonical_storage_key: string;
  original_storage_key: string;
  uploaded_at: string;
  download_count: number;
  like_count: number;
  comment_count: number;
  working_status: string;
  available_format_ids: string;
};

export type D1PublishingUser = { id: string; state: string };

export type D1PublishInput = {
  uploadId: string;
  userId: string;
  level: {
    id: string;
    name: string;
    creator: string;
    difficulty: string;
    demonDifficulty?: string | null;
    stars?: number | null;
    length: string;
    gdVersion?: string | null;
  };
  macro: {
    title: string;
    description: string;
    completion: number | null;
    rateKind: 'tps' | 'fps';
    rate: number | null;
    inputCount: number;
    durationSeconds: number;
    player1Inputs: number;
    player2Inputs: number;
    recordedGdVersion: string | null;
    originalFormatId: string;
    canonicalHash: string;
    canonicalStorageKey: string;
    originalStorageKey: string;
    availableFormatIds: string[];
  };
};

const accents: LevelRecord['accent'][] = ['violet', 'cyan', 'rose', 'amber', 'emerald', 'blue'];

export function getD1(): D1Database | null {
  try {
    return (env as unknown as { DB?: D1Database }).DB ?? null;
  } catch {
    return null;
  }
}

function usernameBase(identity: AuthIdentity) {
  const local = identity.email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') ?? '';
  return local.length >= 3 ? local.slice(0, 22) : 'player';
}

export async function ensureD1User(identity: AuthIdentity): Promise<D1PublishingUser> {
  const database = getD1();
  if (!database) throw new Error('Database is not configured.');
  const existing = await database.prepare('SELECT id, state FROM mh_users WHERE auth_subject = ? LIMIT 1')
    .bind(identity.userId).first<D1PublishingUser>();
  if (existing) {
    if (existing.state !== 'ACTIVE') throw new Error('ACCOUNT_RESTRICTED');
    await database.prepare('UPDATE mh_users SET email = ?, display_name = ? WHERE id = ?')
      .bind(identity.email, identity.fullName ?? identity.displayName, existing.id).run();
    return existing;
  }
  const suffix = (await sha256Hex(new TextEncoder().encode(identity.userId))).slice(0, 7);
  const username = `${usernameBase(identity)}-${suffix}`.slice(0, 32);
  const id = crypto.randomUUID();
  const joinedAt = new Date().toISOString();
  await database.prepare(`INSERT INTO mh_users
    (id, auth_subject, email, username, display_name, joined_at, state, macro_count, total_downloads, total_likes)
    VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 0, 0, 0)
    ON CONFLICT(auth_subject) DO UPDATE SET email = excluded.email, display_name = excluded.display_name`)
    .bind(id, identity.userId, identity.email, username, identity.fullName ?? identity.displayName, joinedAt).run();
  const user = await database.prepare('SELECT id, state FROM mh_users WHERE auth_subject = ? LIMIT 1')
    .bind(identity.userId).first<D1PublishingUser>();
  if (!user || user.state !== 'ACTIVE') throw new Error(user ? 'ACCOUNT_RESTRICTED' : 'Could not create account.');
  return user;
}

export async function findD1User(identity: AuthIdentity): Promise<D1PublishingUser | null> {
  const database = getD1();
  if (!database) return null;
  const user = await database.prepare('SELECT id, state FROM mh_users WHERE auth_subject = ? LIMIT 1')
    .bind(identity.userId).first<D1PublishingUser>();
  return user?.state === 'ACTIVE' ? user : null;
}

export async function findD1MacroByUploadId(uploadId: string): Promise<{ id: string; uploaderId: string } | null> {
  const database = getD1();
  if (!database) return null;
  const row = await database.prepare('SELECT id, uploader_id FROM mh_macros WHERE source_upload_id = ? LIMIT 1')
    .bind(uploadId).first<{ id: string; uploader_id: string }>();
  return row ? { id: row.id, uploaderId: row.uploader_id } : null;
}

export async function publishD1Macro(input: D1PublishInput): Promise<{ id: string }> {
  const database = getD1();
  if (!database) throw new Error('Database is not configured.');
  const existing = await findD1MacroByUploadId(input.uploadId);
  if (existing) {
    if (existing.uploaderId !== input.userId) throw new Error('UPLOAD_FORBIDDEN');
    return { id: existing.id };
  }
  const id = crypto.randomUUID();
  const uploadedAt = new Date().toISOString();
  const availableFormatIds = [...new Set(input.macro.availableFormatIds)].sort();
  await database.batch([
    database.prepare(`INSERT INTO mh_levels
      (external_id, name, creator, difficulty, demon_difficulty, stars, length, gd_version, macro_count, total_downloads, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
      ON CONFLICT(external_id) DO UPDATE SET
        name = excluded.name, creator = excluded.creator, difficulty = excluded.difficulty,
        demon_difficulty = excluded.demon_difficulty, stars = excluded.stars,
        length = excluded.length, gd_version = COALESCE(excluded.gd_version, mh_levels.gd_version),
        updated_at = excluded.updated_at`)
      .bind(input.level.id, input.level.name, input.level.creator, input.level.difficulty, input.level.demonDifficulty ?? null,
        input.level.stars ?? null, input.level.length, input.level.gdVersion ?? null, uploadedAt),
    database.prepare(`INSERT INTO mh_macros
      (id, source_upload_id, level_id, uploader_id, original_format_id, title, description,
       completion, rate_kind, rate, input_count, duration_seconds, player1_inputs, player2_inputs,
       recorded_gd_version, canonical_hash, canonical_storage_key, original_storage_key, uploaded_at,
       download_count, like_count, comment_count, working_status, available_format_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'UNVERIFIED', ?)`)
      .bind(id, input.uploadId, input.level.id, input.userId, input.macro.originalFormatId, input.macro.title,
        input.macro.description || null, input.macro.completion, input.macro.rateKind, input.macro.rate,
        input.macro.inputCount, input.macro.durationSeconds, input.macro.player1Inputs, input.macro.player2Inputs,
        input.macro.recordedGdVersion, input.macro.canonicalHash, input.macro.canonicalStorageKey,
        input.macro.originalStorageKey, uploadedAt, JSON.stringify(availableFormatIds)),
    database.prepare('UPDATE mh_levels SET macro_count = macro_count + 1 WHERE external_id = ?').bind(input.level.id),
    database.prepare('UPDATE mh_users SET macro_count = macro_count + 1 WHERE id = ?').bind(input.userId),
  ]);
  return { id };
}

function mapD1Level(row: D1LevelRow): LevelRecord {
  const difficulty = `${row.difficulty.slice(0, 1)}${row.difficulty.slice(1).toLowerCase()}` as LevelRecord['difficulty'];
  const demonDifficulty = row.demon_difficulty
    ? `${row.demon_difficulty.slice(0, 1)}${row.demon_difficulty.slice(1).toLowerCase()}` as LevelRecord['demonDifficulty']
    : undefined;
  const length = row.length === 'XL' ? 'XL' : `${row.length.slice(0, 1)}${row.length.slice(1).toLowerCase()}` as LevelRecord['length'];
  return {
    id: row.external_id,
    name: row.name,
    creator: row.creator,
    difficulty,
    demonDifficulty,
    stars: row.stars ?? undefined,
    length,
    gdVersion: row.gd_version ?? undefined,
    macroCount: row.macro_count,
    totalDownloads: row.total_downloads,
    accent: accents[Math.abs(row.external_id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % accents.length],
    isDemo: false,
  };
}

function toolsForFormat(formatId: string): NonNullable<MacroRecord['formatCapabilities']>[number]['tools'] {
  return formatCompatibilityRegistry
    .filter((item) => item.formatId === formatId
      && (item.direction === 'import' || item.direction === 'both')
      && (item.verification === 'verified' || item.verification === 'community-reported'))
    .flatMap((item) => {
      const tool = getReplayTool(item.replayToolId);
      if (!tool || tool.status !== 'active') return [];
      return [{
        id: tool.id,
        name: tool.displayName,
        recommended: item.support === 'native',
        supportLevel: item.support === 'native' ? 'NATIVE' as const : item.support === 'partial' ? 'EXPERIMENTAL' as const : 'COMPATIBLE' as const,
        verification: item.verification as 'verified' | 'community-reported',
        warning: item.notes,
      }];
    });
}

function mapD1Macro(row: D1MacroRow): MacroRecord {
  const availableFormatIds = safeStringArray(row.available_format_ids)
    .filter((formatId) => Boolean(getFormat(formatId)?.exporter));
  const formatCapabilities = availableFormatIds.map((formatId) => ({ formatId, tools: toolsForFormat(formatId) }));
  return {
    id: row.id,
    levelId: row.level_id,
    uploaderId: row.uploader_id,
    title: row.title,
    description: row.description ?? '',
    completion: row.completion ?? undefined,
    tps: row.rate_kind === 'tps' && row.rate !== null ? row.rate : undefined,
    fps: row.rate_kind === 'fps' && row.rate !== null ? row.rate : undefined,
    inputCount: row.input_count,
    durationSeconds: row.duration_seconds,
    player1Inputs: row.player1_inputs,
    player2Inputs: row.player2_inputs,
    recordedGdVersion: row.recorded_gd_version ?? undefined,
    originalFormatId: row.original_format_id,
    uploadedAt: row.uploaded_at,
    downloadCount: row.download_count,
    likeCount: row.like_count,
    commentCount: row.comment_count,
    status: row.working_status === 'WORKING' ? 'Working' : row.working_status === 'BROKEN' ? 'Broken' : row.working_status === 'POSSIBLY_OUTDATED' ? 'Possibly outdated' : 'Unverified',
    isDemo: false,
    availableFormatIds,
    compatibleToolIds: [...new Set(formatCapabilities.flatMap((capability) => capability.tools.map((tool) => tool.id)))],
    formatCapabilities,
  };
}

function mapD1Profile(row: D1UserRow): ProfileRecord {
  const displayName = row.display_name || row.username;
  return {
    id: row.id,
    username: row.username,
    displayName,
    initials: displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
    avatarTone: 'from-violet-500 to-indigo-600',
    bio: '',
    joinedAt: row.joined_at,
    macroCount: row.macro_count,
    totalDownloads: row.total_downloads,
    totalLikes: row.total_likes,
    role: 'user',
  };
}

function safeStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export async function listD1Levels(): Promise<LevelRecord[]> {
  try {
    const database = getD1();
    if (!database) return [];
    const rows = await database.prepare('SELECT * FROM mh_levels ORDER BY total_downloads DESC, updated_at DESC LIMIT 500').all<D1LevelRow>();
    return rows.results.map(mapD1Level);
  } catch {
    return [];
  }
}

export async function findD1Level(externalId: string): Promise<LevelRecord | undefined> {
  try {
    const database = getD1();
    if (!database) return undefined;
    const row = await database.prepare('SELECT * FROM mh_levels WHERE external_id = ? LIMIT 1').bind(externalId).first<D1LevelRow>();
    return row ? mapD1Level(row) : undefined;
  } catch {
    return undefined;
  }
}

export async function listD1Macros(): Promise<MacroRecord[]> {
  try {
    const database = getD1();
    if (!database) return [];
    const rows = await database.prepare('SELECT * FROM mh_macros ORDER BY uploaded_at DESC LIMIT 500').all<D1MacroRow>();
    return rows.results.map(mapD1Macro);
  } catch {
    return [];
  }
}

export async function listD1MacrosForLevel(externalId: string): Promise<MacroRecord[]> {
  try {
    const database = getD1();
    if (!database) return [];
    const rows = await database.prepare('SELECT * FROM mh_macros WHERE level_id = ? ORDER BY download_count DESC, uploaded_at DESC LIMIT 200')
      .bind(externalId).all<D1MacroRow>();
    return rows.results.map(mapD1Macro);
  } catch {
    return [];
  }
}

export async function findD1Macro(id: string, withCanonical = false): Promise<MacroRecord | undefined> {
  try {
    const database = getD1();
    if (!database) return undefined;
    const row = await database.prepare('SELECT * FROM mh_macros WHERE id = ? LIMIT 1').bind(id).first<D1MacroRow>();
    if (!row) return undefined;
    const macro = mapD1Macro(row);
    if (withCanonical) {
      const object = await getObjectStorage().get(row.canonical_storage_key);
      if (!object) return undefined;
      const hash = await sha256Hex(object.bytes);
      if (hash !== row.canonical_hash) throw new Error('Stored replay integrity check failed.');
      macro.canonical = validateCanonicalReplay(JSON.parse(new TextDecoder().decode(object.bytes)));
    }
    return macro;
  } catch (error) {
    if (error instanceof Error && error.message === 'Stored replay integrity check failed.') throw error;
    return undefined;
  }
}

export async function listD1MacrosForProfile(userId: string): Promise<MacroRecord[]> {
  try {
    const database = getD1();
    if (!database) return [];
    const rows = await database.prepare('SELECT * FROM mh_macros WHERE uploader_id = ? ORDER BY uploaded_at DESC LIMIT 200')
      .bind(userId).all<D1MacroRow>();
    return rows.results.map(mapD1Macro);
  } catch {
    return [];
  }
}

export async function findD1Profile(username: string): Promise<ProfileRecord | undefined> {
  try {
    const database = getD1();
    if (!database) return undefined;
    const row = await database.prepare('SELECT * FROM mh_users WHERE lower(username) = lower(?) AND state = \'ACTIVE\' LIMIT 1')
      .bind(username).first<D1UserRow>();
    return row ? mapD1Profile(row) : undefined;
  } catch {
    return undefined;
  }
}

export async function listD1Profiles(): Promise<ProfileRecord[]> {
  try {
    const database = getD1();
    if (!database) return [];
    const rows = await database.prepare("SELECT * FROM mh_users WHERE state = 'ACTIVE' ORDER BY total_downloads DESC, joined_at DESC LIMIT 500").all<D1UserRow>();
    return rows.results.map(mapD1Profile);
  } catch {
    return [];
  }
}

export async function recordD1Download(input: { macroId: string; formatId: string; actorHash: string; toolId?: string | null }) {
  const database = getD1();
  if (!database) return;
  const windowStart = Math.floor(Date.now() / 600_000) * 600_000;
  const result = await database.prepare(`INSERT OR IGNORE INTO mh_downloads
    (macro_id, format_id, actor_hash, replay_tool_id, window_start, downloaded_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(input.macroId, input.formatId, input.actorHash, input.toolId ?? null, windowStart, new Date().toISOString()).run();
  if (!result.meta.changes) return;
  await database.batch([
    database.prepare('UPDATE mh_macros SET download_count = download_count + 1 WHERE id = ?').bind(input.macroId),
    database.prepare('UPDATE mh_levels SET total_downloads = total_downloads + 1 WHERE external_id = (SELECT level_id FROM mh_macros WHERE id = ?)').bind(input.macroId),
    database.prepare('UPDATE mh_users SET total_downloads = total_downloads + 1 WHERE id = (SELECT uploader_id FROM mh_macros WHERE id = ?)').bind(input.macroId),
  ]);
}
