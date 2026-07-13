-- Supabase initial schema for the construction daily report system.
-- This migration is intentionally backend-only: v0.1 frontend remains localStorage-based.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete restrict,
  name text not null,
  phone text,
  line_user_id text unique,
  global_role text not null default 'foreman'
    check (global_role in ('owner', 'admin', 'foreman')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  contractor_name text not null,
  start_date date not null,
  end_date date not null,
  crew_types jsonb not null default '[]'::jsonb,
  material_catalog jsonb not null default '{}'::jsonb,
  equipment_catalog jsonb not null default '{}'::jsonb,
  signers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  project_role text not null default 'foreman'
    check (project_role in ('owner', 'admin', 'foreman', 'viewer')),
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create table public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  report_date date not null,
  created_by uuid not null references public.users(id) on delete restrict,
  weather_am text,
  weather_pm text,
  construction_days integer not null check (construction_days >= 1),
  notes text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved')),
  client_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, report_date)
);

create table public.report_items (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.daily_reports(id) on delete cascade,
  item_type text not null check (item_type in ('crew', 'material', 'equipment')),
  category text not null default '',
  name text not null,
  unit text not null default '',
  quantity numeric not null default 0 check (quantity >= 0),
  is_checked boolean not null default false,
  is_custom boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id, item_type, category, name)
);

create table public.work_logs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.daily_reports(id) on delete cascade,
  title text not null,
  person text not null default '',
  contractor_unit text not null default '',
  period_am boolean not null default false,
  period_pm boolean not null default false,
  hours numeric not null default 0 check (hours >= 0),
  total_hours numeric not null default 0 check (total_hours >= 0),
  location text not null default '',
  work_today text not null default '',
  work_tomorrow text not null default '',
  has_subcontractor boolean not null default false,
  subcontractor_name text not null default '',
  filled_by uuid references public.users(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  confirmed_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_am or period_pm),
  check ((has_subcontractor = false) or (length(trim(subcontractor_name)) > 0))
);

create index users_company_id_idx on public.users(company_id);
create index projects_company_id_idx on public.projects(company_id);
create index project_members_user_id_idx on public.project_members(user_id);
create index daily_reports_project_date_idx on public.daily_reports(project_id, report_date desc);
create index report_items_report_id_idx on public.report_items(report_id);
create index work_logs_report_id_idx on public.work_logs(report_id);

create trigger set_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

create trigger set_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

create trigger set_daily_reports_updated_at
before update on public.daily_reports
for each row execute function public.set_updated_at();

create trigger set_report_items_updated_at
before update on public.report_items
for each row execute function public.set_updated_at();

create trigger set_work_logs_updated_at
before update on public.work_logs
for each row execute function public.set_updated_at();

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id
  from public.users
  where id = auth.uid()
$$;

create or replace function public.is_company_admin(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where id = auth.uid()
      and company_id = target_company_id
      and global_role in ('owner', 'admin')
  )
$$;

create or replace function public.is_project_member(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_members
    where user_id = auth.uid()
      and project_id = target_project_id
  )
$$;

create or replace function public.can_write_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    left join public.project_members pm
      on pm.project_id = p.id
      and pm.user_id = auth.uid()
    where p.id = target_project_id
      and (
        public.is_company_admin(p.company_id)
        or pm.project_role in ('owner', 'admin', 'foreman')
      )
  )
$$;

alter table public.companies enable row level security;
alter table public.users enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.daily_reports enable row level security;
alter table public.report_items enable row level security;
alter table public.work_logs enable row level security;

create policy "companies_select_same_company"
on public.companies for select
to authenticated
using (auth.uid() is not null and id = public.current_company_id());

create policy "companies_update_admin"
on public.companies for update
to authenticated
using (auth.uid() is not null and public.is_company_admin(id))
with check (auth.uid() is not null and public.is_company_admin(id));

create policy "users_select_same_company"
on public.users for select
to authenticated
using (auth.uid() is not null and company_id = public.current_company_id());

create policy "users_update_self"
on public.users for update
to authenticated
using (auth.uid() is not null and id = auth.uid())
with check (
  auth.uid() is not null
  and id = auth.uid()
  and company_id = public.current_company_id()
);

create policy "users_update_admin"
on public.users for update
to authenticated
using (auth.uid() is not null and public.is_company_admin(company_id))
with check (auth.uid() is not null and public.is_company_admin(company_id));

create policy "projects_select_member_or_admin"
on public.projects for select
to authenticated
using (
  auth.uid() is not null
  and (
    public.is_company_admin(company_id)
    or public.is_project_member(id)
  )
);

create policy "projects_write_admin"
on public.projects for all
to authenticated
using (auth.uid() is not null and public.is_company_admin(company_id))
with check (auth.uid() is not null and public.is_company_admin(company_id));

create policy "project_members_select_member_or_admin"
on public.project_members for select
to authenticated
using (
  auth.uid() is not null
  and (
    public.is_project_member(project_id)
    or exists (
      select 1
      from public.projects p
      where p.id = project_id
        and public.is_company_admin(p.company_id)
    )
  )
);

create policy "project_members_write_admin"
on public.project_members for all
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.projects p
    where p.id = project_id
      and public.is_company_admin(p.company_id)
  )
)
with check (
  auth.uid() is not null
  and exists (
    select 1
    from public.projects p
    where p.id = project_id
      and public.is_company_admin(p.company_id)
  )
);

create policy "daily_reports_select_project_access"
on public.daily_reports for select
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

create policy "daily_reports_insert_project_writer"
on public.daily_reports for insert
to authenticated
with check (
  auth.uid() is not null
  and created_by = auth.uid()
  and public.can_write_project(project_id)
);

create policy "daily_reports_update_project_writer"
on public.daily_reports for update
to authenticated
using (auth.uid() is not null and public.can_write_project(project_id))
with check (auth.uid() is not null and public.can_write_project(project_id));

create policy "daily_reports_delete_admin_only"
on public.daily_reports for delete
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.projects p
    where p.id = project_id
      and public.is_company_admin(p.company_id)
  )
);

create policy "report_items_select_report_access"
on public.report_items for select
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.daily_reports dr
    where dr.id = report_id
      and (
        public.can_write_project(dr.project_id)
        or public.is_project_member(dr.project_id)
      )
  )
);

create policy "report_items_write_report_writer"
on public.report_items for all
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.daily_reports dr
    where dr.id = report_id
      and public.can_write_project(dr.project_id)
  )
)
with check (
  auth.uid() is not null
  and exists (
    select 1
    from public.daily_reports dr
    where dr.id = report_id
      and public.can_write_project(dr.project_id)
  )
);

create policy "work_logs_select_report_access"
on public.work_logs for select
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.daily_reports dr
    where dr.id = report_id
      and (
        public.can_write_project(dr.project_id)
        or public.is_project_member(dr.project_id)
      )
  )
);

create policy "work_logs_write_report_writer"
on public.work_logs for all
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.daily_reports dr
    where dr.id = report_id
      and public.can_write_project(dr.project_id)
  )
)
with check (
  auth.uid() is not null
  and exists (
    select 1
    from public.daily_reports dr
    where dr.id = report_id
      and public.can_write_project(dr.project_id)
  )
);

