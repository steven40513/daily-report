-- 停工紀錄上雲 + 日報補填標記
-- 背景：stoppages（停工標記）與 backfilled（補填標記）原本只存 localStorage，
-- 多裝置情境下停工日會被其他裝置誤判為缺件、補填標記也不會跟著日報同步。
-- 本 migration 為冪等設計，可在 Supabase SQL Editor 重複執行。
-- 原則：只加欄位/加表，不動既有欄位與規則，舊版前端完全不受影響。

-- 1. daily_reports 補填標記欄位
alter table public.daily_reports
  add column if not exists backfilled boolean not null default false;
alter table public.daily_reports
  add column if not exists backfilled_at timestamptz;

-- 2. 停工紀錄表（停工日不會有 daily_reports 列，因此需要獨立表）
create table if not exists public.stoppages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  stoppage_date date not null,
  reason text not null default '',
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, stoppage_date)
);

create index if not exists idx_stoppages_project_date
  on public.stoppages (project_id, stoppage_date);

drop trigger if exists set_stoppages_updated_at on public.stoppages;
create trigger set_stoppages_updated_at
before update on public.stoppages
for each row execute function public.set_updated_at();

-- 3. RLS：沿用既有 helper（is_company_admin / is_project_member / can_write_project）
alter table public.stoppages enable row level security;

drop policy if exists "stoppages_select_project_access" on public.stoppages;
create policy "stoppages_select_project_access"
on public.stoppages for select
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.projects p
    where p.id = project_id
      and (
        public.is_company_admin(p.company_id)
        or public.is_project_member(project_id)
      )
  )
);

drop policy if exists "stoppages_insert_project_writer" on public.stoppages;
create policy "stoppages_insert_project_writer"
on public.stoppages for insert
to authenticated
with check (
  auth.uid() is not null
  and created_by = auth.uid()
  and public.can_write_project(project_id)
);

drop policy if exists "stoppages_update_project_writer" on public.stoppages;
create policy "stoppages_update_project_writer"
on public.stoppages for update
to authenticated
using (
  auth.uid() is not null
  and public.can_write_project(project_id)
)
with check (
  auth.uid() is not null
  and public.can_write_project(project_id)
);

-- 注意：刪除（=取消停工標記）開放給專案可寫成員，
-- 與 daily_reports 的「刪除限管理者」不同——取消停工是日常修正操作，不是刪日報。
drop policy if exists "stoppages_delete_project_writer" on public.stoppages;
create policy "stoppages_delete_project_writer"
on public.stoppages for delete
to authenticated
using (
  auth.uid() is not null
  and public.can_write_project(project_id)
);
