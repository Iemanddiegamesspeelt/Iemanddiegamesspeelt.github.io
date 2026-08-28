-- Save one changeable review per user and reopen reviews that were previously resolved.

create or replace function public.submit_macro_review(p_macro_id uuid, p_status text)
returns table (
  saved_status text,
  working_reviews integer,
  broken_reviews integer,
  outdated_reviews integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  viewer_id uuid := auth.uid();
begin
  if viewer_id is null then raise exception 'Sign in to review this macro'; end if;
  if not public.is_active_user() then raise exception 'Your account is temporarily restricted'; end if;
  if p_status not in ('working', 'broken', 'outdated') then raise exception 'Invalid review status'; end if;
  if not exists (
    select 1 from public.macros
    where id = p_macro_id and working_status <> 'removed'
  ) then raise exception 'Macro not found'; end if;

  insert into public.macro_reports as reviews (
    macro_id,
    reporter_id,
    status,
    details,
    created_at,
    resolved_at,
    resolved_by
  )
  values (p_macro_id, viewer_id, p_status, null, now(), null, null)
  on conflict (macro_id, reporter_id) do update
  set status = excluded.status,
      details = null,
      created_at = now(),
      resolved_at = null,
      resolved_by = null;

  return query
  select p_status, macros.working_votes, macros.broken_votes, macros.outdated_votes
  from public.macros
  where macros.id = p_macro_id;
end;
$$;

revoke all on function public.submit_macro_review(uuid, text) from public;
grant execute on function public.submit_macro_review(uuid, text) to authenticated;
