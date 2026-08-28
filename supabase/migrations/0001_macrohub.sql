-- MacroHub schema for Supabase. Run this once in a new Supabase project's SQL editor.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text,
  bio text,
  avatar_url text,
  role text not null default 'user' check (role in ('user', 'moderator', 'admin')),
  banned_at timestamptz,
  joined_at timestamptz not null default now(),
  macro_count integer not null default 0 check (macro_count >= 0),
  total_downloads bigint not null default 0 check (total_downloads >= 0),
  total_likes bigint not null default 0 check (total_likes >= 0),
  check (username ~ '^[a-z0-9_]{3,30}$'),
  check (display_name is null or char_length(display_name) between 1 and 80),
  check (bio is null or char_length(bio) <= 500)
);
create unique index profiles_username_lower_idx on public.profiles (lower(username));
create index profiles_downloads_idx on public.profiles (total_downloads desc) where macro_count > 0;

create table public.levels (
  id text primary key check (id ~ '^[0-9]{1,20}$'),
  name text not null check (char_length(name) between 1 and 120),
  creator text not null check (char_length(creator) between 1 and 80),
  difficulty text not null default 'unknown',
  demon_difficulty text,
  stars smallint check (stars between 0 and 20),
  length text not null default 'unknown',
  gd_version text,
  macro_count integer not null default 0 check (macro_count >= 0),
  total_downloads bigint not null default 0 check (total_downloads >= 0),
  metadata_refreshed_at timestamptz,
  created_at timestamptz not null default now()
);
create index levels_name_idx on public.levels using gin (to_tsvector('simple', name || ' ' || creator));
create index levels_downloads_idx on public.levels (total_downloads desc);

create table public.macro_formats (
  id text primary key,
  display_name text not null,
  extension text not null,
  enabled boolean not null default true,
  description text,
  created_at timestamptz not null default now()
);

create table public.replay_tools (
  id text primary key,
  display_name text not null,
  enabled boolean not null default true,
  description text,
  created_at timestamptz not null default now()
);

create table public.format_tool_compatibility (
  format_id text not null references public.macro_formats(id) on delete cascade,
  replay_tool_id text not null references public.replay_tools(id) on delete cascade,
  direction text not null check (direction in ('import', 'export', 'both')),
  support text not null check (support in ('native', 'plugin', 'partial')),
  verification text not null check (verification in ('verified', 'community-reported', 'unknown')),
  recommended boolean not null default false,
  notes text,
  primary key (format_id, replay_tool_id)
);

create table public.macros (
  id uuid primary key default gen_random_uuid(),
  level_id text not null references public.levels(id) on delete restrict,
  uploader_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(title) between 1 and 140),
  description text check (description is null or char_length(description) <= 4000),
  completion numeric(5,2) check (completion between 0 and 100),
  rate_kind text not null default 'tps' check (rate_kind in ('tps', 'fps')),
  rate numeric(12,4) check (rate > 0),
  input_count integer not null check (input_count >= 0 and input_count <= 250000),
  duration_seconds numeric(16,6) not null default 0 check (duration_seconds >= 0),
  player1_inputs integer not null default 0 check (player1_inputs >= 0),
  player2_inputs integer not null default 0 check (player2_inputs >= 0),
  recorded_gd_version text,
  original_format_id text not null references public.macro_formats(id) on delete restrict,
  original_path text not null,
  canonical_path text not null,
  available_format_ids text[] not null default '{}',
  working_status text not null default 'unverified' check (working_status in ('working', 'unverified', 'possibly_outdated', 'broken', 'removed')),
  download_count bigint not null default 0 check (download_count >= 0),
  like_count integer not null default 0 check (like_count >= 0),
  comment_count integer not null default 0 check (comment_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (canonical_path),
  check (original_path like uploader_id::text || '/%'),
  check (canonical_path like uploader_id::text || '/%')
);
create index macros_level_created_idx on public.macros (level_id, created_at desc);
create index macros_uploader_created_idx on public.macros (uploader_id, created_at desc);
create index macros_downloads_idx on public.macros (download_count desc) where working_status <> 'removed';
create index macros_likes_idx on public.macros (like_count desc) where working_status <> 'removed';
create index macros_formats_idx on public.macros using gin (available_format_ids);
create index macros_search_idx on public.macros using gin (to_tsvector('simple', title || ' ' || coalesce(description, '')));

