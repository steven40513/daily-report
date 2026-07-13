-- 找出已經透過 Auth 登入（含 LINE Login）、但還沒有對應 public.users profile 的帳號。
-- 用途：LINE 登入後系統顯示「找不到專案」，通常就是因為這個使用者還沒被
--       建到 public.users / public.project_members，這支查詢可以幫你找到他的 UUID。
--
-- 使用方式：
-- 1. 到 Supabase Dashboard -> SQL Editor。
-- 2. 貼上整段執行。
-- 3. 把結果（尤其是 id 欄位）記下來，用在下一步的
--    supabase/seed/202607020003_add_project_member.sql

select
  au.id as auth_user_id,
  au.email,
  au.raw_user_meta_data ->> 'name' as line_name,
  au.raw_user_meta_data ->> 'full_name' as line_full_name,
  au.raw_app_meta_data ->> 'provider' as provider,
  au.created_at,
  au.last_sign_in_at,
  (pu.id is not null) as already_has_profile
from auth.users au
left join public.users pu on pu.id = au.id
order by au.created_at desc;

-- 如果只想看「還沒建 profile」的人，把上面的查詢換成這個版本：
--
-- select
--   au.id as auth_user_id,
--   au.email,
--   au.raw_user_meta_data ->> 'name' as line_name,
--   au.raw_app_meta_data ->> 'provider' as provider,
--   au.created_at
-- from auth.users au
-- left join public.users pu on pu.id = au.id
-- where pu.id is null
-- order by au.created_at desc;
