-- Check whether the initial Supabase schema has already been applied.
-- Paste this into Supabase SQL Editor and run it after seeing
-- "relation already exists" errors.

select
  required.object_type,
  required.object_name,
  case
    when existing.object_name is null then 'missing'
    else 'ok'
  end as status
from (
  values
    ('table', 'companies'),
    ('table', 'users'),
    ('table', 'projects'),
    ('table', 'project_members'),
    ('table', 'daily_reports'),
    ('table', 'report_items'),
    ('table', 'work_logs'),
    ('function', 'current_company_id'),
    ('function', 'is_company_admin'),
    ('function', 'is_project_member'),
    ('function', 'can_write_project')
) as required(object_type, object_name)
left join (
  select 'table' as object_type, tablename as object_name
  from pg_tables
  where schemaname = 'public'
  union all
  select 'function' as object_type, proname as object_name
  from pg_proc
  join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
  where pg_namespace.nspname = 'public'
) as existing
  on existing.object_type = required.object_type
  and existing.object_name = required.object_name
order by required.object_type, required.object_name;

select
  schemaname,
  tablename,
  rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
  and tablename in (
    'companies',
    'users',
    'projects',
    'project_members',
    'daily_reports',
    'report_items',
    'work_logs'
  )
order by tablename;

select
  schemaname,
  tablename,
  policyname,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'companies',
    'users',
    'projects',
    'project_members',
    'daily_reports',
    'report_items',
    'work_logs'
  )
order by tablename, policyname;