create table public.macro_files (
  id uuid primary key default gen_random_uuid(),
  macro_id uuid not null references public.macros(id) on delete cascade,
  kind text not null check (kind in ('original', 'canonical', 'generated_cache')),
  format_id text not null references public.macro_formats(id) on delete restrict,
  storage_path text not null unique,
  media_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (macro_id, kind, format_id)
);
create index macro_files_macro_idx on public.macro_files (macro_id);

create table public.likes (
  macro_id uuid not null references public.macros(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (macro_id, user_id)
);
create index likes_user_created_idx on public.likes (user_id, created_at desc);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  macro_id uuid not null references public.macros(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index comments_macro_created_idx on public.comments (macro_id, created_at);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  description text check (description is null or char_length(description) <= 1000),
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index collections_owner_idx on public.collections (owner_id, created_at desc);

create table public.collection_macros (
  collection_id uuid not null references public.collections(id) on delete cascade,
  macro_id uuid not null references public.macros(id) on delete cascade,
  added_by uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (collection_id, macro_id)
);

create table public.macro_reports (
  id uuid primary key default gen_random_uuid(),
  macro_id uuid not null references public.macros(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('working', 'broken', 'outdated')),
  details text check (details is null or char_length(details) <= 2000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  unique (macro_id, reporter_id)
);
create index macro_reports_open_idx on public.macro_reports (created_at) where resolved_at is null;

create table public.comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 1000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (comment_id, reporter_id)
);

create table public.downloads (
  id bigint generated always as identity primary key,
  macro_id uuid not null references public.macros(id) on delete cascade,
  format_id text not null,
  user_id uuid references public.profiles(id) on delete set null,
  client_token text,
  replay_tool_id text,
  created_at timestamptz not null default now(),
  check (client_token is null or char_length(client_token) between 16 and 100),
  check (user_id is not null or client_token is not null)
);
create index downloads_macro_created_idx on public.downloads (macro_id, created_at desc);
create index downloads_user_recent_idx on public.downloads (user_id, macro_id, format_id, created_at desc) where user_id is not null;
create index downloads_client_recent_idx on public.downloads (client_token, macro_id, format_id, created_at desc) where client_token is not null;

create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  moderator_id uuid not null references public.profiles(id) on delete restrict,
  target_type text not null check (target_type in ('macro', 'comment', 'user', 'format', 'replay_tool', 'compatibility', 'report')),
  target_id text not null,
  action text not null check (char_length(action) between 1 and 100),
  reason text check (reason is null or char_length(reason) <= 2000),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index moderation_actions_created_idx on public.moderation_actions (created_at desc);

create or replace function public.is_moderator()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and role in ('moderator', 'admin') and banned_at is null) $$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and banned_at is null) $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare base_username text;
begin
  base_username := lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'preferred_username', new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1), 'player'), '[^a-zA-Z0-9_]+', '_', 'g'));
  base_username := trim(both '_' from base_username);
  if char_length(base_username) < 3 then base_username := 'player'; end if;
  base_username := left(base_username, 21) || '_' || substr(replace(new.id::text, '-', ''), 1, 8);
  insert into public.profiles (id, username, display_name)
  values (new.id, base_username, nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), 80), ''));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$ begin new.updated_at = now(); return new; end $$;
create trigger macros_touch_updated before update on public.macros for each row execute function public.touch_updated_at();
create trigger collections_touch_updated before update on public.collections for each row execute function public.touch_updated_at();

create or replace function public.update_macro_totals()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.levels set macro_count = macro_count + 1 where id = new.level_id;
    update public.profiles set macro_count = macro_count + 1 where id = new.uploader_id;
    return new;
  end if;
  update public.levels set macro_count = greatest(0, macro_count - 1) where id = old.level_id;
  update public.profiles set macro_count = greatest(0, macro_count - 1) where id = old.uploader_id;
  return old;
