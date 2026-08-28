import { supabase } from './supabase';
import type { CollectionRow, CommentRow, LevelRow, MacroRow, ProfileRow } from './types';

const macroSelect = '*, level:levels(*), uploader:profiles(*)';

export async function listMacros(limit = 200): Promise<MacroRow[]> {
  const { data, error } = await supabase().from('macros').select(macroSelect).neq('working_status', 'removed').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as MacroRow[];
}

export async function listLevels(limit = 200): Promise<LevelRow[]> {
  const { data, error } = await supabase().from('levels').select('*').order('total_downloads', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as LevelRow[];
}

export async function getMacro(id: string): Promise<MacroRow | null> {
  const { data, error } = await supabase().from('macros').select(macroSelect).eq('id', id).neq('working_status', 'removed').maybeSingle();
  if (error) throw error;
  return data as unknown as MacroRow | null;
}

export async function getLevel(id: string): Promise<LevelRow | null> {
  const { data, error } = await supabase().from('levels').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as LevelRow | null;
}

export async function listLevelMacros(levelId: string): Promise<MacroRow[]> {
  const { data, error } = await supabase().from('macros').select(macroSelect).eq('level_id', levelId).neq('working_status', 'removed').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as MacroRow[];
}

export async function getProfile(username: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase().from('profiles').select('*').eq('username', username.toLowerCase()).maybeSingle();
  if (error) throw error;
  return data as ProfileRow | null;
}

export async function listProfileMacros(userId: string): Promise<MacroRow[]> {
  const { data, error } = await supabase().from('macros').select(macroSelect).eq('uploader_id', userId).neq('working_status', 'removed').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as MacroRow[];
}

export async function listLikedMacros(userId: string): Promise<MacroRow[]> {
  const { data, error } = await supabase().from('likes').select('macro:macros(*, level:levels(*), uploader:profiles(*))').eq('user_id', userId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).flatMap((row) => row.macro ? [row.macro] : []) as unknown as MacroRow[];
}

export async function listCollections(ownerId?: string): Promise<CollectionRow[]> {
  let query = supabase().from('collections').select('*, owner:profiles(*), collection_macros(macro_id)').order('created_at', { ascending: false });
  query = ownerId ? query.or(`visibility.eq.public,owner_id.eq.${ownerId}`) : query.eq('visibility', 'public');
  const { data, error } = await query.limit(100);
  if (error) throw error;
  return (data ?? []) as unknown as CollectionRow[];
}

export async function getCollection(id: string): Promise<CollectionRow | null> {
  const { data, error } = await supabase().from('collections').select('*, owner:profiles(*), collection_macros(macro_id)').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as unknown as CollectionRow | null;
}

export async function listCollectionMacros(collectionId: string): Promise<MacroRow[]> {
  const { data, error } = await supabase().from('collection_macros').select('macro:macros(*, level:levels(*), uploader:profiles(*))').eq('collection_id', collectionId).order('added_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).flatMap((row) => row.macro ? [row.macro] : []) as unknown as MacroRow[];
}

export async function createCollection(ownerId: string, name: string, description: string, visibility: 'public' | 'private') {
  const { data, error } = await supabase().from('collections').insert({ owner_id: ownerId, name, description: description || null, visibility }).select('id').single();
  if (error) throw error;
  return data.id as string;
}

export async function listComments(macroId: string): Promise<CommentRow[]> {
  const { data, error } = await supabase().from('comments').select('*, author:profiles(*)').eq('macro_id', macroId).order('created_at');
  if (error) throw error;
  return (data ?? []) as unknown as CommentRow[];
}

export async function addComment(macroId: string, authorId: string, body: string, parentId?: string | null) {
  const { error } = await supabase().from('comments').insert({ macro_id: macroId, author_id: authorId, body, parent_id: parentId ?? null });
  if (error) throw error;
}

export async function toggleLike(macroId: string, userId: string) {
  const { data: existing } = await supabase().from('likes').select('macro_id').eq('macro_id', macroId).eq('user_id', userId).maybeSingle();
  if (existing) {
    const { error } = await supabase().from('likes').delete().eq('macro_id', macroId).eq('user_id', userId);
    if (error) throw error;
    return false;
  }
  const { error } = await supabase().from('likes').insert({ macro_id: macroId, user_id: userId });
  if (error) throw error;
  return true;
}

export async function isLiked(macroId: string, userId: string) {
  const { data } = await supabase().from('likes').select('macro_id').eq('macro_id', macroId).eq('user_id', userId).maybeSingle();
  return Boolean(data);
}

function deviceToken() {
  const key = 'macrohub_device_token';
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const value = crypto.randomUUID();
  localStorage.setItem(key, value);
  return value;
}

export async function recordDownload(macroId: string, formatId: string, replayToolId?: string | null) {
  await supabase().rpc('record_macro_download', { p_macro_id: macroId, p_format_id: formatId, p_client_token: deviceToken(), p_replay_tool_id: replayToolId ?? null });
}
