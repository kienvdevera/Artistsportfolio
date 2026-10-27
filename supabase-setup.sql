create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  role text not null default 'artist' check (role in ('admin', 'artist')),
  created_at timestamptz not null default now()
);

create table if not exists public.artworks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  medium text not null check (char_length(medium) between 1 and 40),
  year integer not null check (year between 1000 and 9999),
  dimensions text not null default '' check (char_length(dimensions) <= 80),
  description text not null default '' check (char_length(description) <= 1200),
  image_path text not null,
  status text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where user_id = (select auth.uid()) and role = 'admin'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.artworks enable row level security;

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.artworks to authenticated;
grant select on public.artworks to anon;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Published artworks are public" on public.artworks;
create policy "Published artworks are public"
  on public.artworks for select to anon, authenticated
  using (status = 'published' or owner_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Artists submit their own work" on public.artworks;
create policy "Artists submit their own work"
  on public.artworks for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and status = 'pending'
    and exists (
      select 1 from public.profiles
      where user_id = (select auth.uid()) and role = 'artist'
    )
  );

drop policy if exists "Admins create artworks" on public.artworks;
create policy "Admins create artworks"
  on public.artworks for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.is_admin()));

drop policy if exists "Artists update pending work" on public.artworks;
create policy "Artists update pending work"
  on public.artworks for update to authenticated
  using (owner_id = (select auth.uid()) and status = 'pending')
  with check (owner_id = (select auth.uid()) and status = 'pending');

drop policy if exists "Admins update artworks" on public.artworks;
create policy "Admins update artworks"
  on public.artworks for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Artists delete pending work" on public.artworks;
create policy "Artists delete pending work"
  on public.artworks for delete to authenticated
  using (owner_id = (select auth.uid()) and status = 'pending');

drop policy if exists "Admins delete artworks" on public.artworks;
create policy "Admins delete artworks"
  on public.artworks for delete to authenticated
  using ((select public.is_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('artwork-images', 'artwork-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Artwork images are publicly readable" on storage.objects;
drop policy if exists "Published artwork images and owner images are readable" on storage.objects;
create policy "Published artwork images and owner images are readable"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'artwork-images'
    and (
      exists (
        select 1 from public.artworks
        where image_path = storage.objects.name and status = 'published'
      )
      or (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_admin())
    )
  );

drop policy if exists "Artists upload artwork images to their folder" on storage.objects;
create policy "Artists upload artwork images to their folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'artwork-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Owners and admins update artwork images" on storage.objects;
create policy "Owners and admins update artwork images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'artwork-images'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  )
  with check (
    bucket_id = 'artwork-images'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );

drop policy if exists "Owners and admins delete artwork images" on storage.objects;
create policy "Owners and admins delete artwork images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'artwork-images'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin()))
  );

-- After creating your first user in Supabase Auth, promote that account:
-- update public.profiles
-- set role = 'admin', display_name = 'Portfolio Administrator'
-- where user_id = (select id from auth.users where email = 'your-admin-email@example.com');
update public.profiles
set role = 'admin', display_name = 'Portfolio Administrator'
where user_id = (
  select id from auth.users
  where email = 'your-admin-email@example.com'
);