end;
$$;
create trigger macros_totals after insert or delete on public.macros for each row execute function public.update_macro_totals();

create or replace function public.create_macro_file_rows()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.macro_files (macro_id, kind, format_id, storage_path)
  values
    (new.id, 'original', new.original_format_id, new.original_path),
    (new.id, 'canonical', 'macrohub-json', new.canonical_path);
  return new;
end;
$$;
create trigger macros_create_file_rows after insert on public.macros for each row execute function public.create_macro_file_rows();

create or replace function public.update_like_totals()
returns trigger language plpgsql security definer set search_path = public as $$
declare target_uploader uuid;
begin
  if tg_op = 'INSERT' then
    select uploader_id into target_uploader from public.macros where id = new.macro_id;
    update public.macros set like_count = like_count + 1 where id = new.macro_id;
    update public.profiles set total_likes = total_likes + 1 where id = target_uploader;
    return new;
  end if;
  select uploader_id into target_uploader from public.macros where id = old.macro_id;
  update public.macros set like_count = greatest(0, like_count - 1) where id = old.macro_id;
  update public.profiles set total_likes = greatest(0, total_likes - 1) where id = target_uploader;
  return old;
end;
$$;
create trigger likes_totals after insert or delete on public.likes for each row execute function public.update_like_totals();

create or replace function public.update_comment_totals()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update public.macros set comment_count = comment_count + 1 where id = new.macro_id; return new; end if;
  update public.macros set comment_count = greatest(0, comment_count - 1) where id = old.macro_id; return old;
end;
$$;
create trigger comments_totals after insert or delete on public.comments for each row execute function public.update_comment_totals();

create or replace function public.mark_comment_edited()
returns trigger language plpgsql set search_path = public as $$ begin if new.body is distinct from old.body then new.edited_at = now(); end if; return new; end $$;
create trigger comments_mark_edited before update on public.comments for each row execute function public.mark_comment_edited();

create or replace function public.enforce_write_limits()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent_count integer;
begin
  if tg_table_name = 'macros' then
    select count(*) into recent_count from public.macros where uploader_id = new.uploader_id and created_at > now() - interval '1 hour';
    if recent_count >= 20 then raise exception 'Upload rate limit reached. Try again later.'; end if;
  elsif tg_table_name = 'comments' then
    if new.parent_id is not null and not exists(select 1 from public.comments where id = new.parent_id and macro_id = new.macro_id) then
      raise exception 'Reply target does not belong to this macro.';
    end if;
    select count(*) into recent_count from public.comments where author_id = new.author_id and created_at > now() - interval '10 minutes';
    if recent_count >= 30 then raise exception 'Comment rate limit reached. Try again later.'; end if;
  elsif tg_table_name = 'collections' then
    select count(*) into recent_count from public.collections where owner_id = new.owner_id and created_at > now() - interval '1 hour';
    if recent_count >= 20 then raise exception 'Collection rate limit reached. Try again later.'; end if;
  end if;
  return new;
end;
$$;
create trigger macros_write_limit before insert on public.macros for each row execute function public.enforce_write_limits();
create trigger comments_write_limit before insert on public.comments for each row execute function public.enforce_write_limits();
create trigger collections_write_limit before insert on public.collections for each row execute function public.enforce_write_limits();

