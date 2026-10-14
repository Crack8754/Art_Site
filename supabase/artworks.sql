-- Run AFTER schema.sql in Supabase SQL Editor. Safe to run again.
begin;

-- Keep this list aligned with public/artworks.js (ArtasArt.CATEGORIES).
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_known_art_styles') then
    alter table public.profiles add constraint profiles_known_art_styles check (
      cardinality(art_styles) <= 8 and art_styles <@ array[
        'Живопис', 'Цифрове мистецтво', 'Фотографія', 'Ілюстрація',
        'Скульптура', 'Колаж', '3D-арт', 'Графіка'
      ]::text[]
    ) not valid;
  end if;
end;
$$;

create table if not exists public.artworks (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  category text not null check (category in (
    'Живопис', 'Цифрове мистецтво', 'Фотографія', 'Ілюстрація',
    'Скульптура', 'Колаж', '3D-арт', 'Графіка'
  )),
  image_path text not null unique,
  width integer not null check (width between 1 and 4096),
  height integer not null check (height between 1 and 4096),
  created_at timestamptz not null default now(),
  constraint artworks_owned_image check (image_path = author_id::text || '/' || id::text || '.webp')
);
create index if not exists artworks_newest on public.artworks (created_at desc, id desc);
create index if not exists artworks_author_newest on public.artworks (author_id, created_at desc, id desc);
create index if not exists artworks_category_newest on public.artworks (category, created_at desc, id desc);
alter table public.artworks enable row level security;
revoke all on public.artworks from anon, authenticated;
grant select on public.artworks to anon, authenticated;
grant insert (id, author_id, title, description, category, image_path, width, height) on public.artworks to authenticated;

drop policy if exists "Public artworks" on public.artworks;
create policy "Public artworks" on public.artworks for select to anon, authenticated using (true);
drop policy if exists "Publish own artwork" on public.artworks;
create policy "Publish own artwork" on public.artworks for insert to authenticated with check (
  (select auth.uid()) = author_id and exists (
    select 1 from storage.objects where bucket_id = 'artworks' and name = image_path
  )
);

-- Browser decodes JPEG/PNG/WebP and uploads a freshly encoded WebP (max 10 MiB).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('artworks', 'artworks', true, 10485760, array['image/webp'])
on conflict (id) do update set public = true, file_size_limit = 10485760, allowed_mime_types = array['image/webp'];

drop policy if exists "Upload own art images" on storage.objects;
create policy "Upload own art images" on storage.objects for insert to authenticated with check (
  bucket_id = 'artworks' and (storage.foldername(name))[1] = (select auth.uid())::text
  and storage.extension(name) = 'webp'
  and exists (select 1 from public.profiles where id = (select auth.uid()))
);
drop policy if exists "Read own art objects" on storage.objects;
create policy "Read own art objects" on storage.objects for select to authenticated using (
  bucket_id = 'artworks' and (storage.foldername(name))[1] = (select auth.uid())::text
);
-- Only unreferenced uploads may be cleaned up. Published files cannot be replaced/deleted by clients.
drop policy if exists "Remove unpublished art images" on storage.objects;
create policy "Remove unpublished art images" on storage.objects for delete to authenticated using (
  bucket_id = 'artworks' and (storage.foldername(name))[1] = (select auth.uid())::text
  and not exists (select 1 from public.artworks where image_path = name)
);
commit;
