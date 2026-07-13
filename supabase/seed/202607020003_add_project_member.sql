-- 把 LINE 登入建立的新使用者掛進既有公司／專案。
--
-- 使用方式：把下方四個 REPLACE_WITH_* 佔位符換成實際值再執行。
--   auth_user_id：用 diagnostics/202607020002_find_unlinked_auth_users.sql 查出
-- 角色：owner（公司內最高權限，可管理所有專案與成員）
-- 專案：沿用 202606300002_initial_company_project_user.sql 建立的既有專案
--
-- 這支腳本不會新增公司或專案，只會把使用者的 profile 和 project_members
-- 掛進既有公司／專案。可重複執行（upsert）。

with params as (
  select
    'REPLACE_WITH_AUTH_USER_UUID'::uuid as auth_user_id,
    'REPLACE_WITH_USER_NAME'::text as user_name,
    null::text as user_phone,
    'REPLACE_WITH_COMPANY_NAME'::text as company_name,
    'REPLACE_WITH_PROJECT_NAME'::text as project_name
),
company_row as (
  select c.id
  from public.companies c
  join params p on p.company_name = c.name
  limit 1
),
project_row as (
  select prj.id
  from public.projects prj
  join company_row c on prj.company_id = c.id
  join params p on p.project_name = prj.name
  limit 1
),
upsert_user as (
  insert into public.users (id, company_id, name, phone, global_role)
  select p.auth_user_id, c.id, p.user_name, p.user_phone, 'owner'
  from params p
  cross join company_row c
  on conflict (id) do update set
    company_id = excluded.company_id,
    name = excluded.name,
    phone = excluded.phone,
    global_role = excluded.global_role
  returning id
),
upsert_membership as (
  insert into public.project_members (project_id, user_id, project_role)
  select prj.id, usr.id, 'owner'
  from project_row prj
  cross join upsert_user usr
  on conflict (project_id, user_id) do update set
    project_role = excluded.project_role
  returning id
)
select
  (select id from company_row) as company_id,
  (select id from project_row) as project_id,
  (select id from upsert_user) as user_id,
  (select id from upsert_membership) as project_member_id;

-- 檢查結果：如果任何一欄是 null，代表對應的公司／專案沒找到，
-- 請先確認名稱是否和 Supabase 裡的資料完全一致（含全形/半形空格）。
