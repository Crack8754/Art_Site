-- Run after schema.sql and artworks.sql. Re-runnable; preserves existing artwork.
begin;
alter table public.artworks add column if not exists images jsonb;

-- NULL supports older publications/clients. New arrays must contain 1–5
-- ordered images, with the first image matching the legacy cover columns.
create or replace function public.valid_artwork_images(
  items jsonb, owner_id uuid, artwork_id uuid, cover text, cover_width integer, cover_height integer
) returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb; position integer := 0; expected text;
begin
  if items is null then return true; end if;
  if jsonb_typeof(items) <> 'array' then return false; end if;
  if jsonb_array_length(items) not between 1 and 5 then return false; end if;
  for item in select value from jsonb_array_elements(items) loop
    position := position + 1;
    expected := owner_id::text || '/' || artwork_id::text ||
      case when position = 1 then '' else '-' || position::text end || '.webp';
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'path') is distinct from 'string'
      or item->>'path' is distinct from expected
      or jsonb_typeof(item->'width') is distinct from 'number'
      or jsonb_typeof(item->'height') is distinct from 'number'
      or (item->>'width') !~ '^[0-9]+$' or (item->>'height') !~ '^[0-9]+$'
      or (item->>'width')::integer not between 1 and 4096
      or (item->>'height')::integer not between 1 and 4096 then return false; end if;
    if position = 1 and (item->>'path' is distinct from cover
      or (item->>'width')::integer is distinct from cover_width
      or (item->>'height')::integer is distinct from cover_height) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;
alter table public.artworks drop constraint if exists artworks_valid_images;
alter table public.artworks add constraint artworks_valid_images check (
  public.valid_artwork_images(images, author_id, id, image_path, width, height)
);
grant insert (images) on public.artworks to authenticated;

drop policy if exists "Publish own artwork" on public.artworks;
create policy "Publish own artwork" on public.artworks for insert to authenticated with check (
  (select auth.uid()) = author_id
  and exists (select 1 from storage.objects where bucket_id = 'artworks' and name = image_path)
  and not exists (
    select 1 from jsonb_array_elements(
      case when jsonb_typeof(images) = 'array' then images else '[]'::jsonb end
    ) as img(value)
    where not exists (select 1 from storage.objects where bucket_id = 'artworks' and name = img.value->>'path')
  )
);
drop policy if exists "Remove unpublished art images" on storage.objects;
create policy "Remove unpublished art images" on storage.objects for delete to authenticated using (
  bucket_id = 'artworks' and (storage.foldername(name))[1] = (select auth.uid())::text
  and not exists (
    select 1 from public.artworks where image_path = name
      or images @> jsonb_build_array(jsonb_build_object('path', name))
  )
);
create index if not exists artworks_images_gin on public.artworks using gin (images);
commit;
