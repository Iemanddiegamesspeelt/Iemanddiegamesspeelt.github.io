-- Optional YouTube showcase links for macro detail pages. Position-path previews
-- use the canonical replay and need no additional database storage.

alter table public.macros
  add column if not exists preview_video_url text;

alter table public.macros
  drop constraint if exists macros_preview_video_url_check;

alter table public.macros
  add constraint macros_preview_video_url_check check (
    preview_video_url is null
    or (
      char_length(preview_video_url) <= 1000
      and preview_video_url ~* '^https://(www\.|m\.)?(youtube\.com|youtu\.be)/'
    )
  );
