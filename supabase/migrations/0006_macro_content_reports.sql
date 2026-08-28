-- Macro moderation reports are separate from working/broken/outdated reviews.
-- Level reporting was removed from the product; remove its submission function if it exists.

drop function if exists public.submit_level_report(text, text);

create table if not exists public.macro_content_reports (
  id uuid primary key default gen_random_uuid(),
  macro_id uuid not null references public.macros(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 1000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  unique (macro_id, reporter_id)
);

create index if not exists macro_content_reports_open_idx
on public.macro_content_reports (created_at)
where resolved_at is null;

alter table public.macro_content_reports enable row level security;

drop policy if exists macro_content_reports_insert on public.macro_content_reports;
create policy macro_content_reports_insert
on public.macro_content_reports for insert to authenticated
with check (reporter_id = auth.uid() and public.is_active_user());

drop policy if exists macro_content_reports_read on public.macro_content_reports;
create policy macro_content_reports_read
on public.macro_content_reports for select to authenticated
using (reporter_id = auth.uid() or public.is_moderator());

drop policy if exists macro_content_reports_manage on public.macro_content_reports;
create policy macro_content_reports_manage
on public.macro_content_reports for update to authenticated
using (public.is_moderator())
with check (public.is_moderator());

grant select, insert, update on public.macro_content_reports to authenticated;

create or replace function public.submit_macro_content_report(p_macro_id uuid, p_reason text)
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
  if viewer_id is null then raise exception 'Sign in to report this macro'; end if;
  if not public.is_active_user() then raise exception 'Your account is temporarily restricted'; end if;
  if cleaned_reason is null then raise exception 'Tell the moderators what is wrong with this macro'; end if;
  if char_length(cleaned_reason) > 1000 then raise exception 'The report is too long'; end if;
  if not exists (
    select 1 from public.macros
    where id = p_macro_id and working_status <> 'removed'
  ) then raise exception 'Macro not found'; end if;
  if exists (
    select 1 from public.macro_content_reports
    where macro_id = p_macro_id and reporter_id = viewer_id
  ) then raise exception 'You already reported this macro'; end if;

  insert into public.macro_content_reports (macro_id, reporter_id, reason)
  values (p_macro_id, viewer_id, cleaned_reason)
  returning id into report_id;

  return report_id;
end;
$$;

revoke all on function public.submit_macro_content_report(uuid, text) from public;
grant execute on function public.submit_macro_content_report(uuid, text) to authenticated;

-- Keep the public format catalog in sync with the compressed MacroHub container.
update public.macro_formats
set display_name = 'MacroHub Replay v1',
    extension = '.macrohub',
    description = 'Gzip-compressed, versioned, lossless MacroHub replay container'
where id = 'macrohub-json';
