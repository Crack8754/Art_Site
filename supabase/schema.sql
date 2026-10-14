-- Public artist profiles. Keep private account data in Supabase Auth, not this table.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 40),
  avatar_url text,
  username text unique check (username is null or username ~ '^[a-z0-9_]{3,30}$'),
  bio text not null default '' check (char_length(bio) <= 300),
  location text not null default '' check (char_length(location) <= 80),
  website_url text,
  instagram_url text,
  behance_url text,
  art_styles text[] not null default '{}',
  is_artist boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Safe for projects that created the profiles table before these fields existed.
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles add column if not exists location text not null default '';
alter table public.profiles add column if not exists website_url text;
alter table public.profiles add column if not exists instagram_url text;
alter table public.profiles add column if not exists behance_url text;
alter table public.profiles add column if not exists art_styles text[] not null default '{}';
alter table public.profiles add column if not exists is_artist boolean not null default false;
create unique index if not exists profiles_username_unique on public.profiles (username) where username is not null;

-- Apply identical validation to existing tables as well as new installations.
-- NOT VALID preserves legacy rows; all new/updated rows are still checked.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_username_format') then
    alter table public.profiles add constraint profiles_username_format check (username is null or username ~ '^[a-z0-9_]{3,30}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_bio_length') then
    alter table public.profiles add constraint profiles_bio_length check (char_length(bio) <= 300) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_location_length') then
    alter table public.profiles add constraint profiles_location_length check (char_length(location) <= 80) not valid;
  end if;
end;
$$;

-- Social graph used by the public "Follow" button on artist profiles.
create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

alter table public.follows enable row level security;
drop policy if exists "Anyone can view follows" on public.follows;
create policy "Anyone can view follows" on public.follows for select to anon, authenticated using (true);
drop policy if exists "Users can follow from their own account" on public.follows;
create policy "Users can follow from their own account" on public.follows for insert to authenticated with check ((select auth.uid()) = follower_id);
drop policy if exists "Users can unfollow from their own account" on public.follows;
create policy "Users can unfollow from their own account" on public.follows for delete to authenticated using ((select auth.uid()) = follower_id);
grant select, insert, delete on public.follows to anon, authenticated;

alter table public.profiles enable row level security;

drop policy if exists "Anyone can view public profiles" on public.profiles;
create policy "Anyone can view public profiles"
  on public.profiles for select
  to anon, authenticated
  using (true);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant update (display_name, avatar_url, username, bio, location, website_url, instagram_url, behance_url, art_styles, is_artist) on public.profiles to authenticated;

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_profile_updated_at();

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_name text;
begin
  profile_name := left(
    btrim(coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1),
      'Artas user'
    )),
    40
  );

  if char_length(profile_name) < 2 then
    profile_name := 'Artas user';
  end if;

  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    profile_name,
    left(new.raw_user_meta_data ->> 'avatar_url', 2048)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

revoke all on function public.set_profile_updated_at() from public, anon, authenticated;
revoke all on function public.create_profile_for_new_user() from public, anon, authenticated;

-- Backfill accounts registered before the trigger existed. Preserve existing profiles.
insert into public.profiles (id, display_name, avatar_url)
select id,
  case when char_length(profile_name) >= 2 then profile_name else 'Artas user' end,
  avatar_url
from (
  select id,
    left(btrim(coalesce(raw_user_meta_data ->> 'display_name', raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', split_part(email, '@', 1), 'Artas user')), 40) as profile_name,
    left(raw_user_meta_data ->> 'avatar_url', 2048) as avatar_url
  from auth.users
) as existing_users
on conflict (id) do nothing;
