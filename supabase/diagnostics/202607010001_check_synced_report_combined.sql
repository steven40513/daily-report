-- Combined synced report diagnostic.
-- Use this in Supabase SQL Editor when you want one result table instead of
-- multiple result sets. It shows the latest synced daily report, its report
-- items, and its work logs together.

with latest_report as (
    select dr.*
    from daily_reports dr
    order by dr.updated_at desc nulls last, dr.created_at desc nulls last
    limit 1
),
report_summary as (
    select
        '1_daily_report'::text as section,
        lr.report_date,
        'summary'::text as record_type,
        p.name::text as name,
        lr.status::text as quantity_or_value,
        null::text as unit,
        concat_ws(
            ' | ',
            'project=' || coalesce(p.name, '(unknown)'),
            'weather_am=' || coalesce(lr.weather_am, '(empty)'),
            'weather_pm=' || coalesce(lr.weather_pm, '(empty)'),
            'construction_days=' || coalesce(lr.construction_days::text, '(empty)'),
            'created_by=' || coalesce(u.email, lr.created_by::text, '(unknown)')
        ) as details,
        lr.updated_at
    from latest_report lr
    left join projects p on p.id = lr.project_id
    left join auth.users u on u.id = lr.created_by
),
report_item_rows as (
    select
        '2_report_items'::text as section,
        lr.report_date,
        ri.item_type::text as record_type,
        coalesce(ri.name, ri.category, '(unnamed)')::text as name,
        ri.quantity::text as quantity_or_value,
        ri.unit::text as unit,
        concat_ws(
            ' | ',
            'category=' || coalesce(ri.category, '(empty)'),
            'checked=' || coalesce(ri.is_checked::text, '(empty)')
        ) as details,
        ri.updated_at
    from latest_report lr
    join report_items ri on ri.report_id = lr.id
),
work_log_rows as (
    select
        '3_work_logs'::text as section,
        lr.report_date,
        'work_log'::text as record_type,
        coalesce(wl.title, '(untitled)')::text as name,
        wl.hours::text as quantity_or_value,
        'hours'::text as unit,
        concat_ws(
            ' | ',
            'person=' || coalesce(wl.person, '(empty)'),
            'contractor_unit=' || coalesce(wl.contractor_unit, '(empty)'),
            'total_hours=' || coalesce(wl.total_hours::text, '(empty)'),
            'location=' || coalesce(wl.location, '(empty)'),
            'subcontractor=' || coalesce(wl.subcontractor_name, '(none)')
        ) as details,
        wl.updated_at
    from latest_report lr
    join work_logs wl on wl.report_id = lr.id
)
select *
from report_summary
union all
select *
from report_item_rows
union all
select *
from work_log_rows
order by section, updated_at nulls last, name;
