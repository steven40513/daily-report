-- 現場照片：日報附件
-- 前端壓縮後上傳 Supabase Storage（bucket: report-photos），
-- 資料庫存路徑對照。路徑格式：{project_id}/{report_date}/{photo_id}.jpg
-- 冪等設計，可重複執行。

-- 1. 照片對照表
create table if not exists public.report_photos (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.daily_reports(id) on delete cascade,
  storage_path text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (report_id, storage_path)
);

create index if not exists idx_report_photos_report
  on public.report_photos (report_id);

alter table public.report_photos enable row level security;

drop policy if exists "report_photos_select_project_access" on public.report_photos;
create policy "report_photos_select_project_access"
on public.report_photos for select
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.daily_reports dr
    join public.projects p on p.id = dr.project_id
    where dr.id = report_id
      and (
        public.is_company_admin(p.company_id)
        or public.is_project_member(dr.project_id)
      )
  )
);

drop policy if exists "report_photos_write_project_writer" on public.report_photos;
create policy "report_photos_write_project_writer"
on public.report_photos for all
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1 from public.daily_reports dr
    where dr.id = report_id
      and public.can_write_project(dr.project_id)
  )
)
with check (
  auth.uid() is not null
  and exists (
    select 1 from public.daily_reports dr
    where dr.id = report_id
      and public.can_write_project(dr.project_id)
  )
);

-- 2. Storage bucket（私有）
insert into storage.buckets (id, name, public)
values ('report-photos', 'report-photos', false)
on conflict (id) do nothing;

-- 3. Storage 物件權限：路徑第一段是 project_id，用既有 helper 檢查
drop policy if exists "report_photos_storage_select" on storage.objects;
create policy "report_photos_storage_select"
on storage.objects for select
to authenticated
using (
  bucket_id = 'report-photos'
  and (
    public.is_project_member((split_part(name, '/', 1))::uuid)
    or exists (
      select 1 from public.projects p
      where p.id = (split_part(name, '/', 1))::uuid
        and public.is_company_admin(p.company_id)
    )
  )
);

drop policy if exists "report_photos_storage_insert" on storage.objects;
create policy "report_photos_storage_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'report-photos'
  and public.can_write_project((split_part(name, '/', 1))::uuid)
);

drop policy if exists "report_photos_storage_delete" on storage.objects;
create policy "report_photos_storage_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'report-photos'
  and public.can_write_project((split_part(name, '/', 1))::uuid)
);
