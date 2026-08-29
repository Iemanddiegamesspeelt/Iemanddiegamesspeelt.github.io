-- Keep level and profile macro totals aligned with macros that are visible to the public.
-- The original counter only reacted to physical inserts/deletes, so moderation that
-- changed working_status to "removed" left a stale total behind.

create or replace function public.update_macro_totals()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.levels as level
    set macro_count = (
      select count(*)::integer
      from public.macros as macro
      where macro.level_id = level.id
        and macro.working_status <> 'removed'
    )
    where level.id = new.level_id;

    update public.profiles as profile
    set macro_count = (
      select count(*)::integer
      from public.macros as macro
      where macro.uploader_id = profile.id
        and macro.working_status <> 'removed'
    )
    where profile.id = new.uploader_id;

    return new;
  end if;

  if tg_op = 'DELETE' then
    update public.levels as level
    set macro_count = (
      select count(*)::integer
      from public.macros as macro
      where macro.level_id = level.id
        and macro.working_status <> 'removed'
    )
    where level.id = old.level_id;

    update public.profiles as profile
    set macro_count = (
      select count(*)::integer
      from public.macros as macro
      where macro.uploader_id = profile.id
        and macro.working_status <> 'removed'
    )
    where profile.id = old.uploader_id;

    return old;
  end if;

  update public.levels as level
  set macro_count = (
    select count(*)::integer
    from public.macros as macro
    where macro.level_id = level.id
      and macro.working_status <> 'removed'
  )
  where level.id in (old.level_id, new.level_id);

  update public.profiles as profile
  set macro_count = (
    select count(*)::integer
    from public.macros as macro
    where macro.uploader_id = profile.id
      and macro.working_status <> 'removed'
  )
  where profile.id in (old.uploader_id, new.uploader_id);

  return new;
end;
$$;

drop trigger if exists macros_totals on public.macros;
create trigger macros_totals
after insert or delete or update of working_status, level_id, uploader_id on public.macros
for each row execute function public.update_macro_totals();

-- Repair any totals that were already stale before this migration was installed.
update public.levels as level
set macro_count = (
  select count(*)::integer
  from public.macros as macro
  where macro.level_id = level.id
    and macro.working_status <> 'removed'
);

update public.profiles as profile
set macro_count = (
  select count(*)::integer
  from public.macros as macro
  where macro.uploader_id = profile.id
    and macro.working_status <> 'removed'
);
