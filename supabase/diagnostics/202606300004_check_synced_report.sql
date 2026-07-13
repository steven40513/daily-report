-- Check synced reports after pressing "同步今日日報" in the frontend.

select
  dr.id,
  p.name as project_name,
  u.name as created_by,
  dr.report_date,
  dr.weather_am,
  dr.weather_pm,
  dr.construction_days,
  dr.status,
  dr.updated_at
from public.daily_reports dr
join public.projects p on p.id = dr.project_id
join public.users u on u.id = dr.created_by
order by dr.report_date desc, dr.updated_at desc
limit 20;

select
  dr.report_date,
  ri.item_type,
  ri.category,
  ri.name,
  ri.quantity,
  ri.unit,
  ri.is_checked
from public.report_items ri
join public.daily_reports dr on dr.id = ri.report_id
order by dr.report_date desc, ri.item_type, ri.sort_order
limit 100;

select
  dr.report_date,
  wl.title,
  wl.person,
  wl.contractor_unit,
  wl.hours,
  wl.total_hours,
  wl.location,
  wl.has_subcontractor,
  wl.subcontractor_name
from public.work_logs wl
join public.daily_reports dr on dr.id = wl.report_id
order by dr.report_date desc, wl.created_at desc
limit 50;
