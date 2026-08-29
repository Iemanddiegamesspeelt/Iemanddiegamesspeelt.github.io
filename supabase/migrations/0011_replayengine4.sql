-- Replace the obsolete Replay Engine 3 listing with GDH Replay Engine 4.

insert into public.macro_formats (id, display_name, extension, description, enabled)
values ('replayengine4', 'RE4', '.re4', 'GDH Replay Engine 4 replay', true)
on conflict (id) do update set
  display_name = excluded.display_name,
  extension = excluded.extension,
  description = excluded.description,
  enabled = true;

insert into public.replay_tools (id, display_name, enabled)
values ('gdh', 'GDH', true)
on conflict (id) do update set
  display_name = excluded.display_name,
  enabled = true;

insert into public.format_tool_compatibility
  (format_id, replay_tool_id, direction, support, verification, recommended, notes)
values
  ('replayengine4', 'gdh', 'both', 'native', 'verified', true, 'Official GDH Replay Engine v4 format.')
on conflict (format_id, replay_tool_id) do update set
  direction = excluded.direction,
  support = excluded.support,
  verification = excluded.verification,
  recommended = excluded.recommended,
  notes = excluded.notes;

delete from public.format_tool_compatibility
where format_id = 'replayengine3';

update public.macro_formats
set enabled = false
where id = 'replayengine3';

update public.macros
set available_format_ids = case
  when 'replayengine4' = any(array_remove(available_format_ids, 'replayengine3'))
    then array_remove(available_format_ids, 'replayengine3')
  else array_append(array_remove(available_format_ids, 'replayengine3'), 'replayengine4')
end;
