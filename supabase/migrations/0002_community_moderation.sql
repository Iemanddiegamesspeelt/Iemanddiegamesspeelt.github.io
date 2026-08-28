-- Community voting, temporary restrictions, and moderator reset controls.

alter table public.profiles
  add column if not exists restricted_until timestamptz,
  add column if not exists restriction_strikes integer not null default 0 check (restriction_strikes >= 0),
  add column if not exists last_restricted_at timestamptz;

alter table public.macros
  add column if not exists working_votes integer not null default 0 check (working_votes >= 0),
  add column if not exists broken_votes integer not null default 0 check (broken_votes >= 0),
  add column if not exists outdated_votes integer not null default 0 check (outdated_votes >= 0),
  add column if not exists community_flagged_at timestamptz,
  add column if not exists community_restriction_applied_at timestamptz;

create index if not exists profiles_restricted_until_idx
  on public.profiles (restricted_until)
  where restricted_until is not null;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(
    select 1
    from public.profiles
    where id = auth.uid()
      and banned_at is null
      and (restricted_until is null or restricted_until <= now())
  )
$$;

create or replace function public.refresh_macro_vote_state(p_macro_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  vote_working integer;
  vote_broken integer;
  vote_outdated integer;
  vote_total integer;
  negative_total integer;
  recent_negative integer;
  owner_id uuid;
  first_flag timestamptz;
  restriction_applied timestamptz;
begin
  select
    count(*) filter (where status = 'working'),
    count(*) filter (where status = 'broken'),
    count(*) filter (where status = 'outdated')
  into vote_working, vote_broken, vote_outdated
  from public.macro_reports
  where macro_id = p_macro_id and resolved_at is null;

  vote_working := coalesce(vote_working, 0);
  vote_broken := coalesce(vote_broken, 0);
  vote_outdated := coalesce(vote_outdated, 0);
  vote_total := vote_working + vote_broken + vote_outdated;
  negative_total := vote_broken + vote_outdated;
  select count(*) into recent_negative
  from public.macro_reports
  where macro_id = p_macro_id
    and resolved_at is null
    and status in ('broken', 'outdated')
    and created_at > now() - interval '24 hours';

  select uploader_id, community_flagged_at, community_restriction_applied_at
  into owner_id, first_flag, restriction_applied
  from public.macros
  where id = p_macro_id
  for update;

  if owner_id is null then return; end if;

  update public.macros
  set working_votes = vote_working,
      broken_votes = vote_broken,
      outdated_votes = vote_outdated
  where id = p_macro_id;

  if vote_total >= 10 and negative_total > vote_working then
    update public.macros
    set working_status = case when vote_broken >= vote_outdated then 'broken' else 'possibly_outdated' end,
        community_flagged_at = coalesce(community_flagged_at, now())
    where id = p_macro_id and working_status <> 'removed';

    if recent_negative >= 10 and restriction_applied is null then
      update public.profiles
      set restricted_until = now() + make_interval(days => least(365, (power(2, restriction_strikes + 1) - 1)::integer)),
          restriction_strikes = restriction_strikes + 1,
          last_restricted_at = now()
      where id = owner_id and role = 'user' and banned_at is null;
      update public.macros set community_restriction_applied_at = now() where id = p_macro_id;
    end if;
  elsif first_flag is not null then
    update public.macros
    set working_status = case when vote_total >= 10 then 'working' else 'unverified' end,
        community_flagged_at = null,
        community_restriction_applied_at = null
    where id = p_macro_id and working_status <> 'removed';
  end if;
end;
$$;

create or replace function public.on_macro_vote_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_macro_vote_state(old.macro_id);
    return old;
  end if;
  perform public.refresh_macro_vote_state(new.macro_id);
  return new;
end;
$$;

drop trigger if exists macro_vote_changed on public.macro_reports;
create trigger macro_vote_changed
after insert or update or delete on public.macro_reports
for each row execute function public.on_macro_vote_changed();

create or replace function public.moderate_macro_mark_working(p_macro_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_moderator() then raise exception 'Moderator access required'; end if;
  update public.macros
  set working_status = 'working',
      working_votes = 0,
      broken_votes = 0,
      outdated_votes = 0,
      community_flagged_at = null,
      community_restriction_applied_at = null
  where id = p_macro_id;
  if not found then raise exception 'Macro not found'; end if;
  delete from public.macro_reports where macro_id = p_macro_id;
  insert into public.moderation_actions (moderator_id, target_type, target_id, action, reason)
  values (auth.uid(), 'macro', p_macro_id::text, 'mark_working_and_clear_votes', left(p_reason, 2000));
end;
$$;

create or replace function public.moderate_clear_restriction(p_user_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_moderator() then raise exception 'Moderator access required'; end if;
  update public.profiles set restricted_until = null where id = p_user_id;
  if not found then raise exception 'User not found'; end if;
  insert into public.moderation_actions (moderator_id, target_type, target_id, action, reason)
  values (auth.uid(), 'user', p_user_id::text, 'clear_temporary_restriction', left(p_reason, 2000));
end;
$$;

create or replace function public.record_macro_download(p_macro_id uuid, p_format_id text, p_client_token text, p_replay_tool_id text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare viewer uuid := auth.uid(); uploader uuid; target_level text;
begin
  if p_client_token is null or char_length(p_client_token) not between 16 and 100 then raise exception 'Invalid download token'; end if;
  select uploader_id, level_id into uploader, target_level
  from public.macros
  where id = p_macro_id
    and working_status <> 'removed'
    and exists(select 1 from public.macro_formats where id = p_format_id and enabled);
  if uploader is null then raise exception 'Macro or format is unavailable'; end if;
  if exists(select 1 from public.downloads where macro_id = p_macro_id and format_id = p_format_id and created_at > now() - interval '10 minutes' and ((viewer is not null and user_id = viewer) or client_token = p_client_token)) then return false; end if;
  insert into public.downloads (macro_id, format_id, user_id, client_token, replay_tool_id) values (p_macro_id, p_format_id, viewer, p_client_token, p_replay_tool_id);
  update public.macros set download_count = download_count + 1 where id = p_macro_id;
  update public.levels set total_downloads = total_downloads + 1 where id = target_level;
  update public.profiles set total_downloads = total_downloads + 1 where id = uploader;
  return true;
end;
$$;

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update
using (auth.uid() = id and public.is_active_user())
with check (auth.uid() = id and public.is_active_user());

drop policy if exists comments_update_own on public.comments;
create policy comments_update_own on public.comments for update to authenticated
using (auth.uid() = author_id and public.is_active_user())
with check (auth.uid() = author_id and public.is_active_user());

drop policy if exists macro_reports_update_own on public.macro_reports;
create policy macro_reports_update_own on public.macro_reports for update to authenticated
using (reporter_id = auth.uid() and resolved_at is null and public.is_active_user())
with check (reporter_id = auth.uid() and resolved_at is null and public.is_active_user());

revoke all on function public.refresh_macro_vote_state(uuid) from public;
revoke all on function public.moderate_macro_mark_working(uuid, text) from public;
revoke all on function public.moderate_clear_restriction(uuid, text) from public;
revoke all on function public.record_macro_download(uuid, text, text, text) from public;
grant execute on function public.moderate_macro_mark_working(uuid, text) to authenticated;
grant execute on function public.moderate_clear_restriction(uuid, text) to authenticated;
grant execute on function public.record_macro_download(uuid, text, text, text) to anon, authenticated;

do $$
declare item record;
begin
  for item in select id from public.macros loop
    perform public.refresh_macro_vote_state(item.id);
  end loop;
end;
$$;
