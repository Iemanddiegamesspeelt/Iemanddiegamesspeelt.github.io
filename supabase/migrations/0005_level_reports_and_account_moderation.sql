-- Level reports: every account may report each level once.

create table if not exists public.level_reports (
  id uuid primary key default gen_random_uuid(),
  level_id text not null references public.levels(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 1000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  unique (level_id, reporter_id)
);

create index if not exists level_reports_open_idx
on public.level_reports (created_at)
where resolved_at is null;

alter table public.level_reports enable row level security;

drop policy if exists level_reports_insert on public.level_reports;
create policy level_reports_insert
on public.level_reports for insert to authenticated
with check (reporter_id = auth.uid() and public.is_active_user());

drop policy if exists level_reports_read on public.level_reports;
create policy level_reports_read
on public.level_reports for select to authenticated
using (reporter_id = auth.uid() or public.is_moderator());

drop policy if exists level_reports_manage on public.level_reports;
create policy level_reports_manage
on public.level_reports for update to authenticated
using (public.is_moderator())
with check (public.is_moderator());

grant select, insert, update on public.level_reports to authenticated;

create or replace function public.submit_level_report(p_level_id text, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer_id uuid := auth.uid();
  report_id uuid;
  cleaned_reason text := nullif(trim(p_reason), '');
begin
  if viewer_id is null then raise exception 'Sign in to report this level'; end if;
  if not public.is_active_user() then raise exception 'Your account is temporarily restricted'; end if;
  if cleaned_reason is null then raise exception 'Tell the moderators what is wrong with this level'; end if;
  if char_length(cleaned_reason) > 1000 then raise exception 'The report is too long'; end if;
  if not exists (select 1 from public.levels where id = p_level_id) then
    raise exception 'Level not found';
  end if;
  if exists (
    select 1 from public.level_reports
    where level_id = p_level_id and reporter_id = viewer_id
  ) then
    raise exception 'You already reported this level';
  end if;

  insert into public.level_reports (level_id, reporter_id, reason)
  values (p_level_id, viewer_id, cleaned_reason)
  returning id into report_id;

  return report_id;
end;
$$;

revoke all on function public.submit_level_report(text, text) from public;
grant execute on function public.submit_level_report(text, text) to authenticated;
