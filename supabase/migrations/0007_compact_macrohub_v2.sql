-- Update the public catalog for the strict compact MacroHub v2 container.

update public.macro_formats
set display_name = 'MacroHub Replay v2',
    extension = '.macrohub',
    description = 'Lossless delta-packed MessagePack replay compressed with gzip; legacy MacroHub JSON is not supported'
where id = 'macrohub-json';