create or replace function public.record_macro_download(p_macro_id uuid, p_format_id text, p_client_token text, p_replay_tool_id text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare viewer uuid := auth.uid(); uploader uuid; target_level text;
begin
  if p_client_token is null or char_length(p_client_token) not between 16 and 100 then raise exception 'Invalid download token'; end if;
  select uploader_id, level_id into uploader, target_level from public.macros where id = p_macro_id and working_status <> 'removed' and p_format_id = any(available_format_ids);
  if uploader is null then raise exception 'Macro or format is unavailable'; end if;
  if exists(select 1 from public.downloads where macro_id = p_macro_id and format_id = p_format_id and created_at > now() - interval '10 minutes' and ((viewer is not null and user_id = viewer) or client_token = p_client_token)) then return false; end if;
  insert into public.downloads (macro_id, format_id, user_id, client_token, replay_tool_id) values (p_macro_id, p_format_id, viewer, p_client_token, p_replay_tool_id);
  update public.macros set download_count = download_count + 1 where id = p_macro_id;
  update public.levels set total_downloads = total_downloads + 1 where id = target_level;
  update public.profiles set total_downloads = total_downloads + 1 where id = uploader;
  return true;
end;
$$;

create or replace function public.moderate_macro_status(p_macro_id uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_moderator() then raise exception 'Moderator access required'; end if;
  if p_status not in ('working', 'unverified', 'possibly_outdated', 'broken', 'removed') then raise exception 'Invalid macro status'; end if;
  update public.macros set working_status = p_status where id = p_macro_id;
  if not found then raise exception 'Macro not found'; end if;
  insert into public.moderation_actions (moderator_id, target_type, target_id, action, reason)
  values (auth.uid(), 'macro', p_macro_id::text, 'set_status:' || p_status, left(p_reason, 2000));
end;
$$;

create or replace function public.moderate_user_ban(p_user_id uuid, p_banned boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_moderator() then raise exception 'Moderator access required'; end if;
  if p_user_id = auth.uid() then raise exception 'You cannot ban your own account'; end if;
  update public.profiles set banned_at = case when p_banned then now() else null end where id = p_user_id;
  if not found then raise exception 'User not found'; end if;
  insert into public.moderation_actions (moderator_id, target_type, target_id, action, reason)
  values (auth.uid(), 'user', p_user_id::text, case when p_banned then 'ban' else 'unban' end, left(p_reason, 2000));
end;
$$;

create or replace function public.moderate_remove_comment(p_comment_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_moderator() then raise exception 'Moderator access required'; end if;
  delete from public.comments where id = p_comment_id;
  if not found then raise exception 'Comment not found'; end if;
  insert into public.moderation_actions (moderator_id, target_type, target_id, action, reason)
  values (auth.uid(), 'comment', p_comment_id::text, 'remove', left(p_reason, 2000));
end;
$$;

alter table public.profiles enable row level security;
alter table public.levels enable row level security;
alter table public.macro_formats enable row level security;
alter table public.replay_tools enable row level security;
alter table public.format_tool_compatibility enable row level security;
alter table public.macros enable row level security;
alter table public.macro_files enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;
alter table public.collections enable row level security;
alter table public.collection_macros enable row level security;
alter table public.macro_reports enable row level security;
alter table public.comment_reports enable row level security;
alter table public.downloads enable row level security;
alter table public.moderation_actions enable row level security;

create policy profiles_read on public.profiles for select using (true);
create policy profiles_update_own on public.profiles for update using (auth.uid() = id and public.is_active_user()) with check (auth.uid() = id and banned_at is null);
create policy levels_read on public.levels for select using (true);
create policy levels_insert_authenticated on public.levels for insert to authenticated with check (public.is_active_user());
create policy formats_read on public.macro_formats for select using (enabled or public.is_moderator());
create policy tools_read on public.replay_tools for select using (enabled or public.is_moderator());
create policy compatibility_read on public.format_tool_compatibility for select using (true);
create policy formats_manage on public.macro_formats for all to authenticated using (public.is_moderator()) with check (public.is_moderator());
create policy tools_manage on public.replay_tools for all to authenticated using (public.is_moderator()) with check (public.is_moderator());
create policy compatibility_manage on public.format_tool_compatibility for all to authenticated using (public.is_moderator()) with check (public.is_moderator());
create policy macros_read on public.macros for select using (working_status <> 'removed' or auth.uid() = uploader_id or public.is_moderator());
create policy macros_insert_own on public.macros for insert to authenticated with check (auth.uid() = uploader_id and public.is_active_user());
create policy macros_update_own on public.macros for update to authenticated using (auth.uid() = uploader_id or public.is_moderator()) with check (auth.uid() = uploader_id or public.is_moderator());
create policy macros_delete_mod on public.macros for delete to authenticated using (public.is_moderator());
create policy macro_files_read on public.macro_files for select using (exists(select 1 from public.macros m where m.id = macro_id and (m.working_status <> 'removed' or m.uploader_id = auth.uid() or public.is_moderator())));
create policy likes_read on public.likes for select using (true);
create policy likes_insert_own on public.likes for insert to authenticated with check (auth.uid() = user_id and public.is_active_user());
create policy likes_delete_own on public.likes for delete to authenticated using (auth.uid() = user_id);
create policy comments_read on public.comments for select using (true);
create policy comments_insert_own on public.comments for insert to authenticated with check (auth.uid() = author_id and public.is_active_user());
create policy comments_update_own on public.comments for update to authenticated using (auth.uid() = author_id) with check (auth.uid() = author_id);
create policy comments_delete_own_or_mod on public.comments for delete to authenticated using (auth.uid() = author_id or public.is_moderator());
create policy collections_read on public.collections for select using (visibility = 'public' or owner_id = auth.uid() or public.is_moderator());
create policy collections_insert_own on public.collections for insert to authenticated with check (owner_id = auth.uid() and public.is_active_user());
create policy collections_update_own on public.collections for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy collections_delete_own on public.collections for delete to authenticated using (owner_id = auth.uid() or public.is_moderator());
create policy collection_macros_read on public.collection_macros for select using (exists(select 1 from public.collections c where c.id = collection_id and (c.visibility = 'public' or c.owner_id = auth.uid() or public.is_moderator())));
create policy collection_macros_write on public.collection_macros for insert to authenticated with check (added_by = auth.uid() and exists(select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid()));
create policy collection_macros_delete on public.collection_macros for delete to authenticated using (exists(select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid()));
create policy macro_reports_insert on public.macro_reports for insert to authenticated with check (reporter_id = auth.uid() and public.is_active_user());
create policy macro_reports_read on public.macro_reports for select to authenticated using (reporter_id = auth.uid() or public.is_moderator());
create policy macro_reports_update_own on public.macro_reports for update to authenticated using (reporter_id = auth.uid() and resolved_at is null) with check (reporter_id = auth.uid() and resolved_at is null);
create policy macro_reports_manage on public.macro_reports for update to authenticated using (public.is_moderator()) with check (public.is_moderator());
create policy comment_reports_insert on public.comment_reports for insert to authenticated with check (reporter_id = auth.uid() and public.is_active_user());
create policy comment_reports_read on public.comment_reports for select to authenticated using (reporter_id = auth.uid() or public.is_moderator());
create policy comment_reports_manage on public.comment_reports for update to authenticated using (public.is_moderator()) with check (public.is_moderator());
create policy downloads_read_mod on public.downloads for select to authenticated using (public.is_moderator());
create policy moderation_read on public.moderation_actions for select to authenticated using (public.is_moderator());
create policy moderation_insert on public.moderation_actions for insert to authenticated with check (moderator_id = auth.uid() and public.is_moderator());

grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.levels, public.macro_formats, public.replay_tools, public.format_tool_compatibility, public.macros, public.macro_files, public.comments, public.collections, public.collection_macros to anon, authenticated;
grant select, insert, delete on public.likes to authenticated;
grant insert, update, delete on public.comments, public.collections, public.collection_macros to authenticated;
grant update (username, display_name, bio, avatar_url) on public.profiles to authenticated;
grant insert (id, name, creator, difficulty, demon_difficulty, stars, length, gd_version, metadata_refreshed_at) on public.levels to authenticated;
grant insert (id, level_id, uploader_id, title, description, completion, rate_kind, rate, input_count, duration_seconds, player1_inputs, player2_inputs, recorded_gd_version, original_format_id, original_path, canonical_path, available_format_ids) on public.macros to authenticated;
grant update (title, description) on public.macros to authenticated;
grant delete on public.macros to authenticated;
grant insert, select, update on public.macro_reports, public.comment_reports to authenticated;
grant select, insert on public.moderation_actions to authenticated;
grant select on public.downloads to authenticated;
grant all on public.macro_formats, public.replay_tools, public.format_tool_compatibility to authenticated;
grant usage, select on sequence public.downloads_id_seq to authenticated;
revoke all on function public.record_macro_download(uuid, text, text, text) from public;
revoke all on function public.moderate_macro_status(uuid, text, text) from public;
revoke all on function public.moderate_user_ban(uuid, boolean, text) from public;
revoke all on function public.moderate_remove_comment(uuid, text) from public;
grant execute on function public.record_macro_download(uuid, text, text, text) to anon, authenticated;
grant execute on function public.moderate_macro_status(uuid, text, text) to authenticated;
grant execute on function public.moderate_user_ban(uuid, boolean, text) to authenticated;
grant execute on function public.moderate_remove_comment(uuid, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('macrohub-files', 'macrohub-files', true, 10485760)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

create policy macrohub_storage_read on storage.objects for select using (bucket_id = 'macrohub-files');
create policy macrohub_storage_insert on storage.objects for insert to authenticated with check (bucket_id = 'macrohub-files' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_user());
create policy macrohub_storage_update on storage.objects for update to authenticated using (bucket_id = 'macrohub-files' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'macrohub-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy macrohub_storage_delete on storage.objects for delete to authenticated using (bucket_id = 'macrohub-files' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_moderator()));

insert into public.macro_formats (id, display_name, extension, description) values
  ('macrohub-json', 'MacroHub Canonical JSON v1', '.macrohub.json', 'Lossless MacroHub exchange format'),
  ('gdr2', 'GDR2', '.gdr2', 'GDR version 2'),
  ('gdr', 'GDR', '.gdr', 'GDR version 1'),
  ('gdr-json', 'GDR JSON', '.gdr.json', 'GDR JSON'),
  ('mhr', 'MHR', '.mhr', 'Mega Hack Replay binary'),
  ('mhr-json', 'MHR JSON', '.mhr.json', 'Mega Hack Replay JSON'),
  ('cml', 'CML', '.cml', 'CML replay'),
  ('slc', 'SLC', '.slc', 'Silicate replay'),
  ('xbot', 'XBOT', '.xbot', 'xBot replay'),
  ('echo', 'ECHO', '.echo', 'Echo replay'),
  ('replaybot', 'RPLY v2', '.replay', 'ReplayBot version 2'),
  ('ybot', 'YBOT', '.ybot', 'yBot replay'),
  ('omegabot-replay', 'REPLAY v2', '.replay', 'OmegaBot replay'),
  ('tasbot-json', 'TASBOT JSON', '.json', 'TASBot JSON'),
  ('rush', 'RSH', '.rsh', 'Rush replay'),
  ('kdbot', 'KD', '.kd', 'KD-Bot replay'),
  ('zbot', 'ZBF', '.zbf', 'zBot replay'),
  ('fembot', 'FREPLAY', '.freplay', 'Fembot replay'),
  ('xdbot', 'XD', '.xd', 'xdBot replay'),
  ('tcbot', 'TCM', '.tcm', 'TCBot macro'),
  ('amethyst', 'THYST', '.thyst', 'Amethyst replay'),
  ('gdmo', 'MACRO', '.macro', 'GDMO macro'),
  ('replayengine3', 'RE3', '.re3', 'ReplayEngine 3 replay')
on conflict (id) do update set display_name = excluded.display_name, extension = excluded.extension, description = excluded.description;

insert into public.replay_tools (id, display_name) values
  ('eclipse', 'Eclipse Menu'), ('openhack', 'OpenHack'), ('prism-menu', 'Prism Menu'), ('quartz', 'Quartz'),
  ('silicate', 'Silicate'), ('tcbot', 'TCBot'), ('icreate-pro', 'iCreate Pro'), ('mega-hack', 'Mega Hack'),
  ('xbot', 'xBot'), ('xdbot', 'xdBot'), ('echo', 'Echo'), ('replaybot', 'ReplayBot'), ('ybot', 'yBot'),
  ('omegabot', 'OmegaBot'), ('tasbot', 'TASBot'), ('zbot', 'zBot'), ('rush', 'Rush'), ('kdbot', 'KD-Bot'),
  ('fembot', 'Fembot'), ('amethyst', 'Amethyst'), ('gdmo', 'GDMO'), ('macrohub', 'MacroHub Converter')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.format_tool_compatibility (format_id, replay_tool_id, direction, support, verification, recommended, notes) values
  ('macrohub-json', 'macrohub', 'both', 'native', 'verified', true, 'Lossless reference interchange format.'),
  ('gdr2', 'eclipse', 'both', 'native', 'community-reported', true, 'Verify the installed Eclipse version.'),
  ('gdr2', 'mega-hack', 'import', 'partial', 'community-reported', false, 'Version-specific compatibility.'),
  ('gdr2', 'xdbot', 'both', 'partial', 'community-reported', false, 'Version-specific compatibility.'),
  ('gdr', 'xdbot', 'both', 'partial', 'community-reported', false, 'Version-specific compatibility.'),
  ('cml', 'xdbot', 'import', 'partial', 'community-reported', false, 'Version-specific compatibility.'),
  ('mhr', 'mega-hack', 'both', 'native', 'community-reported', true, 'Strict MHR v7 HACK layout.'),
  ('mhr-json', 'mega-hack', 'both', 'native', 'community-reported', false, 'Mega Hack Replay JSON.'),
  ('ybot', 'ybot', 'both', 'native', 'community-reported', true, 'Versioned yBot action layout.'),
  ('replayengine3', 'openhack', 'both', 'native', 'community-reported', true, 'Version-specific relation.'),
  ('gdr', 'prism-menu', 'import', 'partial', 'community-reported', false, 'Verify the installed Prism Menu version.'),
  ('gdr', 'quartz', 'both', 'native', 'community-reported', true, 'Version-specific relation.'),
  ('slc', 'silicate', 'both', 'native', 'community-reported', true, 'SLC has multiple versions.'),
  ('tcbot', 'tcbot', 'both', 'native', 'community-reported', true, 'TCM version must match the tool.'),
  ('gdr', 'icreate-pro', 'import', 'partial', 'community-reported', false, 'Compatibility varies by product version.'),
  ('omegabot-replay', 'omegabot', 'both', 'native', 'community-reported', true, 'OmegaBot major versions use distinct layouts.'),
  ('tasbot-json', 'tasbot', 'both', 'native', 'verified', true, 'Native TASBot JSON schema.'),
  ('zbot', 'zbot', 'both', 'native', 'verified', true, 'Native ZBF format.'),
  ('rush', 'rush', 'both', 'native', 'verified', true, 'Native Rush format.'),
  ('kdbot', 'kdbot', 'both', 'native', 'verified', true, 'Native KD format.'),
  ('fembot', 'fembot', 'both', 'native', 'verified', true, 'Native FREPLAY format.'),
  ('xbot', 'xbot', 'both', 'native', 'verified', true, 'Native XBOT format.'),
  ('xdbot', 'xdbot', 'both', 'native', 'verified', true, 'Native XD format.'),
  ('echo', 'echo', 'both', 'native', 'verified', true, 'Native Echo format.'),
  ('replaybot', 'replaybot', 'both', 'native', 'verified', true, 'Native ReplayBot v2 format.'),
  ('amethyst', 'amethyst', 'both', 'native', 'verified', true, 'Native THYST format.'),
  ('gdmo', 'gdmo', 'both', 'native', 'verified', true, 'Native GDMO format.'),
  ('gdr', 'macrohub', 'both', 'native', 'verified', false, 'MacroHub parser and exporter.'),
  ('gdr-json', 'macrohub', 'both', 'native', 'verified', false, 'MacroHub parser and exporter.')
on conflict (format_id, replay_tool_id) do update set direction = excluded.direction, support = excluded.support, verification = excluded.verification, recommended = excluded.recommended, notes = excluded.notes;
