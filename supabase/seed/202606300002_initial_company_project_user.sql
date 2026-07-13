-- Initial data seed for the construction daily report system.
--
-- How to use:
-- 1. Run supabase/migrations/202606300001_initial_schema.sql first.
-- 2. Create or sign in with your first Supabase Auth user.
-- 3. In Supabase Dashboard, open Authentication -> Users and copy that user's UUID.
-- 4. Replace the values in the params CTE below.
-- 5. Run this whole file in SQL Editor.
--
-- This script is safe to run more than once. It uses fixed names and upserts
-- the public.users row and project_members row.

with params as (
  select
    'REPLACE_WITH_AUTH_USER_UUID'::uuid as auth_user_id,
    '第一位主任'::text as user_name,
    null::text as user_phone,
    '瑋瓏營造股份有限公司'::text as company_name,
    '高鐵綻'::text as project_name,
    '瑋瓏營造股份有限公司'::text as contractor_name,
    '2026-06-01'::date as start_date,
    '2028-06-01'::date as end_date
),
upsert_company as (
  insert into public.companies (name)
  select company_name
  from params
  where not exists (
    select 1
    from public.companies c
    where c.name = params.company_name
  )
  returning id
),
company_row as (
  select id from upsert_company
  union all
  select c.id
  from public.companies c
  join params p on p.company_name = c.name
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
upsert_project as (
  insert into public.projects (
    company_id,
    name,
    contractor_name,
    start_date,
    end_date,
    crew_types,
    material_catalog,
    equipment_catalog,
    signers
  )
  select
    c.id,
    p.project_name,
    p.contractor_name,
    p.start_date,
    p.end_date,
    '["裝修工程","結構工程","基礎工程","機電工程","假設工程"]'::jsonb,
    '{
      "concrete":{"label":"混凝土類","items":[{"name":"混凝土 2000psi","unit":"米"},{"name":"混凝土 3000psi","unit":"米"},{"name":"混凝土 4000psi","unit":"米"},{"name":"混凝土 5000psi","unit":"米"}]},
      "masonry":{"label":"砌築材料","items":[{"name":"紅磚","unit":"塊"},{"name":"水泥","unit":"包"},{"name":"海菜粉","unit":"包"},{"name":"七厘石","unit":"包"}]},
      "sealant":{"label":"填縫黏著","items":[{"name":"填縫劑（粗）","unit":"包"},{"name":"填縫劑（細）","unit":"包"},{"name":"黏著劑","unit":"包"}]},
      "aggregate":{"label":"骨材類","items":[{"name":"碎石","unit":"方"},{"name":"砂","unit":"方"}]},
      "rebar":{"label":"鋼筋類","items":[{"name":"高拉鋼筋","unit":"噸"},{"name":"中拉鋼筋","unit":"噸"}]},
      "other":{"label":"其他材料","items":[]}
    }'::jsonb,
    '{
      "excavate":{"label":"挖掘機具","items":[{"name":"怪手 PC120","unit":"hr"},{"name":"怪手 PC60","unit":"hr"},{"name":"怪手 PC30","unit":"hr"}]},
      "crush":{"label":"破碎機具","items":[{"name":"破碎機 PC30","unit":"hr"},{"name":"破碎機 PC120","unit":"hr"},{"name":"破碎機 PC60","unit":"hr"}]},
      "crane":{"label":"吊掛機具","items":[{"name":"全吊 25t","unit":"hr"},{"name":"全吊 40t","unit":"hr"},{"name":"全吊 60t","unit":"hr"},{"name":"吊卡","unit":"hr"}]},
      "transport":{"label":"運輸車輛","items":[{"name":"卡車 8.8t","unit":"hr"},{"name":"卡車 21t","unit":"輛"},{"name":"拖車 35t","unit":"輛"},{"name":"板車","unit":"趟"}]}
    }'::jsonb,
    '{"工地主任":"","品管人員":"","安衛人員":"","專案經理":""}'::jsonb
  from params p
  cross join company_row c
  where not exists (
    select 1
    from public.projects existing
    where existing.company_id = c.id
      and existing.name = p.project_name
  )
  returning id
),
project_row as (
  select id from upsert_project
  union all
  select prj.id
  from public.projects prj
  cross join company_row c
  join params p on p.project_name = prj.name
  where prj.company_id = c.id
  limit 1
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
