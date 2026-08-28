-- Moderator reviews count as ten community reviews, new usernames only receive
-- a numeric suffix when the clean username is already in use, and macro owners
-- can delete their own uploads.

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
    coalesce(sum(case when reports.status = 'working' then case when voters.role in ('moderator', 'admin') then 10 else 1 end else 0 end), 0)::integer,
    coalesce(sum(case when reports.status = 'broken' then case when voters.role in ('moderator', 'admin') then 10 else 1 end else 0 end), 0)::integer,
    coalesce(sum(case when reports.status = 'outdated' then case when voters.role in ('moderator', 'admin') then 10 else 1 end else 0 end), 0)::integer
  into vote_working, vote_broken, vote_outdated
  from public.macro_reports reports
  join public.profiles voters on voters.id = reports.reporter_id
  where reports.macro_id = p_macro_id and reports.resolved_at is null;

  vote_total := vote_working + vote_broken + vote_outdated;
  negative_total := vote_broken + vote_outdated;

  select coalesce(sum(case when voters.role in ('moderator', 'admin') then 10 else 1 end), 0)::integer
  into recent_negative
  from public.macro_reports reports
  join public.profiles voters on voters.id = reports.reporter_id
  where reports.macro_id = p_macro_id
    and reports.resolved_at is null
    and reports.status in ('broken', 'outdated')
    and reports.created_at > now() - interval '24 hours';

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

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base_username text;
  candidate text;
  suffix_number integer := 1;
begin
  base_username := lower(regexp_replace(coalesce(
    new.raw_user_meta_data ->> 'preferred_username',
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'full_name',
    split_part(coalesce(new.email, ''), '@', 1),
    'player'
  ), '[^a-zA-Z0-9_]+', '_', 'g'));
  base_username := trim(both '_' from base_username);
  if char_length(base_username) < 3 then base_username := 'player'; end if;
  base_username := left(base_username, 30);
  candidate := base_username;

  loop
    begin
      insert into public.profiles (id, username, display_name, avatar_url)
      values (
        new.id,
        candidate,
        nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), 80), ''),
        nullif(coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture', ''), '')
      );
      exit;
    exception when unique_violation then
      suffix_number := suffix_number + 1;
      candidate := left(base_username, 30 - char_length(suffix_number::text)) || suffix_number::text;
    end;
  end loop;
  return new;
end;
$$;

-- Recalculate existing open votes immediately using the new weights.
do $$
declare
  target record;
begin
  for target in select distinct macro_id from public.macro_reports where resolved_at is null loop
    perform public.refresh_macro_vote_state(target.macro_id);
  end loop;
end;
$$;

drop policy if exists macros_delete_mod on public.macros;
drop policy if exists macros_delete_own_or_mod on public.macros;
create policy macros_delete_own_or_mod on public.macros for delete to authenticated
using (auth.uid() = uploader_id or public.is_moderator());
