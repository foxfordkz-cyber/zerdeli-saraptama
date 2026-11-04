-- Zerdeli expert review: database schema.
-- Run once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: every statement is idempotent.

-- 1. Who may read comments. Add the manager's login e-mail here
--    (the same e-mail you create in Authentication → Users).
create table if not exists public.admins (
  email text primary key check (email = lower(email))
);
alter table public.admins enable row level security;
-- No policies on purpose: the table is invisible to the website itself.

-- insert into public.admins (email) values ('boss@example.com') on conflict do nothing;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- 2. Expert comments.
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  document_id text not null check (document_id ~ '^[a-z0-9-]{1,80}$'),
  section_id text check (section_id ~ '^s[0-9]{1,4}$'),
  section_title text check (char_length(section_title) <= 300),
  first_name text not null check (char_length(btrim(first_name)) between 1 and 80),
  last_name text not null check (char_length(btrim(last_name)) between 1 and 80),
  school text not null check (char_length(btrim(school)) between 1 and 160),
  body text check (char_length(body) <= 5000),
  audio_path text check (audio_path ~ '^[a-z0-9-]{1,80}/[0-9a-f-]{36}\.(webm|mp4|m4a|ogg)$'),
  audio_duration_sec integer check (audio_duration_sec between 1 and 330),
  audio_mime text check (char_length(audio_mime) <= 80),
  ui_lang text check (ui_lang in ('kk', 'ru')),
  status text not null default 'new' check (status in ('new', 'done')),
  constraint comment_has_content check (
    char_length(btrim(coalesce(body, ''))) > 0 or audio_path is not null
  )
);

create index if not exists comments_created_at_idx on public.comments (created_at desc);
create index if not exists comments_document_idx on public.comments (document_id);

alter table public.comments enable row level security;

drop policy if exists "experts can submit" on public.comments;
create policy "experts can submit" on public.comments
  for insert to anon, authenticated
  with check (status = 'new');

drop policy if exists "manager can read" on public.comments;
create policy "manager can read" on public.comments
  for select to authenticated
  using (public.is_admin());

drop policy if exists "manager can update" on public.comments;
create policy "manager can update" on public.comments
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "manager can delete" on public.comments;
create policy "manager can delete" on public.comments
  for delete to authenticated
  using (public.is_admin());

grant insert on public.comments to anon, authenticated;
grant select, update, delete on public.comments to authenticated;

-- 3. Voice recordings: private bucket, 10 MB per file, audio only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comment-audio', 'comment-audio', false, 10485760, array['audio/*'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "experts can upload audio" on storage.objects;
create policy "experts can upload audio" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'comment-audio'
    and name ~ '^[a-z0-9-]{1,80}/[0-9a-f-]{36}\.(webm|mp4|m4a|ogg)$'
  );

drop policy if exists "manager can listen" on storage.objects;
create policy "manager can listen" on storage.objects
  for select to authenticated
  using (bucket_id = 'comment-audio' and public.is_admin());

drop policy if exists "manager can delete audio" on storage.objects;
create policy "manager can delete audio" on storage.objects
  for delete to authenticated
  using (bucket_id = 'comment-audio' and public.is_admin());
