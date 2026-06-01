-- ─────────────────────────────────────────────────────────────────────────────
-- 002 — Supabase Storage: limelight-images bucket + image metadata
-- ─────────────────────────────────────────────────────────────────────────────

-- Storage bucket for generated images (room backgrounds, gallery art)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'limelight-images',
  'limelight-images',
  false,
  5242880, -- 5 MB per file
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

-- Users can only read/write their own folder (first path segment = user UUID)
create policy "images: own read"
  on storage.objects for select
  using (
    bucket_id = 'limelight-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "images: own write"
  on storage.objects for insert
  with check (
    bucket_id = 'limelight-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "images: own update"
  on storage.objects for update
  using (
    bucket_id = 'limelight-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "images: own delete"
  on storage.objects for delete
  using (
    bucket_id = 'limelight-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Image metadata ───────────────────────────────────────────────────────────
-- Mirrors the IndexedDB StoredImage record (without the dataUrl blob).
-- Allows cross-device restore: download blob from storage + reconstruct
-- StoredImage using this row.

create table public.image_meta (
  id               text        not null,
  user_id          uuid        not null references public.profiles(id) on delete cascade,
  slot_id          text        not null,
  cache_key        text        not null,
  kind             text        not null,
  label            text        not null default '',
  prompt           text        not null default '',
  character_name   text        not null default '',
  meta             jsonb,
  source_image_id  text,
  cloud_path       text        not null,
  created_at       bigint      not null,
  primary key (user_id, id)
);

alter table public.image_meta enable row level security;

create policy "image_meta: own"
  on public.image_meta for all
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index image_meta_slot_idx on public.image_meta (user_id, slot_id);
